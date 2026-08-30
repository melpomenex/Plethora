#!/usr/bin/env bash
# Back-compat shim — use cargo-build-accelerators.sh.
# shellcheck source=scripts/cargo-build-accelerators.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cargo-build-accelerators.sh"
