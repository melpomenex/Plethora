import { v4 as uuidv4 } from "uuid";
import type {
  LanguageDictionaryEntryRecord,
  LanguagePackRecord,
} from "../api/languagePacks";
import type {
  LanguageAnalyticsDailyRecord,
  LanguageAudioAlignmentRecord,
  LanguageCoverageResultRecord,
  LanguageGeneratedDocumentRecord,
  LanguagePhraseRecord,
  LanguageRecommendationCandidateRecord,
  LanguageSrsDraftRecord,
  LanguageTranslationCacheRecord,
} from "../api/languageEcosystem";
import type {
  LanguageKnowledgeEvidenceEvent,
  LanguageKnowledgeExport,
  LanguageKnowledgeStateSnapshot,
  LanguageMemorizationLink,
} from "../types/languageKnowledge";
import type {
  LanguageLexicalEntry,
  LanguageLookupEvent,
  LanguageSurfaceForm,
  LexiconPage,
} from "../types/languageLexicon";

type CommandHandler = (args: Record<string, unknown>) => Promise<unknown>;

const PRACTICE_KEY = "plethora-language-practice-v1";
const ECOSYSTEM_KEY = "plethora-language-ecosystem-v1";
const PACKS_KEY = "plethora-language-packs-v1";
const LEXICON_KEY = "plethora-language-lexicon-v1";
const KNOWLEDGE_KEY = "plethora-language-knowledge-v1";
const PROFILES_KEY = "plethora-language-profiles-v1";

interface BrowserEcosystemState {
  phrases: LanguagePhraseRecord[];
  srsDrafts: LanguageSrsDraftRecord[];
  alignments: LanguageAudioAlignmentRecord[];
  coverage: LanguageCoverageResultRecord[];
  recommendations: LanguageRecommendationCandidateRecord[];
  analyticsEvents: Array<{ idempotencyKey: string; profileId: string; eventKind: string; payload: unknown; occurredAt: number }>;
  analyticsDaily: LanguageAnalyticsDailyRecord[];
  generatedDocs: LanguageGeneratedDocumentRecord[];
  translationCache: LanguageTranslationCacheRecord[];
  processingJobs: Record<string, unknown>;
  processingChunks: Record<string, unknown[]>;
  processingResults: Record<string, unknown>;
}

interface BrowserPacksState {
  packs: LanguagePackRecord[];
  entries: LanguageDictionaryEntryRecord[];
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage quota or private mode.
  }
}

function page<T>(items: T[], offset = 0, limit = 50): LexiconPage<T> {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  return {
    items: items.slice(safeOffset, safeOffset + safeLimit),
    offset: safeOffset,
    limit: safeLimit,
    total: items.length,
    hasMore: safeOffset + safeLimit < items.length,
  };
}

