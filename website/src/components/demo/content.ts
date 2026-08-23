import type { DemoContentKind } from '../../config/demo-contract.ts';
import catalog from './content.json' with { type: 'json' };

export type DemoCardType = 'basic' | 'cloze' | 'qa' | 'mcq' | 'qa';

export interface DemoPassage {
  id: string;
  text: string;
  hitLabel: string;
}

export interface DemoCard {
  type: DemoCardType;
  front: string;
  back: string;
  choices?: string[];
}

export interface DemoItem {
  kind: DemoContentKind;
  title: string;
  subtitle: string;
  author: string;
  body: string[];
  mediaCaption?: string;
  passage: DemoPassage;
  explain: string;
  card: DemoCard;
  scheduleDays: Record<'1' | '2' | '3' | '4' | '5', string>;
}

export const DEMO_CATALOG_CAPTION = catalog.caption;

const items = catalog.items as DemoItem[];

export const DEMO_ITEMS: Record<DemoContentKind, DemoItem> = {
  article: items.find((item) => item.kind === 'article')!,
  book: items.find((item) => item.kind === 'book')!,
  pdf: items.find((item) => item.kind === 'pdf')!,
  podcast: items.find((item) => item.kind === 'podcast')!,
  video: items.find((item) => item.kind === 'video')!,
};

export const DEMO_LIBRARY = items;

export function itemForKind(kind: DemoContentKind): DemoItem {
  return DEMO_ITEMS[kind];
}
