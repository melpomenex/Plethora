//! Data models for Incrementum

pub mod category;
pub mod collection;
pub mod document;
pub mod extract;
pub mod image_asset;
pub mod learning_item;
pub mod playlist;
pub mod position;
pub mod queue;
pub mod reading_goal;
pub mod tag;
pub mod transcription_queue;
pub mod video_extract;

pub use category::Category;
pub use collection::{Collection, DEFAULT_COLLECTION_ID};
pub use document::{Document, DocumentImageAsset, DocumentMetadata, FileType};
pub use extract::Extract;
pub use image_asset::{ImageAsset, ImageAssetWithUsage};
pub use learning_item::{ItemState, ItemType, LearningItem, MemoryState, ReviewRating};
pub use playlist::{PlaylistSettings, PlaylistSubscription, PlaylistVideo};
pub use position::{Bookmark, DailyReadingStats, DocumentPosition, ReadingSession};
pub use queue::QueueItem;
pub use reading_goal::{
    Achievement, AchievementCategory, GoalProgress, GoalType, ReadingGoal, ReadingStreak,
};
pub use tag::{
    TASConfig, TASInterferenceConfig, TASPrerequisiteConfig, TASScheduledItem, Tag,
    TagStabilityStats,
};
pub use transcription_queue::{
    TranscriptionJobStatus, TranscriptionQueueEntry, TranscriptionQueueEntryWithDoc,
};
pub use video_extract::VideoExtract;
pub mod podcast;
pub use podcast::{
    ParsedPodcastEpisode, ParsedPodcastFeed, PodcastEpisode, PodcastFeed, PodcastFeedResponse,
    PodcastSearchResponse, PodcastSearchResult,
};
