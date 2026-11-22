//! Integrity pins for the Laya checkpoint Plethora serves locally.

pub const TYPED_DECISIONS_REPO: &str = "convaiinnovations/laya-typed-decisions";
pub const TYPED_DECISIONS_REVISION: &str = "3903ff997712bd73ccb2dc879262dac8f0d443bb";

/// Required files and their SHA-256 at `TYPED_DECISIONS_REVISION`.
///
/// Hugging Face publishes an LFS digest for the large weights, but not for the
/// small Git blobs. These local pins let Plethora verify the complete checkpoint
/// while keeping the installer fail-closed.
pub const TYPED_DECISIONS_FILES: &[(&str, &str)] = &[
    (
        "model.safetensors",
        "4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e",
    ),
    (
        "config.json",
        "7add7c041b53f7091e65908553af79ab3f077946e5f2312d510ae13b17c7c134",
    ),
    (
        "rl_agent_config.json",
        "ebf0cd524d92342a6be5e48e9fca3d7c2babfb5a56ccd79d2171ef5d8c7f7be8",
    ),
    (
        "encoder/config.json",
        "5268d24ad3b77c8151de5dcb0762ba4391619aad9ab0bda33e36fb083cfeae6d",
    ),
    (
        "tokenizer/tokenizer.json",
        "6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30",
    ),
    (
        "tokenizer/tokenizer_config.json",
        "08d4cf3ac4dca381759441b85b91a6d40e688471dcd33d15d6649eb0a9a854d1",
    ),
];
