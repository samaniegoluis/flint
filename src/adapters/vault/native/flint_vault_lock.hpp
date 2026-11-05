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
