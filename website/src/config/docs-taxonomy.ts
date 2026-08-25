export type DocCategoryKey =
  | 'start-here'
  | 'capture-and-import'
  | 'read-and-listen'
  | 'understand-and-extract'
  | 'organize-and-connect'
  | 'remember-and-review'
  | 'scheduling-and-algorithms'
  | 'language-learning'
  | 'ai-and-models'
  | 'rss-and-podcasts'
  | 'platforms-and-devices'
  | 'settings-privacy-troubleshooting';

export interface DocCategory {
  id: DocCategoryKey;
  title: string;
  shortTitle: string;
  description: string;
  order: number;
}

export const DOC_CATEGORIES: DocCategory[] = [
  {
    id: 'start-here',
    title: 'Start Here',
    shortTitle: 'Start',
    description: 'Fundamentals, installation, first launch, and learning concepts.',
    order: 1,
  },
  {
    id: 'capture-and-import',
    title: 'Capture & Import',
    shortTitle: 'Import',
    description: 'Ingesting PDFs, EPUBs, web articles, Kindle clippings, and Anki decks.',
    order: 2,
  },
  {
    id: 'read-and-listen',
    title: 'Read & Listen',
    shortTitle: 'Reading & Audio',
    description: 'Multi-format viewers, continuous scroll, reflow, audio, and neural TTS.',
    order: 3,
  },
  {
    id: 'understand-and-extract',
    title: 'Understand & Extract',
    shortTitle: 'Extracts',
    description: 'Distilling books and articles into focused excerpts with incremental reading.',
    order: 4,
  },
  {
    id: 'organize-and-connect',
    title: 'Organize & Connect',
    shortTitle: 'Organize',
    description: 'Collections, smart tags, knowledge graph visualization, and global search.',
    order: 5,
  },
  {
    id: 'remember-and-review',
    title: 'Remember & Review',
    shortTitle: 'Flashcards',
    description: 'Flashcard Studio, Cloze cards, Q&A, Image Occlusion, and audio review.',
    order: 6,
  },
  {
    id: 'scheduling-and-algorithms',
    title: 'Scheduling & Spaced Repetition',
    shortTitle: 'SRS Algorithms',
    description: 'Adaptive scheduling algorithms: FSRS-6, Plethora Adaptive/Precision, and TAS.',
    order: 7,
  },
  {
    id: 'language-learning',
    title: 'Language Learning',
    shortTitle: 'Languages',
    description: 'Sentence mining, dictionary peek, lexical coverage, and shadowing.',
    order: 8,
  },
  {
    id: 'ai-and-models',
    title: 'AI & Providers',
    shortTitle: 'AI Tools',
    description: 'BYO API keys, on-device Gemini Nano, Socratic tutor, and grounded RAG.',
    order: 9,
  },
  {
    id: 'rss-and-podcasts',
    title: 'RSS & Podcasts',
    shortTitle: 'Feeds & Audio',
    description: 'Managing news feeds, full-text extraction, and podcast Whisper transcripts.',
    order: 10,
  },
  {
    id: 'platforms-and-devices',
    title: 'Platforms & Devices',
    shortTitle: 'Platforms',
    description: 'Desktop (macOS, Windows, Linux), Android APK, E-ink mode, and shortcuts.',
    order: 11,
  },
  {
    id: 'settings-privacy-troubleshooting',
    title: 'Settings, Privacy & Troubleshooting',
    shortTitle: 'Settings & Help',
    description: 'Themes, local-first privacy shield, backups, exports, and FAQs.',
    order: 12,
  },
];

export function getCategory(id: string): DocCategory | undefined {
  return DOC_CATEGORIES.find((cat) => cat.id === id);
}
