import React, { useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import {
  TextB,
  TextItalic,
  TextUnderline,
  Code,
  List,
  TextIndent,
  TextOutdent,
  Eye,
} from "@phosphor-icons/react";
import DOMPurify from "dompurify";
import { renderMarkdown } from "../../utils/markdown";
import { useI18n } from "../../lib/i18n";

export interface ExtractContentEditorRef {
  focus: () => void;
  getTextarea: () => HTMLTextAreaElement | null;
  indent: () => void;
  outdent: () => void;
}

export interface ExtractContentEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  textareaClassName?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  showPreviewToggle?: boolean;
  showPreview?: boolean;
  onPreviewToggle?: (showPreview: boolean) => void;
  renderPreview?: (value: string) => React.ReactNode;
  id?: string;
  "aria-label"?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function indentContent(
  text: string,
  start: number,
  end: number,
  indentStr = "  "
): { text: string; start: number; end: number } {
  if (start === end) {
    // Single cursor: insert indentStr at cursor
    const newText = text.slice(0, start) + indentStr + text.slice(end);
    return {
      text: newText,
      start: start + indentStr.length,
      end: end + indentStr.length,
    };
  }

  // Multiline / range selection: indent all affected lines
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const isEndAtLineBreak = end > start && text[end - 1] === "\n";
  const searchEndFrom = isEndAtLineBreak ? end - 1 : end;
  const nextNewline = text.indexOf("\n", searchEndFrom);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;

  const targetBlock = text.slice(lineStart, lineEnd);
  const lines = targetBlock.split("\n");
  const indentedBlock = lines.map((line) => indentStr + line).join("\n");

  const newText = text.slice(0, lineStart) + indentedBlock + text.slice(lineEnd);
  const newStart = start + indentStr.length;
  const addedChars = indentStr.length * lines.length;
  const newEnd = end + (isEndAtLineBreak ? addedChars - indentStr.length : addedChars);

  return {
    text: newText,
    start: newStart,
    end: newEnd,
  };
}

export function outdentContent(
  text: string,
  start: number,
  end: number,
  indentSize = 2
): { text: string; start: number; end: number } {
  if (start === end) {
    // Single cursor
    // If immediately preceded by 2 spaces or a tab, remove it
    if (start >= indentSize && text.slice(start - indentSize, start) === " ".repeat(indentSize)) {
      return {
        text: text.slice(0, start - indentSize) + text.slice(start),
        start: start - indentSize,
        end: start - indentSize,
      };
    }
    if (start >= 1 && (text[start - 1] === "\t" || text[start - 1] === " ")) {
      return {
        text: text.slice(0, start - 1) + text.slice(start),
        start: start - 1,
        end: start - 1,
      };
    }
    // Otherwise, check beginning of current line
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    let removeCount = 0;
    if (text.startsWith(" ".repeat(indentSize), lineStart)) {
      removeCount = indentSize;
    } else if (text[lineStart] === " " || text[lineStart] === "\t") {
      removeCount = 1;
    }
    if (removeCount > 0) {
      return {
        text: text.slice(0, lineStart) + text.slice(lineStart + removeCount),
        start: Math.max(lineStart, start - removeCount),
        end: Math.max(lineStart, end - removeCount),
      };
    }
    return { text, start, end };
  }

  // Multiline / range selection: remove up to indentSize spaces from each affected line
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const isEndAtLineBreak = end > start && text[end - 1] === "\n";
  const searchEndFrom = isEndAtLineBreak ? end - 1 : end;
  const nextNewline = text.indexOf("\n", searchEndFrom);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;

  const targetBlock = text.slice(lineStart, lineEnd);
  const lines = targetBlock.split("\n");
  let firstLineRemoved = 0;
  let totalRemoved = 0;

  const outdentedLines = lines.map((line, idx) => {
    let removed = 0;
    let outLine = line;
    if (line.startsWith(" ".repeat(indentSize))) {
      removed = indentSize;
      outLine = line.slice(indentSize);
    } else if (line.startsWith(" ") || line.startsWith("\t")) {
      removed = 1;
      outLine = line.slice(1);
    }
    if (idx === 0) {
      firstLineRemoved = removed;
    }
    totalRemoved += removed;
    return outLine;
  });

  const newText = text.slice(0, lineStart) + outdentedLines.join("\n") + text.slice(lineEnd);
  const newStart = Math.max(lineStart, start - firstLineRemoved);
  const newEnd = Math.max(newStart, end - totalRemoved);

  return {
    text: newText,
    start: newStart,
    end: newEnd,
  };
}

export function applyAnnotation(
  text: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string
): { text: string; start: number; end: number } {
  const selectedText = text.substring(start, end);
  const newText =
    text.substring(0, start) +
    prefix +
    selectedText +
    suffix +
    text.substring(end);
  return {
    text: newText,
    start: start + prefix.length,
    end: end + prefix.length,
  };
}

export const ExtractContentEditor = forwardRef<ExtractContentEditorRef, ExtractContentEditorProps>(
  function ExtractContentEditor(
    {
      value,
      onChange,
      placeholder = "Enter the extract content... Use **bold**, _italic_, `code`, or • for bullets",
      rows = 4,
      className = "",
      textareaClassName = "",
      disabled = false,
      autoFocus = false,
      showPreviewToggle = false,
      showPreview = false,
      onPreviewToggle,
      renderPreview,
      id,
      "aria-label": ariaLabel,
      textareaRef: externalTextareaRef,
    },
    ref
  ) {
    const { t } = useI18n();
    const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = externalTextareaRef || internalTextareaRef;

    const applyChangeWithSelection = useCallback(
      (newText: string, selStart: number, selEnd: number) => {
        onChange(newText);
        window.setTimeout(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(selStart, selEnd);
          }
        }, 0);
      },
      [onChange]
    );

    const handleIndent = useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const result = indentContent(value, start, end, "  ");
      applyChangeWithSelection(result.text, result.start, result.end);
    }, [value, applyChangeWithSelection]);

    const handleOutdent = useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const result = outdentContent(value, start, end, 2);
      applyChangeWithSelection(result.text, result.start, result.end);
    }, [value, applyChangeWithSelection]);

    const handleAnnotation = useCallback(
      (prefix: string, suffix: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const result = applyAnnotation(value, start, end, prefix, suffix);
        applyChangeWithSelection(result.text, result.start, result.end);
      },
      [value, applyChangeWithSelection]
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        getTextarea: () => textareaRef.current,
        indent: handleIndent,
        outdent: handleOutdent,
      }),
      [handleIndent, handleOutdent]
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          handleOutdent();
        } else {
          handleIndent();
        }
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          handleAnnotation("**", "**");
        } else if (e.key === "i" || e.key === "I") {
          e.preventDefault();
          handleAnnotation("_", "_");
        } else if (e.key === "u" || e.key === "U") {
          e.preventDefault();
          handleAnnotation("<u>", "</u>");
        }
      }
    };

    return (
      <div className={`space-y-2 ${className}`}>
        {/* Toolbar */}
        {!showPreview && (
          <div className="flex flex-wrap items-center gap-1 p-2 bg-muted/50 rounded-md">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAnnotation("**", "**")}
              disabled={disabled}
              className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Bold (⌘/Ctrl+B)"
              aria-label="Bold"
            >
              <TextB className="w-4 h-4" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAnnotation("_", "_")}
              disabled={disabled}
              className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Italic (⌘/Ctrl+I)"
              aria-label="Italic"
            >
              <TextItalic className="w-4 h-4" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAnnotation("<u>", "</u>")}
              disabled={disabled}
              className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Underline (⌘/Ctrl+U)"
              aria-label="Underline"
            >
              <TextUnderline className="w-4 h-4" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAnnotation("`", "`")}
              disabled={disabled}
              className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Code"
              aria-label="Code"
            >
              <Code className="w-4 h-4" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAnnotation("• ", "")}
              disabled={disabled}
              className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Bullet"
              aria-label="Bullet"
            >
              <List className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-border mx-1" />

            <button
              type="button"
              data-testid="editor-indent-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleIndent}
              disabled={disabled}
              className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Indent (Tab)"
              aria-label="Indent"
            >
              <TextIndent className="w-4 h-4" />
            </button>
            <button
              type="button"
              data-testid="editor-outdent-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleOutdent}
              disabled={disabled}
              className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Outdent (Shift+Tab)"
              aria-label="Outdent"
            >
              <TextOutdent className="w-4 h-4" />
            </button>

            {showPreviewToggle && onPreviewToggle && (
              <>
                <div className="w-px h-4 bg-border mx-1" />
                <button
                  type="button"
                  onClick={() => onPreviewToggle(!showPreview)}
                  className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 text-muted-foreground rounded transition-colors flex items-center gap-1"
                  aria-label={showPreview ? t("extracts.edit") : t("extracts.preview")}
                >
                  <Eye className="w-3 h-3" />
                  {showPreview ? t("extracts.edit") : t("extracts.preview")}
                </button>
              </>
            )}

            <div className="flex-1" />
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {t("extracts.selectTextToFormat")}
            </span>
          </div>
        )}

        {/* Content Area */}
        {!showPreview ? (
          <textarea
            ref={textareaRef}
            id={id}
            aria-label={ariaLabel}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={rows}
            disabled={disabled}
            autoFocus={autoFocus}
            className={`w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${textareaClassName}`}
          />
        ) : (
          <div className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground min-h-[100px]">
            {renderPreview ? (
              renderPreview(value)
            ) : value ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(value)) }}
              />
            ) : (
              <span className="text-muted-foreground">{t("extracts.previewHint")}</span>
            )}
          </div>
        )}
      </div>
    );
  }
);
