//! Cactus Compute Mirage Vision Engine integration.

pub mod cactus_ffi;
pub mod mirage;
pub mod search_worker;
pub mod spatial_pairing;
pub mod types;

pub use mirage::{crop_rgb_bbox_to_png, decode_image_to_rgb, MirageBackend, MirageEngine, MockMirageBackend, RgbImageBuffer};
pub use types::{
    bbox_1000_to_percent, polygon_1000_to_percent, to_percent_occlusion_region, MirageObject,
    MirageRelation, MirageRequestOptions, MirageResponse, MirageSection, MirageStatus,
    MirageTextBlock, NormalizedBBox, PercentOcclusionRegion, Point2D,
};
