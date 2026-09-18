/**
 * Enhanced Import Dialog
 *
 * Provides content preview, metadata extraction, and import options
 */

import { useState, useEffect } from 'react';
import {
  CircleNotch,
  Clock,
  TextT,
  WarningCircle,
} from "@phosphor-icons/react";
import { fetchUrlContent, type FetchedUrlContent } from '../../api/documents';
import { ImportDialogSkeleton } from '../common/Skeleton';
import { ResponsiveDialogSheet } from '../adaptive';

interface ImportDialogProps {
  url: string;
  isOpen: boolean;
  onClose: () => void;
  onImport: (options: ImportOptions) => Promise<void>;
}

export interface ImportOptions {
  title: string;
  tags: string[];
  category?: string;
  collection?: string;
  priority: number;
  autoExtract: boolean;
  generateQA: boolean;
  generateCloze: boolean;
}

interface ContentPreview {
  title: string;
  author?: string;
  wordCount?: number;
  readingTime?: number;
  excerpt: string;
  content?: string;
  contentType: string;
  sourceType: 'article' | 'blog' | 'paper' | 'video' | 'other';
}

export function ImportDialog({ url, isOpen, onClose, onImport }: ImportDialogProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ContentPreview | null>(null);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    title: '',
    tags: [],
    priority: 0,
    autoExtract: true,
    generateQA: false,
    generateCloze: false,
  });
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && url) {
      loadPreview();
    }
  }, [isOpen, url]);

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const content = await fetchUrlContent(url);
      const wordCount = content.text?.length || 0;
      const readingTime = Math.ceil(wordCount / 250); // 250 WPM

      // Detect content type and source
      const sourceType = detectSourceType(url, content);
      const contentType = detectContentType(content);

      // Generate excerpt (first 200 chars)
      const excerpt = content.text?.substring(0, 200) || '';

      setPreview({
        title: content.title || extractTitleFromUrl(url),
        author: content.author,
        wordCount,
        readingTime,
        excerpt,
        content: content.text,
        contentType,
        sourceType,
      });

      // Set default title from preview
      setImportOptions((prev) => ({
        ...prev,
        title: content.title || extractTitleFromUrl(url),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;

    try {
      await onImport(importOptions);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    }
  };

  const handleAddTag = () => {
    const tag = newTag.trim();
    if (tag && !importOptions.tags.includes(tag)) {
      setImportOptions((prev) => ({
        ...prev,
        tags: [...prev.tags, tag],
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setImportOptions((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tagToRemove),
    }));
  };

  const detectSourceType = (url: string, content: FetchedUrlContent): ContentPreview['sourceType'] => {
    const hostname = new URL(url).hostname.toLowerCase();

    if (hostname.includes('medium.com')) return 'blog';
    if (hostname.includes('notion.site')) return 'article';
    if (hostname.includes('arxiv.org')) return 'paper';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'video';

    if (content.html?.includes('article') || content.html?.includes('post')) {
      return 'article';
    }

    return 'other';
  };

  const detectContentType = (content: FetchedUrlContent): string => {
    if (content.html?.includes('<article>') || content.html?.includes('blog-post')) {
      return 'Article';
    }
    if (content.html?.includes('abstract') || content.html?.includes('paper')) {
      return 'Research Paper';
    }
    return 'Web Page';
  };

  const extractTitleFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      return pathParts[pathParts.length - 1]?.replace(/-/g, ' ') || url;
    } catch {
      return url;
    }
  };

  if (!isOpen) return null;

  return (
    <ResponsiveDialogSheet
      open={isOpen}
      onClose={onClose}
      title="Import from Web"
      description={url}
      className="responsive-import-dialog"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="min-h-[44px] rounded-lg px-4 py-2.5 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Cancel import"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!preview || !importOptions.title}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Import document"
          >
            {loading && <CircleNotch className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Import
          </button>
        </div>
      }
    >
          {loading && <ImportDialogSkeleton />}

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg flex items-start gap-2">
              <WarningCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Failed to load content</div>
                <div className="text-sm mt-1">{error}</div>
              </div>
            </div>
          )}

          {preview && !loading && (
            <>
              {/* URL & Content Info */}
              <div className="mb-4 p-3 bg-surface-container-low rounded-lg">
                <div className="flex items-center gap-2 text-sm text-on-surface-variant mb-2">
                  <TextT className="w-4 h-4" />
                  <span className="truncate">{url}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-on-surface-variant">Type:</span>
                    <span className="ml-2 font-medium">{preview.contentType}</span>
                  </div>
                  <div>
                    <span className="text-on-surface-variant">Source:</span>
                    <span className="ml-2 font-medium capitalize">{preview.sourceType}</span>
                  </div>
                  {preview.readingTime && (
                    <div>
                      <span className="text-on-surface-variant">Reading time:</span>
                      <span className="ml-2 font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {preview.readingTime} min
                      </span>
                    </div>
                  )}
                  {preview.wordCount && (
                    <div>
                      <span className="text-on-surface-variant">Words:</span>
                      <span className="ml-2 font-medium">{preview.wordCount.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Preview Excerpt */}
              {preview.excerpt && (
                <div className="mb-4 p-3 bg-surface-container-low rounded-lg">
                  <div className="text-sm text-on-surface-variant mb-1">Preview</div>
                  <p className="text-sm line-clamp-3">{preview.excerpt}...</p>
                </div>
              )}

              {/* Import Options */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-on-surface mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    value={importOptions.title}
                    onChange={(e) => setImportOptions((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 border border-outline rounded-lg bg-surface-container-lowest text-on-surface"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-on-surface mb-1">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {importOptions.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-md text-sm"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:text-blue-900"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="Add tag..."
                      className="flex-1 px-3 py-2 border border-outline rounded-lg bg-surface-container-lowest text-on-surface"
                    />
                    <button
                      onClick={handleAddTag}
                      className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-on-surface mb-1">
                    Auto-extract options
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={importOptions.autoExtract}
                        onChange={(e) => setImportOptions((prev) => ({ ...prev, autoExtract: e.target.checked }))}
                        className="rounded"
                      />
                      <span>Auto-extract key passages</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={importOptions.generateQA}
                        onChange={(e) => setImportOptions((prev) => ({ ...prev, generateQA: e.target.checked }))}
                        className="rounded"
                      />
                      <span>Generate Q&A items</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={importOptions.generateCloze}
                        onChange={(e) => setImportOptions((prev) => ({ ...prev, generateCloze: e.target.checked }))}
                        className="rounded"
                      />
                      <span>Create cloze deletions</span>
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
    </ResponsiveDialogSheet>
  );
}
