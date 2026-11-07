// CFIRE-UPSTREAM: CF-026, CF-031
//
// The shared cell behind LockedVaultStore (src/adapters/vault/locked.cf): the open
// SQLCipher handle plus a recursive mutex, shared by every copy of the store so the
// GUI's UI thread and its session workers use one connection in turn. cfire has no
// mutex type (CF-026) and no top-level cpp block for this struct (CF-031).
#pragma once
#include <mutex>

struct sqlite3;

namespace flint_vault {

struct VaultCell {
    std::recursive_mutex mtx;
    sqlite3* handle = nullptr;
};

} // namespace flint_vault

#include <algorithm>
#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

namespace flint_vault {

// CFIRE-UPSTREAM: CF-026
// The unlocked vault of a program with several threads (the GUI's UI thread, its
// unlock and create workers, and the socket server): which vault is open and its
// secrets key, shared by every copy of the holder. `mtx` guards the fields for one
// read or write and is never held for long, so the UI thread never waits on it.
// `op` is held for a whole operation that must not see the vault change under it
// (an unlock, a vault switch, a command served over the socket).
struct SessionCell {
    std::mutex mtx;
    std::recursive_mutex op;
    bool unlocked = false;
    std::string path;
    std::string name;
    std::string id;
    std::vector<std::byte> secrets_key;
    bool cached = false;
    // Access state of the app (D-042), also under `mtx`: when someone last used it,
    // the unlock a CLI asked for and who asked, and the vaults locked in this run,
    // which open again only with the master password, never from the keychain.
    int64_t last_activity_ms = 0;
    std::string ask_path;
    std::string ask_caller;
    std::vector<std::string> relocked;
    std::string lock_after;
    bool quitting = false;

    void wipe() {
        std::fill(secrets_key.begin(), secrets_key.end(), std::byte{0});
        secrets_key.clear();
        path.clear();
        name.clear();
        id.clear();
        cached = false;
        unlocked = false;
    }
};

} // namespace flint_vault
