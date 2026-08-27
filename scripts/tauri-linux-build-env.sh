#!/usr/bin/env bash

# Keep Linux release builds within the memory envelope of developer machines
# and hosted runners. The main Tauri crate is large enough that a stale
# CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 override creates one oversized LLVM
# module and can make the kernel kill rustc with SIGKILL.
#
# These values deliberately override the caller's environment: Cargo profile
# environment variables take precedence over Cargo.toml, so merely declaring
# codegen-units = 4 in the manifest is not sufficient.
export CARGO_BUILD_JOBS=1
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4
