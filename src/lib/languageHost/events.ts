import type { LanguageHostActionName, LanguageHostSource } from "./types";
import type { SourceAnchor } from "../../types/languageLexicon";
import type { PracticeMode } from "../languagePractice";

export const LANGUAGE_HOST_ACTION_EVENT = "plethora-language-host-action";

export interface LanguageHostActionDetail {
  action: LanguageHostActionName;
  hostId: string;
  source: LanguageHostSource;
  sourceAnchor: SourceAnchor;
  selectedText?: string;
  profileId?: string;
  languageTag?: string;
  practiceMode?: PracticeMode;
  origin: "reader" | "video" | "tutor" | "practice";
}

export function dispatchLanguageHostAction(detail: LanguageHostActionDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LanguageHostActionDetail>(LANGUAGE_HOST_ACTION_EVENT, { detail }));
}
