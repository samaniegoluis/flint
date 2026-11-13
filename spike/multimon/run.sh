#!/usr/bin/env bash
# Throwaway spike (milestone 38): build and run the multi-monitor spike from this folder.
set -euo pipefail
cd "$(dirname "$0")"
os=darwin; [ "$(uname)" = Linux ] && os=linux
export PKG_CONFIG_PATH="$PWD/pkgconfig/$os${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
cfire build
[ "${1:-}" = build ] && exit 0
if [ "$os" = darwin ]; then exec ./build/flint-multimon-spike.app/Contents/MacOS/flint-multimon-spike; else exec ./build/flint-multimon-spike; fi
