/**
 * Bidirectional Reading/Listening Position Synchronization Hook
 * 
 * Maps audio playback timestamps to document reading anchors (CFI, char offset, page)
 * and vice versa, supporting synchronized read-along highlighting and 3-tier confidence mapping.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { AudioEdition, AudioEditionSection, AudioEditionAnchor } from "../types/audioEdition";
import {
  getAudioEditionByDocument,
  getAudioEditionSections,
  getAudioEditionAnchors,
} from "../api/audioEditions";
import { resolveAnchorAtTimestamp } from "../utils/audioEditionAnchors";

export type AlignmentConfidence = "high" | "medium" | "low";

export interface AudioEditionSyncState {
  hasAudioEdition: boolean;
  edition: AudioEdition | null;
  sections: AudioEditionSection[];
  currentSectionIndex: number;
  currentSection: AudioEditionSection | null;
  currentPlaybackSec: number;
  activeAnchor: AudioEditionAnchor | null;
  confidence: AlignmentConfidence;
  isReadAlongActive: boolean;

  // Actions
  setPlaybackPosition: (sectionIndex: number, timestampSec: number) => void;
  seekToSourceAnchor: (sourceAnchor: string) => { sectionIndex: number; audioSec: number } | null;
  toggleReadAlong: (enabled?: boolean) => void;
  refreshEdition: () => Promise<void>;
}

export function useAudioEditionSync(documentId?: string): AudioEditionSyncState {
  const [edition, setEdition] = useState<AudioEdition | null>(null);
  const [sections, setSections] = useState<AudioEditionSection[]>([]);
  const [anchorsBySection, setAnchorsBySection] = useState<Record<string, AudioEditionAnchor[]>>({});
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [currentPlaybackSec, setCurrentPlaybackSec] = useState(0);
  const [activeAnchor, setActiveAnchor] = useState<AudioEditionAnchor | null>(null);
  const [confidence, setConfidence] = useState<AlignmentConfidence>("high");
  const [isReadAlongActive, setIsReadAlongActive] = useState(true);

  // Load edition and sections
  const loadEdition = useCallback(async () => {
    if (!documentId) {
      setEdition(null);
      setSections([]);
      return;
    }

    try {
      const ed = await getAudioEditionByDocument(documentId);
      if (!ed) {
        setEdition(null);
        setSections([]);
        return;
      }

      setEdition(ed);
      const secs = await getAudioEditionSections(ed.id);
      setSections(secs);

      // Pre-load anchors for all sections
      const anchorMap: Record<string, AudioEditionAnchor[]> = {};
      for (const s of secs) {
        const anchors = await getAudioEditionAnchors(s.id);
        anchorMap[s.id] = anchors;
      }
      setAnchorsBySection(anchorMap);
    } catch (err) {
      console.warn("Failed to load audio edition sync data:", err);
    }
  }, [documentId]);

  useEffect(() => {
    void loadEdition();
  }, [loadEdition]);

  const currentSection = sections[currentSectionIndex] || null;

  // Set playback position and resolve active anchor
  const setPlaybackPosition = useCallback(
    (sectionIndex: number, timestampSec: number) => {
      setCurrentSectionIndex(sectionIndex);
      setCurrentPlaybackSec(timestampSec);

      const sec = sections[sectionIndex];
      if (!sec) {
        setActiveAnchor(null);
        setConfidence("low");
        return;
      }

      const anchors = anchorsBySection[sec.id] || [];
      if (anchors.length > 0) {
        const matched = resolveAnchorAtTimestamp(anchors, timestampSec);
        setActiveAnchor(matched);
        setConfidence("high");
      } else {
        // Fallback: medium confidence section interpolation
        setActiveAnchor(null);
        setConfidence("medium");
      }
    },
    [sections, anchorsBySection]
  );

  // Seek from visual document location to audio timestamp
  const seekToSourceAnchor = useCallback(
    (sourceAnchor: string): { sectionIndex: number; audioSec: number } | null => {
      if (!sections.length) return null;

      const numericAnchor = parseInt(sourceAnchor.replace(/\D/g, ""), 10);

      for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const sec = sections[sIdx];
        const anchors = anchorsBySection[sec.id] || [];

        // Exact anchor search
        for (const anc of anchors) {
          if (
            anc.sourceStartAnchor === sourceAnchor ||
            (anc.sourceStartAnchor && anc.sourceEndAnchor &&
             !isNaN(numericAnchor) &&
             numericAnchor >= parseInt(anc.sourceStartAnchor, 10) &&
             numericAnchor <= parseInt(anc.sourceEndAnchor, 10))
          ) {
            setPlaybackPosition(sIdx, anc.audioStartSec);
            return { sectionIndex: sIdx, audioSec: anc.audioStartSec };
          }
        }
      }

      // Fallback: check section-level sourceStartAnchor
      for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const sec = sections[sIdx];
        if (sec.sourceStartAnchor && sec.sourceStartAnchor === sourceAnchor) {
          setPlaybackPosition(sIdx, 0);
          return { sectionIndex: sIdx, audioSec: 0 };
        }
      }

      return null;
    },
    [sections, anchorsBySection, setPlaybackPosition]
  );

  const toggleReadAlong = useCallback((enabled?: boolean) => {
    setIsReadAlongActive((prev) => (enabled !== undefined ? enabled : !prev));
  }, []);

  return {
    hasAudioEdition: Boolean(edition),
    edition,
    sections,
    currentSectionIndex,
    currentSection,
    currentPlaybackSec,
    activeAnchor,
    confidence,
    isReadAlongActive,
    setPlaybackPosition,
    seekToSourceAnchor,
    toggleReadAlong,
    refreshEdition: loadEdition,
  };
}
