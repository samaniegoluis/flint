// CFIRE-UPSTREAM: CF-146
//
// HTTP shim for src/adapters/vaultremote/remote.cf (milestone 43): one request to a
// remote vault server over libcurl. core:net/http cannot be used from cfire code for
// this (CF-146): headers do not compile (CF-142), there is no connect or total
// timeout, and on macOS without OpenSSL an https request falls back to Foundation and
// loses the response headers (the version travels in `ETag`).
//
// The request's headers come as one string, a header per line. The token is one of
// them; it is never copied anywhere but into libcurl's header list, and never part of
// an error message. Redirects are not followed, and only http and https are allowed.
//
// Return codes: 0 a response arrived (any status), 2 could not connect (DNS, refused,
// unreachable), 3 timed out, 4 TLS failed (certificate, handshake), 5 the response was
// over `max_bytes`, 6 anything else.
#pragma once
#include <curl/curl.h>
#include <cstddef>
#include <cstdint>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <span>
#include <string>
#include <vector>

namespace flint_remote {

struct Sink {
    std::vector<std::uint8_t>* out;
    std::size_t max_bytes;
    bool over;
};

struct Heads {
    std::string etag;
    std::string vault_id;
};

inline std::size_t on_body(char* data, std::size_t size, std::size_t n, void* user) {
    auto* s = static_cast<Sink*>(user);
    std::size_t len = size * n;
    if (s->out->size() + len > s->max_bytes) {
        s->over = true;
        return 0;
    }
    const auto* p = reinterpret_cast<const std::uint8_t*>(data);
    s->out->insert(s->out->end(), p, p + len);
    return len;
}

inline std::string trim(std::string v) {
    while (!v.empty() && (v.back() == '\r' || v.back() == '\n' || v.back() == ' ' || v.back() == '\t')) v.pop_back();
    std::size_t i = 0;
    while (i < v.size() && (v[i] == ' ' || v[i] == '\t')) i++;
    return v.substr(i);
}

inline std::size_t on_header(char* data, std::size_t size, std::size_t n, void* user) {
    auto* h = static_cast<Heads*>(user);
    std::size_t len = size * n;
    std::string line(data, len);
    auto colon = line.find(':');
    if (colon != std::string::npos) {
        std::string name = line.substr(0, colon);
        for (auto& c : name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        std::string value = trim(line.substr(colon + 1));
        if (name == "etag") h->etag = value;
        else if (name == "x-flint-vault-id") h->vault_id = value;
    }
    return len;
}

inline void global_init() {
    static std::once_flag once;
    std::call_once(once, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

inline int request(const std::string& method, const std::string& url, const std::string& headers,
                   std::span<const std::uint8_t> body, std::int64_t connect_ms, std::int64_t total_ms,
                   std::int64_t max_bytes, std::int64_t& status, std::string& etag, std::string& vault_id,
                   std::vector<std::uint8_t>& out, std::string& err) {
    global_init();
    status = 0;
    out.clear();
    CURL* curl = curl_easy_init();
    if (!curl) {
        err = "could not start an HTTP request";
        return 6;
    }
    struct curl_slist* list = nullptr;
    std::size_t start = 0;
    while (start < headers.size()) {
        auto end = headers.find('\n', start);
        if (end == std::string::npos) end = headers.size();
        std::string line = headers.substr(start, end - start);
        if (!line.empty()) list = curl_slist_append(list, line.c_str());
        start = end + 1;
    }
    // libcurl adds `Expect: 100-continue` to large uploads; the server does not answer it.
    list = curl_slist_append(list, "Expect:");
    Sink sink{&out, static_cast<std::size_t>(max_bytes), false};
    Heads heads;
    char errbuf[CURL_ERROR_SIZE];
    errbuf[0] = 0;

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
#if LIBCURL_VERSION_NUM >= 0x075500
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http,https");
#else
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
#endif
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, static_cast<long>(connect_ms));
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, static_cast<long>(total_ms));
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, list);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, on_body);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &sink);
    curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(curl, CURLOPT_HEADERDATA, &heads);
    curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, errbuf);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "flint");
    if (method == "PUT" || method == "POST") {
        // POST: an alert's publish to ntfy (milestone 63).
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, reinterpret_cast<const char*>(body.data()));
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(body.size()));
    } else {
        curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    }

    CURLcode rc = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(list);
    curl_easy_cleanup(curl);
    status = code;
    etag = heads.etag;
    vault_id = heads.vault_id;
    if (rc == CURLE_OK) return 0;
    if (sink.over) {
        err = "the server sent more than the size a vault may have";
        return 5;
    }
    err = errbuf[0] ? std::string(errbuf) : std::string(curl_easy_strerror(rc));
    switch (rc) {
        case CURLE_COULDNT_RESOLVE_HOST:
        case CURLE_COULDNT_RESOLVE_PROXY:
        case CURLE_COULDNT_CONNECT:
        case CURLE_SEND_ERROR:
        case CURLE_RECV_ERROR:
        case CURLE_GOT_NOTHING:
            return 2;
        case CURLE_OPERATION_TIMEDOUT:
            return 3;
        case CURLE_SSL_CONNECT_ERROR:
        case CURLE_PEER_FAILED_VERIFICATION:
#if LIBCURL_VERSION_NUM < 0x073e00
        case CURLE_SSL_CACERT:
#endif
        case CURLE_SSL_CERTPROBLEM:
        case CURLE_SSL_CIPHER:
        case CURLE_SSL_CACERT_BADFILE:
            return 4;
        default:
            return 6;
    }
}