function readPractice(): any[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRACTICE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePractice(items: any[]): void {
  writeJson(PRACTICE_KEY, items);
}

function readEcosystem(): BrowserEcosystemState {
  return readJson<BrowserEcosystemState>(ECOSYSTEM_KEY, {
    phrases: [],
    srsDrafts: [],
    alignments: [],
    coverage: [],
    recommendations: [],
    analyticsEvents: [],
    analyticsDaily: [],
    generatedDocs: [],
    translationCache: [],
    processingJobs: {},
    processingChunks: {},
    processingResults: {},
  });
}

function writeEcosystem(state: BrowserEcosystemState): void {
  writeJson(ECOSYSTEM_KEY, state);
}

function readPacks(): BrowserPacksState {
  return readJson<BrowserPacksState>(PACKS_KEY, { packs: [], entries: [] });
}

function writePacks(state: BrowserPacksState): void {
  writeJson(PACKS_KEY, state);
}

export function purgeBrowserLanguageProfileDerivedData(profileId: string): number {
  let removed = 0;

  const lexicon = readJson<{ entries?: any[]; occurrences?: any[]; lookups?: any[] }>(LEXICON_KEY, {});
  const nextEntries = (lexicon.entries || []).filter((e) => e.profileId !== profileId);
  const nextOccurrences = (lexicon.occurrences || []).filter((o) => o.profileId !== profileId);
  const nextLookups = (lexicon.lookups || []).filter((l) => l.profileId !== profileId);
  removed +=
    ((lexicon.entries || []).length - nextEntries.length) +
    ((lexicon.occurrences || []).length - nextOccurrences.length) +
    ((lexicon.lookups || []).length - nextLookups.length);
  writeJson(LEXICON_KEY, { entries: nextEntries, occurrences: nextOccurrences, lookups: nextLookups });

  const knowledge = readJson<{ snapshots?: any[]; history?: any[]; evidence?: any[]; links?: any[] }>(KNOWLEDGE_KEY, {});
  const nextSnaps = (knowledge.snapshots || []).filter((s) => s.profileId !== profileId);
  const nextHist = (knowledge.history || []).filter((h) => h.profileId !== profileId);
  const nextEvid = (knowledge.evidence || []).filter((e) => e.profileId !== profileId);
  const nextLinks = (knowledge.links || []).filter((l) => l.profileId !== profileId);
  removed +=
    ((knowledge.snapshots || []).length - nextSnaps.length) +
    ((knowledge.history || []).length - nextHist.length) +
    ((knowledge.evidence || []).length - nextEvid.length) +
    ((knowledge.links || []).length - nextLinks.length);
  writeJson(KNOWLEDGE_KEY, { snapshots: nextSnaps, history: nextHist, evidence: nextEvid, links: nextLinks });

  const practice = readPractice();
  const nextPractice = practice.filter((p) => p.profileId !== profileId);
  removed += practice.length - nextPractice.length;
  writePractice(nextPractice);

  const eco = readEcosystem();
  const prevEcoCount =
    eco.phrases.length +
    eco.srsDrafts.length +
    eco.alignments.length +
    eco.coverage.length +
    eco.recommendations.length +
    eco.analyticsEvents.length +
    eco.analyticsDaily.length +
    eco.generatedDocs.length +
    eco.translationCache.length;
  eco.phrases = eco.phrases.filter((x) => x.profileId !== profileId);
  eco.srsDrafts = eco.srsDrafts.filter((x) => x.profileId !== profileId);
  eco.alignments = eco.alignments.filter((x) => x.profileId !== profileId);
  eco.coverage = eco.coverage.filter((x) => x.profileId !== profileId);
  eco.recommendations = eco.recommendations.filter((x) => x.profileId !== profileId);
  eco.analyticsEvents = eco.analyticsEvents.filter((x) => x.profileId !== profileId);
  eco.analyticsDaily = eco.analyticsDaily.filter((x) => x.profileId !== profileId);
  eco.generatedDocs = eco.generatedDocs.filter((x) => x.profileId !== profileId);
  eco.translationCache = eco.translationCache.filter((x) => x.profileId !== profileId);
  const nextEcoCount =
    eco.phrases.length +
    eco.srsDrafts.length +
    eco.alignments.length +
    eco.coverage.length +
    eco.recommendations.length +
    eco.analyticsEvents.length +
    eco.analyticsDaily.length +
    eco.generatedDocs.length +
    eco.translationCache.length;
  removed += prevEcoCount - nextEcoCount;
  writeEcosystem(eco);

  return removed;
}

export function registerBrowserLanguageHandlers(handlers: Record<string, CommandHandler>): void {
  const origDeleteProfile = handlers.delete_language_profile;
  if (origDeleteProfile) {
    handlers.delete_language_profile = async (args) => {
      const report = (await origDeleteProfile(args)) as Record<string, any>;
      const removed = purgeBrowserLanguageProfileDerivedData(String(args.id || ""));
      return {
        ...report,
        removedProfileDerivedData: (Number(report?.removedProfileDerivedData) || 0) + removed,
      };
    };
  }

  handlers.unarchive_language_profile = async (args) =>
    handlers.update_language_profile({ ...args, input: { lifecycle: "active" } });

  handlers.delete_language_profile_association = async (args) => {
    const data = readJson<{ profiles?: any[]; associations?: any[]; activeProfileIds?: Record<string, string | null> }>(PROFILES_KEY, {});
    const before = (data.associations || []).length;
    data.associations = (data.associations || []).filter(
      (a) => !(a.profileId === args.profileId && a.contentType === args.contentType && a.contentId === args.contentId),
    );
    writeJson(PROFILES_KEY, data);
    return data.associations.length < before;
  };

  // --- Lexicon additions ---
  handlers.search_language_lexical_entries = async (args) => {
    const filter = (args.filter || {}) as Record<string, any>;
    const data = readJson<{ entries?: LanguageLexicalEntry[] }>(LEXICON_KEY, { entries: [] });
    const q = typeof filter.query === "string" ? filter.query.trim().toLowerCase() : "";
    const filtered = (data.entries || [])
      .filter((entry) => {
        if (entry.profileId !== filter.profileId) return false;
        if (filter.languageTag && entry.languageTag !== filter.languageTag) return false;
        if (filter.knowledgeState) {
          const state = entry.knowledgeState || "new";
          if (state !== filter.knowledgeState) return false;
        }
        if (filter.objectKind && entry.objectKind !== filter.objectKind) return false;
        if (typeof filter.ignored === "boolean" && entry.ignored !== filter.ignored) return false;
        if (filter.lemma && (entry.lemma || "").toLowerCase() !== String(filter.lemma).toLowerCase()) return false;
        if (q) {
          const hit =
            entry.normalizedForm.toLowerCase().includes(q) ||
            entry.canonicalForm.toLowerCase().includes(q) ||
            (entry.lemma || "").toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return page(filtered, filter.offset, filter.limit);
  };

  handlers.delete_language_lexical_entry = async (args) => {
    const data = readJson<{ entries?: any[]; occurrences?: any[]; lookups?: any[] }>(LEXICON_KEY, {});
    const before = (data.entries || []).length;
    data.entries = (data.entries || []).filter((e) => !(e.profileId === args.profileId && e.id === args.entryId));
    data.occurrences = (data.occurrences || []).filter((o) => !(o.profileId === args.profileId && o.lexicalEntryId === args.entryId));
    writeJson(LEXICON_KEY, data);
    return (data.entries || []).length < before;
  };

  handlers.delete_language_occurrence = async (args) => {
    const data = readJson<{ entries?: any[]; occurrences?: any[]; lookups?: any[] }>(LEXICON_KEY, {});
    const before = (data.occurrences || []).length;
    data.occurrences = (data.occurrences || []).filter((o) => !(o.profileId === args.profileId && o.id === args.occurrenceId));
    writeJson(LEXICON_KEY, data);
    return (data.occurrences || []).length < before;
  };

  handlers.purge_expired_language_occurrences = async (args) => {
    const rawNow = Number(args.now) || Math.floor(Date.now() / 1000);
    const now = rawNow > 10_000_000_000 ? Math.floor(rawNow / 1000) : rawNow;
    const data = readJson<{ entries?: any[]; occurrences?: any[]; lookups?: any[] }>(LEXICON_KEY, {});
    const before = (data.occurrences || []).length;
    data.occurrences = (data.occurrences || []).filter(
      (o) => !(o.profileId === args.profileId && o.orphanState === "orphaned" && o.retentionExpiresAt != null && o.retentionExpiresAt <= now),
    );
    writeJson(LEXICON_KEY, data);
    return before - (data.occurrences || []).length;
  };

  handlers.list_language_surface_forms = async (args) => {
    const data = readJson<{ entries?: LanguageLexicalEntry[] }>(LEXICON_KEY, { entries: [] });
    const items: LanguageSurfaceForm[] = (data.entries || [])
      .filter((e) => e.profileId === args.profileId && (!args.entryId || e.id === args.entryId))
      .map((e) => ({
        id: e.id,
        profileId: e.profileId,
        lexicalEntryId: e.id,
        languageTag: e.languageTag,
        surface: e.canonicalForm,
        normalized: e.normalizedForm,
        firstSeenAt: e.firstEncounteredAt,
        lastSeenAt: e.lastEncounteredAt,
        occurrenceCount: e.encounterCount,
      }));
    return page(items, Number(args.offset) || 0, Number(args.limit) || 50);
  };

  handlers.list_language_lookup_events = async (args) => {
    const data = readJson<{ lookups?: LanguageLookupEvent[] }>(LEXICON_KEY, { lookups: [] });
    const items = (data.lookups || []).filter((l) => l.profileId === args.profileId);
    return page(items, Number(args.offset) || 0, Number(args.limit) || 50);
  };

  handlers.import_language_lexicon = async (args) => {
    const entries = (Array.isArray(args.entries) ? args.entries : []) as LanguageLexicalEntry[];
    for (const entry of entries) {
      await handlers.upsert_language_lexical_entry({ input: { ...entry, profileId: args.profileId } });
    }
    return entries.length;
  };

  handlers.apply_language_lexicon_sync = async (args) => {
    const payload = args.payload as { profileId: string; entries: LanguageLexicalEntry[] };
    await handlers.import_language_lexicon({ profileId: payload.profileId, entries: payload.entries });
    return handlers.serialize_language_lexicon_for_sync({ profileId: payload.profileId });
  };

  // --- Knowledge additions ---
  handlers.list_language_knowledge_states = async (args) => {
    const knowledge = readJson<{ snapshots?: LanguageKnowledgeStateSnapshot[] }>(KNOWLEDGE_KEY, { snapshots: [] });
    const ids = Array.isArray(args.entryIds) ? new Set(args.entryIds as string[]) : null;
    const filtered = (knowledge.snapshots || []).filter(
      (s) =>
        s.profileId === args.profileId &&
        (!ids || ids.has(s.lexicalEntryId)) &&
        (!args.state || s.state === args.state),
    );
    return page(filtered, Number(args.offset) || 0, Number(args.limit) || 50);
  };

  handlers.list_language_memorization_links = async (args) => {
    const knowledge = readJson<{ links?: LanguageMemorizationLink[] }>(KNOWLEDGE_KEY, { links: [] });
    return (knowledge.links || []).filter(
      (l) => l.profileId === args.profileId && (!args.entryId || l.lexicalEntryId === args.entryId),
    );
  };

  handlers.delete_language_memorization_link = async (args) => {
    const knowledge = readJson<{ snapshots?: any[]; history?: any[]; evidence?: any[]; links?: LanguageMemorizationLink[] }>(KNOWLEDGE_KEY, {});
    const before = (knowledge.links || []).length;
    knowledge.links = (knowledge.links || []).filter((l) => !(l.profileId === args.profileId && l.id === args.linkId));
    writeJson(KNOWLEDGE_KEY, knowledge);
    return (knowledge.links || []).length < before;
  };

  handlers.list_language_knowledge_evidence = async (args) => {
    const knowledge = readJson<{ evidence?: LanguageKnowledgeEvidenceEvent[] }>(KNOWLEDGE_KEY, { evidence: [] });
    const filtered = (knowledge.evidence || []).filter(
      (e) => e.profileId === args.profileId && (!args.entryId || e.lexicalEntryId === args.entryId),
    );
    return page(filtered, Number(args.offset) || 0, Number(args.limit) || 50);
  };

  handlers.serialize_language_knowledge_for_sync = async (args) => {
    const exported = (await handlers.export_language_knowledge(args)) as LanguageKnowledgeExport;
    return {
      schemaVersion: exported.schemaVersion,
      profileId: exported.profileId,
      changedAt: exported.exportedAt,
      states: exported.states,
      memorizationLinks: exported.memorizationLinks,
    };
  };

  handlers.apply_language_knowledge_sync = async (args) => {
    const payload = args.payload as { profileId: string; states: LanguageKnowledgeStateSnapshot[] };
    for (const snap of payload.states || []) {
      await handlers.set_language_knowledge_state({
        change: {
          profileId: payload.profileId,
          entryId: snap.lexicalEntryId,
          state: snap.state,
          source: snap.overrideSource || "manual",
          actorId: snap.overrideActor,
        },
      });
    }
    return handlers.serialize_language_knowledge_for_sync({ profileId: payload.profileId });
  };

  // --- Practice attempts (missing in browser-backend previously) ---
  handlers.upsert_language_practice_attempt = async (args) => {
    const attempt = { ...(args.attempt as Record<string, any>) };
    const items = readPractice();
    const now = Math.floor(Date.now() / 1000);
    const existingIndex = items.findIndex((i) => i.id === attempt.id);
    if (existingIndex >= 0 && items[existingIndex].profileId !== attempt.profileId) {
      throw new Error(`Practice attempt ${attempt.id} belongs to another language profile`);
    }
    attempt.createdAt = attempt.createdAt > 0 ? attempt.createdAt : now;
    attempt.updatedAt = now;
    if (existingIndex >= 0) items[existingIndex] = attempt;
    else items.unshift(attempt);
    writePractice(items);
    return attempt;
  };

  handlers.get_language_practice_attempt = async (args) => {
    const item = readPractice().find((i) => i.profileId === args.profileId && i.id === args.id);
    if (!item) throw new Error(`Practice attempt ${String(args.id)} not found`);
    return item;
  };

  handlers.list_language_practice_attempts = async (args) => {
    const items = readPractice()
      .filter(
        (i) =>
          i.profileId === args.profileId &&
          (!args.sourceId || i.sourceId === args.sourceId) &&
          (!args.mode || i.mode === args.mode) &&
          (!args.status || i.status === args.status),
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const offset = Math.max(0, Number(args.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
    return items.slice(offset, offset + limit);
  };

  handlers.import_language_practice_attempts = async (args) => {
    const attempts = (Array.isArray(args.attempts) ? args.attempts : []) as Record<string, any>[];
    for (const attempt of attempts) {
      await handlers.upsert_language_practice_attempt({
        attempt: { ...attempt, profileId: args.profileId },
      });
    }
    return attempts.length;
  };

  handlers.delete_language_practice_attempt = async (args) => {
    const items = readPractice();
    const next = items.filter((i) => !(i.profileId === args.profileId && i.id === args.id));
    writePractice(next);
    return next.length < items.length;
  };

  handlers.purge_expired_language_practice_attempts = async (args) => {
    const rawNow = Number(args.now) || Math.floor(Date.now() / 1000);
    const now = rawNow > 10_000_000_000 ? Math.floor(rawNow / 1000) : rawNow;
    const items = readPractice();
    const next = items.filter(
      (i) => !(i.profileId === args.profileId && i.retentionExpiresAt != null && i.retentionExpiresAt <= now),
    );
    writePractice(next);
    return items.length - next.length;
  };

  handlers.export_language_practice_attempts = async (args) =>
    readPractice()
      .filter((i) => i.profileId === args.profileId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // --- Language Packs & Offline Dictionary ---
  handlers.list_language_packs = async (args) => {
    const { packs } = readPacks();
    return packs.filter(
      (p) =>
        p.status !== "removed" &&
        (!args.languageTag || p.languageTag === args.languageTag || p.targetLanguage === args.languageTag),
    );
  };

  handlers.install_language_pack_with_entries = async (args) => {
    const pack = { ...(args.pack as LanguagePackRecord) };
    const entries = (Array.isArray(args.entries) ? args.entries : []) as LanguageDictionaryEntryRecord[];
    const now = Math.floor(Date.now() / 1000);
    pack.installedAt = pack.installedAt > 0 ? pack.installedAt : now;
    pack.updatedAt = now;
    pack.lastVerifiedAt = now;
    pack.entryCount = entries.length;
    pack.status = "installed";
    const state = readPacks();
    state.packs = [pack, ...state.packs.filter((p) => p.id !== pack.id)];
    state.entries = [...entries, ...state.entries.filter((e) => e.packId !== pack.id)];
    writePacks(state);
    return pack;
  };

  handlers.lookup_language_pack_dictionary = async (args) => {
    const primary = String(args.languageTag || "").split("-")[0].toLowerCase();
    const q = String(args.query || "").trim().toLowerCase();
    const lemma = typeof args.lemma === "string" ? args.lemma.trim().toLowerCase() : "";
    const state = readPacks();
    const installedIds = new Set(state.packs.filter((p) => p.status === "installed").map((p) => p.id));
    return state.entries
      .filter((e) => {
        if (!installedIds.has(e.packId)) return false;
        const lang = e.languageTag.toLowerCase();
        if (lang !== primary && !lang.startsWith(`${primary}-`)) return false;
        const norm = e.normalizedHeadword.toLowerCase();
        const entryLemma = (e.lemma || "").toLowerCase();
        return norm === q || entryLemma === q || (Boolean(lemma) && (norm === lemma || entryLemma === lemma));
      })
      .slice(0, Number(args.limit) || 20);
  };

  handlers.verify_language_pack = async (args) => {
    const state = readPacks();
    const pack = state.packs.find((p) => p.id === args.packId);
    if (!pack) throw new Error(`Language pack ${String(args.packId)} not found`);
    const actualCount = state.entries.filter((e) => e.packId === pack.id).length;
    const now = Math.floor(Date.now() / 1000);
    pack.lastVerifiedAt = now;
    pack.updatedAt = now;
    if (pack.entryCount > 0 && actualCount !== pack.entryCount) {
      pack.status = "corrupt";
      pack.error = `Entry count mismatch: expected ${pack.entryCount}, found ${actualCount}`;
    } else {
      pack.status = "installed";
      pack.error = undefined;
    }
    writePacks(state);
    return pack;
  };

  handlers.remove_language_pack = async (args) => {
    const state = readPacks();
    const before = state.packs.length;
    state.packs = state.packs.filter((p) => p.id !== args.packId);
    state.entries = state.entries.filter((e) => e.packId !== args.packId);
    writePacks(state);
    return state.packs.length < before;
  };

  // --- Ecosystem (Phrases, SRS Drafts, Alignments, Coverage, Recommendations, Analytics, Generation, Translation Cache, Processing) ---
  handlers.upsert_language_phrase = async (args) => {
    const eco = readEcosystem();
    const phrase = { ...(args.phrase as LanguagePhraseRecord) };
    const now = Math.floor(Date.now() / 1000);
    const norm = (phrase.normalizedForm || phrase.canonicalForm || "").trim().toLowerCase();
    phrase.normalizedForm = norm;
    phrase.phraseKey = phrase.phraseKey || `${phrase.languageTag.toLowerCase()}:${norm}`;
    phrase.id = phrase.id || uuidv4();
    phrase.createdAt = phrase.createdAt || now;
    phrase.updatedAt = now;
    phrase.version = (phrase.version || 0) + 1;
    eco.phrases = [phrase, ...eco.phrases.filter((p) => !(p.profileId === phrase.profileId && p.phraseKey === phrase.phraseKey))];
    writeEcosystem(eco);
    return phrase;
  };

  handlers.list_language_phrases = async (args) =>
    readEcosystem().phrases.filter(
      (p) => p.profileId === args.profileId && (!args.languageTag || p.languageTag === args.languageTag),
    );

  handlers.delete_language_phrase = async (args) => {
    const eco = readEcosystem();
    const before = eco.phrases.length;
    eco.phrases = eco.phrases.filter((p) => !(p.profileId === args.profileId && p.id === args.phraseId));
    writeEcosystem(eco);
    return eco.phrases.length < before;
  };

  handlers.upsert_language_srs_draft = async (args) => {
    const eco = readEcosystem();
    const draft = { ...(args.draft as LanguageSrsDraftRecord) };
    const now = Math.floor(Date.now() / 1000);
    draft.id = draft.id || uuidv4();
    draft.createdAt = draft.createdAt || now;
    draft.updatedAt = now;
    eco.srsDrafts = [draft, ...eco.srsDrafts.filter((d) => !(d.profileId === draft.profileId && d.draftKey === draft.draftKey))];
    writeEcosystem(eco);
    return draft;
  };

  handlers.find_language_srs_draft_by_key = async (args) =>
    readEcosystem().srsDrafts.find((d) => d.profileId === args.profileId && d.draftKey === args.draftKey) ?? null;

  handlers.upsert_language_audio_alignment = async (args) => {
    const eco = readEcosystem();
    const alignment = { ...(args.alignment as LanguageAudioAlignmentRecord) };
    const now = Math.floor(Date.now() / 1000);
    alignment.id = alignment.id || uuidv4();
    alignment.createdAt = alignment.createdAt || now;
    alignment.updatedAt = now;
    eco.alignments = [
      alignment,
      ...eco.alignments.filter(
        (a) => !(a.sourceId === alignment.sourceId && a.sentenceId === alignment.sentenceId && a.mediaId === alignment.mediaId),
      ),
    ];
    writeEcosystem(eco);
    return alignment;
  };

  handlers.list_language_audio_alignments = async (args) =>
    readEcosystem().alignments.filter(
      (a) => a.sourceId === args.sourceId && (!args.profileId || !a.profileId || a.profileId === args.profileId),
    );

  handlers.upsert_language_coverage_result = async (args) => {
    const eco = readEcosystem();
    const record = { ...(args.record as LanguageCoverageResultRecord), updatedAt: Math.floor(Date.now() / 1000) };
    eco.coverage = [record, ...eco.coverage.filter((c) => c.coverageKey !== record.coverageKey)];
    writeEcosystem(eco);
    return record;
  };

  handlers.get_language_coverage_results = async (args) =>
    readEcosystem().coverage.filter(
      (c) => c.profileId === args.profileId && (!args.documentId || c.documentId === args.documentId),
    );

  handlers.invalidate_language_coverage_for_entry = async (args) => {
    const eco = readEcosystem();
    let count = 0;
    eco.coverage = eco.coverage.map((c) => {
      if (c.profileId === args.profileId && c.freshness === "fresh") {
        count += 1;
        return { ...c, freshness: "stale", updatedAt: Math.floor(Date.now() / 1000) };
      }
      return c;
    });
    writeEcosystem(eco);
    return count;
  };

  handlers.upsert_language_recommendation_candidate = async (args) => {
    const eco = readEcosystem();
    const candidate = { ...(args.candidate as LanguageRecommendationCandidateRecord) };
    const now = Math.floor(Date.now() / 1000);
    candidate.id = candidate.id || uuidv4();
    candidate.createdAt = candidate.createdAt || now;
    candidate.updatedAt = now;
    eco.recommendations = [
      candidate,
      ...eco.recommendations.filter(
        (r) => !(r.profileId === candidate.profileId && r.sourceId === candidate.sourceId && r.sourceType === candidate.sourceType),
      ),
    ];
    writeEcosystem(eco);
    return candidate;
  };

  handlers.list_language_recommendation_candidates = async (args) =>
    readEcosystem().recommendations.filter(
      (r) => r.profileId === args.profileId && (!args.lifecycle || r.lifecycle === args.lifecycle),
    );

  handlers.record_language_analytics_event = async (args) => {
    const input = args.input as { idempotencyKey: string; profileId: string; eventKind: string; payload?: unknown; occurredAt?: number };
    const eco = readEcosystem();
    if (eco.analyticsEvents.some((e) => e.idempotencyKey === input.idempotencyKey)) return false;
    const occurredAt = input.occurredAt || Math.floor(Date.now() / 1000);
    eco.analyticsEvents.push({ idempotencyKey: input.idempotencyKey, profileId: input.profileId, eventKind: input.eventKind, payload: input.payload ?? {}, occurredAt });
    const dayUtc = new Date(occurredAt * 1000).toISOString().slice(0, 10);
    const existing = eco.analyticsDaily.find((d) => d.profileId === input.profileId && d.dayUtc === dayUtc);
    if (existing) {
      existing.metrics[input.eventKind] = (existing.metrics[input.eventKind] || 0) + 1;
      existing.eventCursor += 1;
      existing.updatedAt = occurredAt;
    } else {
      eco.analyticsDaily.push({
        profileId: input.profileId,
        dayUtc,
        metrics: { [input.eventKind]: 1 },
        eventCursor: 1,
        updatedAt: occurredAt,
      });
    }
    writeEcosystem(eco);
    return true;
  };

  handlers.list_language_analytics_daily = async (args) =>
    readEcosystem().analyticsDaily.filter(
      (d) =>
        d.profileId === args.profileId &&
        (!args.startDay || d.dayUtc >= String(args.startDay)) &&
        (!args.endDay || d.dayUtc <= String(args.endDay)),
    );

  handlers.record_language_generated_document = async (args) => {
    const eco = readEcosystem();
    const record = {
      ...(args.record as LanguageGeneratedDocumentRecord),
      id: (args.record as LanguageGeneratedDocumentRecord).id || uuidv4(),
      createdAt: (args.record as LanguageGeneratedDocumentRecord).createdAt || Math.floor(Date.now() / 1000),
    };
    eco.generatedDocs.unshift(record);
    writeEcosystem(eco);
    return record;
  };

  handlers.list_language_generated_documents = async (args) =>
    readEcosystem().generatedDocs.filter((g) => g.profileId === args.profileId);

  handlers.put_language_translation_cache = async (args) => {
    const eco = readEcosystem();
    const record = { ...(args.record as LanguageTranslationCacheRecord), createdAt: (args.record as LanguageTranslationCacheRecord).createdAt || Math.floor(Date.now() / 1000) };
    eco.translationCache = [record, ...eco.translationCache.filter((t) => t.cacheKey !== record.cacheKey)].slice(0, 500);
    writeEcosystem(eco);
    return record;
  };

  handlers.get_language_translation_cache = async (args) => {
    const now = Math.floor(Date.now() / 1000);
    const hit = readEcosystem().translationCache.find((t) => t.cacheKey === args.cacheKey);
    if (!hit) return null;
    if (hit.expiresAt != null && hit.expiresAt <= now) return null;
    return hit;
  };

  handlers.put_language_processing_job = async (args) => {
    const eco = readEcosystem();
    const job = args.job as { jobId: string };
    eco.processingJobs[job.jobId] = job;
    writeEcosystem(eco);
  };

  handlers.get_language_processing_job = async (args) =>
    readEcosystem().processingJobs[String(args.jobId)] ?? null;

  handlers.put_language_processing_chunk = async (args) => {
    const eco = readEcosystem();
    const chunk = args.chunk as { processingKey: string; chunkIndex: number };
    const existing = (eco.processingChunks[chunk.processingKey] as Array<{ chunkIndex: number }> | undefined) ?? [];
    eco.processingChunks[chunk.processingKey] = [...existing.filter((c) => c.chunkIndex !== chunk.chunkIndex), chunk];
    writeEcosystem(eco);
  };

  handlers.get_language_processing_chunks = async (args) =>
    readEcosystem().processingChunks[String(args.processingKey)] ?? [];

  handlers.put_language_processing_result = async (args) => {
    const eco = readEcosystem();
    const record = args.record as { processingKey: string };
    eco.processingResults[record.processingKey] = record;
    writeEcosystem(eco);
  };

  handlers.get_language_processing_result = async (args) =>
    readEcosystem().processingResults[String(args.processingKey)] ?? null;
}
