#!/usr/bin/env bash
# Back-compat shim.
# shellcheck source=scripts/native-build-profile.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/native-build-profile.sh"

linux_build_profile_report() {
  native_build_profile_report linux "$@"
}