// One GET that follows redirects, HTTPS only past the first request (milestone 52: a
// release file on GitHub answers with a redirect to its storage). No header but the
// User-Agent, no cookie, nothing else sent. Same return codes as `request`.
inline int get_following(const std::string& url, std::int64_t connect_ms, std::int64_t total_ms,
                         std::int64_t max_bytes, std::int64_t& status, std::vector<std::uint8_t>& out,
                         std::string& err) {
    global_init();
    status = 0;
    out.clear();
    CURL* curl = curl_easy_init();
    if (!curl) {
        err = "could not start an HTTP request";
        return 6;
    }
    Sink sink{&out, static_cast<std::size_t>(max_bytes), false};
    char errbuf[CURL_ERROR_SIZE];
    errbuf[0] = 0;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
#if LIBCURL_VERSION_NUM >= 0x075500
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS_STR, "https");
#else
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
    curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
#endif
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, static_cast<long>(connect_ms));
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, static_cast<long>(total_ms));
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, on_body);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &sink);
    curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, errbuf);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "flint");
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    CURLcode rc = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    curl_easy_cleanup(curl);
    status = code;
    if (rc == CURLE_OK) return 0;
    if (sink.over) {
        err = "the answer was larger than expected";
        return 5;
    }
    err = errbuf[0] ? std::string(errbuf) : std::string(curl_easy_strerror(rc));
    switch (rc) {
        case CURLE_COULDNT_RESOLVE_HOST:
        case CURLE_COULDNT_RESOLVE_PROXY:
        case CURLE_COULDNT_CONNECT:
        case CURLE_SEND_ERROR:
        case CURLE_RECV_ERROR:
        case CURLE_GOT_NOTHING:
            return 2;
        case CURLE_OPERATION_TIMEDOUT:
            return 3;
        case CURLE_SSL_CONNECT_ERROR:
        case CURLE_PEER_FAILED_VERIFICATION:
#if LIBCURL_VERSION_NUM < 0x073e00
        case CURLE_SSL_CACERT:
#endif
        case CURLE_SSL_CERTPROBLEM:
        case CURLE_SSL_CIPHER:
        case CURLE_SSL_CACERT_BADFILE:
            return 4;
        default:
            return 6;
    }
}

// The self-update's package (milestone 53): `url` streamed to the file `path`, at most
// `max_bytes`, HTTPS-only redirects as get_following. A connect deadline, and a stall
// deadline instead of a total one (a package may take minutes on a slow link, never a
// silent one): below 1 byte/s for `stall_ms` ends it. The bytes received so far are in
// download_received(), read by the app's update loop from another thread. Returns as
// get_following; 7 when the file cannot be written.
inline std::atomic<std::int64_t>& download_received() {
    static std::atomic<std::int64_t> n{0};
    return n;
}

struct FileSink {
    std::FILE* f;
    std::size_t max_bytes;
    std::size_t got;
    bool over;
    bool bad;
};

inline std::size_t on_file_body(char* data, std::size_t size, std::size_t n, void* user) {
    auto* s = static_cast<FileSink*>(user);
    std::size_t len = size * n;
    if (s->got + len > s->max_bytes) {
        s->over = true;
        return 0;
    }
    if (std::fwrite(data, 1, len, s->f) != len) {
        s->bad = true;
        return 0;
    }
    s->got += len;
    download_received().store(static_cast<std::int64_t>(s->got));
    return len;
}

inline int download_to_file(const std::string& url, std::int64_t connect_ms, std::int64_t stall_ms,
                            std::int64_t max_bytes, const std::string& path, std::int64_t& status,
                            std::string& err) {
    global_init();
    status = 0;
    download_received().store(0);
    std::FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) {
        err = "cannot write the download";
        return 7;
    }
    CURL* curl = curl_easy_init();
    if (!curl) {
        std::fclose(f);
        err = "could not start an HTTP request";
        return 6;
    }
    FileSink sink{f, static_cast<std::size_t>(max_bytes), 0, false, false};
    char errbuf[CURL_ERROR_SIZE];
    errbuf[0] = 0;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
#if LIBCURL_VERSION_NUM >= 0x075500
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS_STR, "https");
#else
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
    curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
#endif
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, static_cast<long>(connect_ms));
    curl_easy_setopt(curl, CURLOPT_LOW_SPEED_LIMIT, 1L);
    curl_easy_setopt(curl, CURLOPT_LOW_SPEED_TIME, static_cast<long>((stall_ms + 999) / 1000));
    curl_easy_setopt(curl, CURLOPT_FAILONERROR, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, on_file_body);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &sink);
    curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, errbuf);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "flint");
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    CURLcode rc = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    curl_easy_cleanup(curl);
    bool closed = std::fclose(f) == 0;
    status = code;
    if (rc == CURLE_OK) {
        if (!closed) {
            err = "cannot write the download";
            return 7;
        }
        return 0;
    }
    if (sink.over) {
        err = "the download was larger than the release says";
        return 5;
    }
    if (sink.bad) {
        err = "cannot write the download";
        return 7;
    }
    if (rc == CURLE_HTTP_RETURNED_ERROR) return 0;
    err = errbuf[0] ? std::string(errbuf) : std::string(curl_easy_strerror(rc));
    switch (rc) {
        case CURLE_COULDNT_RESOLVE_HOST:
        case CURLE_COULDNT_RESOLVE_PROXY:
        case CURLE_COULDNT_CONNECT:
        case CURLE_SEND_ERROR:
        case CURLE_RECV_ERROR:
        case CURLE_GOT_NOTHING:
        case CURLE_PARTIAL_FILE:
            return 2;
        case CURLE_OPERATION_TIMEDOUT:
            return 3;
        case CURLE_SSL_CONNECT_ERROR:
        case CURLE_PEER_FAILED_VERIFICATION:
            return 4;
        default:
            return 6;
    }
}

}  // namespace flint_remote
