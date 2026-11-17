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
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

namespace flint_remote {

struct Sink {
    std::vector<std::byte>* out;
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
    const auto* p = reinterpret_cast<const std::byte*>(data);
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
                   const std::vector<std::byte>& body, std::int64_t connect_ms, std::int64_t total_ms,
                   std::int64_t max_bytes, std::int64_t& status, std::string& etag, std::string& vault_id,
                   std::vector<std::byte>& out, std::string& err) {
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
    if (method == "PUT") {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
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

}  // namespace flint_remote
