import { processHtmlContent } from '../../../utils/documentImport';
import type { HtmlReaderKind } from './documentKind';

export interface PrepareHtmlDocumentInput {
  html: string;
  kind: HtmlReaderKind;
  title: string;
  baseUrl: string;
  preserveImages: boolean;
}

function safeBaseUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : window.location.origin;
  } catch {
    return window.location.origin;
  }
}

function safeImageUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Canonical fragments bypass the compatibility page-shaping transform. Other
 * reader kinds deliberately retain it until their own contracts are revised.
 */
export function prepareHtmlDocument(input: PrepareHtmlDocumentInput): string {
  if (input.kind !== 'canonical-article') {
    return processHtmlContent(
      input.html,
      input.baseUrl,
      input.title,
      input.preserveImages
    );
  }

  const baseUrl = safeBaseUrl(input.baseUrl);
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>`,
    'text/html'
  );
  doc.title = input.title;
  const source = new DOMParser().parseFromString(input.html, 'text/html');
  source
    .querySelectorAll('script, style, link, iframe, object, embed, form, svg, template, noscript')
    .forEach((element) => element.remove());
  source.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name === 'style' || name.startsWith('on') || name.startsWith('data-')) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  source.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    if (!input.preserveImages) {
      image.remove();
      return;
    }
    const resolved = safeImageUrl(image.getAttribute('src') ?? '', baseUrl);
    if (!resolved) {
      image.remove();
      return;
    }
    image.src = resolved;
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    image.loading = image.closest('.inc-hero') ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
  });

  const base = doc.createElement('base');
  base.href = baseUrl;
  doc.head.appendChild(base);
  while (source.body.firstChild) doc.body.appendChild(source.body.firstChild);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

