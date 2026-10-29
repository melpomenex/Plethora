//! The first supported LFM3 audio pair. Backend choice is independent of weights.
use super::adapters::{
    Artifact, ArtifactFile, DetectionConfidence, HfRuntime, RunContract, RuntimeAdapter,
};
use super::hf_client::{FileIndex, HfRepoInfo};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const REPO: &str = "LiquidAI/LFM3-Audio-2B-GGUF";
pub const REVISION: &str = "642697a5597a675cb819ed236ac415c1e60a4f6f";
pub const BACKBONE: &str = "LFM3-Audio-2B-Q4_K_M.gguf";
pub const PROJECTOR: &str = "mmproj-LFM3-Audio-2B-Q8_0.gguf";
pub const FILES: &[(&str, u64, &str)] = &[
    (
        BACKBONE,
        1_099_626_016,
        "9a773289bd321ed879cd3a76545f6aca506e403851a45fb315420aee45625be2",
    ),
    (
        PROJECTOR,
        337_862_080,
        "26601e904245a85bd8f3cf320a629e897cfc01c1d09369e8b4fd951f13024d3e",
    ),
    (
        "LICENSE",
        10_574,
        "4d28ca14dedc0b3d0fcc2b3339f0e79931faa33874f3d24f522183a8fc70068c",
    ),
];

pub struct Lfm3AudioAdapter;

impl RuntimeAdapter for Lfm3AudioAdapter {
    fn runtime(&self) -> HfRuntime {
        HfRuntime::LlamaCppTts
    }
    fn id(&self) -> &'static str {
        "llama-cpp-tts"
    }
    fn label(&self) -> &'static str {
        "LFM3 Audio (llama.cpp)"
    }
    fn required_metadata(&self) -> Vec<&'static str> {
        vec!["LICENSE"]
    }
    fn install_dir(&self, root: &Path) -> PathBuf {
        root.join("models/llama-cpp-tts")
    }
    fn detect_artifact(&self, info: &HfRepoInfo, index: &FileIndex) -> Option<Artifact> {
        if info.id != REPO || info.sha.as_deref() != Some(REVISION) {
            return None;
        }
        for (name, size, sha) in &FILES[..2] {
            if index.size_of(name) != Some(*size) || index.sha_of(name).as_deref() != Some(*sha) {
                return None;
            }
        }
        let files: Vec<_> = FILES
            .iter()
            .map(|(name, size, sha)| ArtifactFile {
                path: (*name).into(),
                size: Some(*size),
                sha256: Some((*sha).into()),
            })
            .collect();
        Some(Artifact {
            runtime: self.runtime(),
            kind: "lfm3-audio".into(),
            label: "LFM3 Audio 2B · Q4_K_M + Q8_0 audio projector".into(),
            download_size_bytes: files.iter().filter_map(|f| f.size).sum(),
            files,
            run_contract: RunContract::Lfm3AudioTts {
                model_file: BACKBONE.into(),
                projector_file: PROJECTOR.into(),
                revision: REVISION.into(),
            },
            estimated_memory_bytes: 3 * 1024 * 1024 * 1024,
            confidence: DetectionConfidence::Exact,
            metadata: BTreeMap::from([
                ("family".into(), "lfm3".into()),
                ("license_name".into(), "LFM Open License v1.0".into()),
            ]),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::hf::hf_client::{HfFile, HfLfsInfo};
    fn fixture() -> (HfRepoInfo, FileIndex) {
        let info: HfRepoInfo = serde_json::from_value(serde_json::json!({
            "id": REPO, "sha": REVISION,
            "siblings": FILES.iter().map(|(name, size, sha)| serde_json::json!({
                "rfilename": name, "size": size, "lfs": {"sha256": sha, "size": size}
            })).collect::<Vec<_>>()
        }))
        .unwrap();
        let index = FileIndex {
            files: info.siblings.clone(),
            metadata: Default::default(),
        };
        (info, index)
    }
    #[test]
    fn exact_complete_pair_contains_both_weights_and_license() {
        let (info, index) = fixture();
        let artifact = Lfm3AudioAdapter.detect_artifact(&info, &index).unwrap();
        assert_eq!(artifact.files.len(), 3);
        assert_eq!(artifact.download_size_bytes, 1_437_498_670);
        assert!(artifact.run_contract.validate().is_ok());
        assert!(artifact.run_contract.paths_contained());
    }
    #[test]
    fn wrong_revision_missing_projector_and_corrupt_pair_are_not_detected() {
        let (mut info, mut index) = fixture();
        info.sha = Some("different".into());
        assert!(Lfm3AudioAdapter.detect_artifact(&info, &index).is_none());
        info.sha = Some(REVISION.into());
        index.files.retain(|f| f.rfilename != PROJECTOR);
        assert!(Lfm3AudioAdapter.detect_artifact(&info, &index).is_none());
        index.files.push(HfFile {
            rfilename: PROJECTOR.into(),
            size: Some(FILES[1].1),
            lfs: Some(HfLfsInfo {
                sha256: Some("wrong".into()),
                size: Some(FILES[1].1),
            }),
        });
        assert!(Lfm3AudioAdapter.detect_artifact(&info, &index).is_none());
    }
    #[test]
    fn contract_refuses_foreign_and_missing_paths() {
        let contract = RunContract::Lfm3AudioTts {
            model_file: BACKBONE.into(),
            projector_file: "../foreign.gguf".into(),
            revision: REVISION.into(),
        };
        assert!(contract.validate().is_err());
        assert!(!contract.paths_contained());
    }
}
