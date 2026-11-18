// CFIRE-UPSTREAM: CF-160
//
// The SQLCipher handle as .cf code holds it. cfire 0.12 keeps raw pointer types out
// of .cf (cfire/RAW-POINTER), so a field or a local names this opaque type and every
// use stays inside a cpp block. It is the plain pointer, copied as before; the store's
// close() still frees it.
#pragma once

struct sqlite3;

namespace flint_db {
using Db = sqlite3*;
}  // namespace flint_db
