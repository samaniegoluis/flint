#!/usr/bin/env bash
# CF-222: fixed when cfire refuses the bare private names (or asks to qualify them);
# open while the suite passes and the import is called unused.
cd "$(dirname "$0")" && rm -rf .cfire
cfire test --no-cache . 2>&1 | grep -E 'PASS \(|FAIL|private to package|undeclared|unused import'
