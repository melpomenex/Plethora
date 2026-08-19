/**
 * Listening Session Inbox & Capture Review Surface
 * 
 * Rapid triage modal for extracts, bookmarks, and confusing passages
 * captured hands-free during listening sessions.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Check,
  Trash,
  Cards,
  ChatCircleText,
  BookmarkSimple,
  Question,
  NotePencil,
  Sparkle,
  Clock,
  SpeakerHigh,
  CheckCircle,
} from "@phosphor-icons/react";
import type { ListeningSession, ListeningSessionItem } from "../../types/audioEdition";
import {
  listListeningSessions,
  getListeningSession,
  markListeningSessionReviewed,
  updateListeningSessionItem,
  deleteListeningSessionItem,
} from "../../api/listeningSessions";
import { createLearningItem } from "../../api/learning-items";
import { deleteExtract } from "../../api/extracts";
import { formatAudioDuration } from "../../utils/audioEditionEstimation";
import { useToast } from "../common/Toast";

interface ListeningSessionInboxProps {
  isOpen: boolean;
  onClose: () => void;
  onAskPlethora?: (passage: string) => void;
}

export function ListeningSessionInbox({
  isOpen,
  onClose,
  onAskPlethora,
}: ListeningSessionInboxProps) {
  const toast = useToast();
  const [sessions, setSessions] = useState<ListeningSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeNoteItemId, setActiveNoteItemId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const loadSessions = useCallback(async () => {
    try {
      const unreviewed = await listListeningSessions(true);
      const detailed: ListeningSession[] = [];

      for (const s of unreviewed) {
        const full = await getListeningSession(s.id);
        if (full) detailed.push(full);
      }

      setSessions(detailed);
      if (detailed.length > 0 && !selectedSessionId) {
        setSelectedSessionId(detailed[0].id);
      }
    } catch (err) {
      console.warn("Failed to load listening sessions:", err);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (isOpen) {
      void loadSessions();
    }
  }, [isOpen, loadSessions]);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null;

  // Actions
  const handleKeep = async (item: ListeningSessionItem) => {
    await updateListeningSessionItem(item.id, { note: item.note });
    toast.success("Extract kept in library");
    await loadSessions();
  };

  const handleSaveNote = async (itemId: string) => {
    await updateListeningSessionItem(itemId, { note: noteText.trim() || null });
    setActiveNoteItemId(null);
    setNoteText("");
    toast.success("Note saved");
    await loadSessions();
  };

  const handleCreateFlashcard = async (item: ListeningSessionItem) => {
    try {
      await createLearningItem({
        document_id: selectedSession?.editionId || "",
        extract_id: item.extractId || undefined,
        item_type: "Qa",
        question: `What is the key insight from this passage?\n\n"${item.snippetText.slice(0, 180)}..."`,
        answer: item.snippetText,
        tags: ["audio-capture", "hands-free"],
      });

      toast.success("Created flashcard");
      await loadSessions();
    } catch (err) {
      console.error("Failed to create card:", err);
      toast.error("Failed to create flashcard");
    }
  };

  const handleDiscard = async (item: ListeningSessionItem) => {
    try {
      if (item.extractId) {
        await deleteExtract(item.extractId);
      }
      await deleteListeningSessionItem(item.id);
      toast.info("Item discarded");
      await loadSessions();
    } catch (err) {
      console.error("Failed to discard item:", err);
    }
  };

  const handleCompleteSession = async (sessionId: string) => {
    await markListeningSessionReviewed(sessionId, true);
    toast.success("Session marked as reviewed");
    await loadSessions();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="bg-card text-card-foreground border border-border w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col h-[85vh] animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <SpeakerHigh size={22} weight="bold" />
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-tight">
                Listening Session Inbox
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Triage hands-free captures, extracts, and confusion markers from your audio sessions.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body (Master / Detail Layout) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sessions Sidebar */}
          <div className="w-1/3 border-r border-border overflow-y-auto bg-muted/10 p-3 space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
              Unreviewed Sessions ({sessions.length})
            </span>

            {sessions.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground italic">
                No unreviewed listening sessions.
              </div>
            )}

            {sessions.map((s) => {
              const isSelected = s.id === selectedSession?.id;
              const dateStr = new Date(s.startedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    isSelected
                      ? "bg-card border-primary ring-1 ring-primary/20 shadow-sm"
                      : "bg-background/50 border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{dateStr}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      {s.items?.length || 0} captures
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1.5">
                    <Clock size={12} />
                    <span>{formatAudioDuration(s.durationSeconds)} listened</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Captures Detail List */}
          <div className="flex-1 flex flex-col overflow-hidden bg-card">
            {selectedSession ? (
              <>
                <div className="p-4 border-b border-border/80 bg-muted/20 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold">
                      Session Captures ({selectedSession.items?.length || 0})
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Started: {new Date(selectedSession.startedAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleCompleteSession(selectedSession.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
                  >
                    <CheckCircle size={14} weight="bold" />
                    <span>Mark Reviewed</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {selectedSession.items?.length === 0 && (
                    <div className="p-8 text-center text-xs text-muted-foreground italic">
                      No captures recorded during this session.
                    </div>
                  )}

                  {selectedSession.items?.map((item) => {
                    const isNoteEditing = activeNoteItemId === item.id;

                    return (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl border bg-card border-border shadow-sm hover:border-primary/40 transition-all"
                      >
                        {/* Marker Badge & Timestamp */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            {item.markerType === "extract" && (
                              <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-500 font-medium">
                                <Sparkle size={12} weight="fill" />
                                Smart Extract
                              </span>
                            )}
                            {item.markerType === "bookmark" && (
                              <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 font-medium">
                                <BookmarkSimple size={12} weight="fill" />
                                Bookmark
                              </span>
                            )}
                            {item.markerType === "confusing" && (
                              <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-500 font-medium">
                                <Question size={12} weight="bold" />
                                Confusing / Needs Review
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {formatAudioDuration(item.audioTimestamp)}
                          </span>
                        </div>

                        {/* Passage Content */}
                        <p className="text-xs leading-relaxed text-foreground bg-muted/20 p-3 rounded-lg border border-border/40 mb-3 font-serif">
                          “{item.snippetText}”
                        </p>

                        {/* User Note Display */}
                        {item.note && !isNoteEditing && (
                          <div className="text-xs text-muted-foreground bg-primary/5 border border-primary/20 p-2.5 rounded-lg mb-3 flex items-start gap-2">
                            <NotePencil size={14} className="text-primary mt-0.5 shrink-0" />
                            <span>{item.note}</span>
                          </div>
                        )}

                        {/* Inline Note Editor */}
                        {isNoteEditing && (
                          <div className="space-y-2 mb-3">
                            <textarea
                              rows={2}
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              placeholder="Add personal note or summary..."
                              className="w-full text-xs p-2 rounded-lg border border-input bg-background focus:ring-1 focus:ring-primary"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setActiveNoteItemId(null)}
                                className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSaveNote(item.id)}
                                className="px-3 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground"
                              >
                                Save Note
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Triage Actions Bar */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/40">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleKeep(item)}
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Check size={13} />
                              <span>Keep Extract</span>
                            </button>

                            <button
                              onClick={() => {
                                setActiveNoteItemId(item.id);
                                setNoteText(item.note || "");
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <NotePencil size={13} />
                              <span>{item.note ? "Edit Note" : "Add Note"}</span>
                            </button>

                            <button
                              onClick={() => handleCreateFlashcard(item)}
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md hover:bg-muted text-purple-500 hover:text-purple-600 transition-colors"
                            >
                              <Cards size={13} />
                              <span>Turn into Flashcard</span>
                            </button>

                            {onAskPlethora && (
                              <button
                                onClick={() => {
                                  onAskPlethora(item.snippetText);
                                  onClose();
                                }}
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md hover:bg-muted text-blue-500 hover:text-blue-600 transition-colors"
                              >
                                <ChatCircleText size={13} />
                                <span>Ask Plethora</span>
                              </button>
                            )}
                          </div>

                          <button
                            onClick={() => handleDiscard(item)}
                            className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                            title="Discard capture"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground italic">
                Select a session from the sidebar to review captures.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
