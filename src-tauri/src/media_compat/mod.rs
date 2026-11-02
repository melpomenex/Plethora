//! Local media compatibility: inspection, capability, planning, jobs, and cache.
//!
//! The byte-serving path remains [`crate::media_server`]; this module owns the
//! metadata/capability/recovery layer around it.

pub mod capabilities;
pub mod cache;
pub mod commands;
pub mod decision;
pub mod ffmpeg;
pub mod jobs;
pub mod probe;
pub mod transport;
pub mod types;

pub use types::{MediaCompatError, MediaFailureCode};
