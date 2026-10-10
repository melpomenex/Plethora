import { Brain, CaretDown, Check, CircleNotch } from "@phosphor-icons/react";
import DOMPurify from "dompurify";
import { useMemo } from "react";
import { useI18n } from "../../lib/i18n";
import { renderMarkdown } from "../../utils/markdown";
import { parseAssistantThinking } from "../../utils/assistantThinking";

export type AssistantThinkingStatus = "running" | "complete" | "interrupted";

interface AssistantResponseContentProps {
  content: string;
  /** Optional separately persisted thinking text. */
  thinking?: string;
  /** `running` buffers delimiter prefixes split across streamed chunks. */
  status?: AssistantThinkingStatus;
  /** Keep plain-text chat surfaces plain while still showing the disclosure. */
  markdown?: boolean;
  className?: string;
}

function ResponseBody({
  content,
  markdown,
  className,
}: {
  content: string;
  markdown: boolean;
  className: string;
}) {
  const html = useMemo(
    () => markdown ? DOMPurify.sanitize(renderMarkdown(content)) : "",
    [content, markdown],
  );

  if (!content) return null;
  return markdown ? (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className={`${className} whitespace-pre-wrap`}>{content}</div>
  );
}

export function AssistantResponseContent({
  content,
  thinking,
  status = "complete",
  markdown = true,
  className = "",
}: AssistantResponseContentProps) {
  const { t } = useI18n();
  const parsed = useMemo(() => parseAssistantThinking(content), [content]);
  const answer = thinking === undefined ? parsed.answer : content;
  const thinkingText = thinking ?? parsed.thinking;
  const showDisclosure = thinkingText.length > 0 || (thinking === undefined && parsed.hasThinking);
  const statusLabel = status === "running"
    ? t("assistant.thinkingInProgress")
    : status === "interrupted"
      ? t("assistant.thinkingInterrupted")
      : t("assistant.thinkingComplete");
  const bodyClassName = markdown
    ? `assistant-markdown leading-relaxed ${className}`.trim()
    : `text-sm leading-relaxed ${className}`.trim();

  return (
    <>
      {showDisclosure && (
        <details className="group mb-2 min-w-0 rounded-md border border-border bg-background/60">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            <Brain className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="font-medium text-foreground">{t("assistant.modelThinking")}</span>
            <span className="text-xs" aria-live="polite">{statusLabel}</span>
            <span className="ml-auto inline-flex items-center" aria-hidden="true">
              {status === "running" ? (
                <CircleNotch className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              ) : status === "interrupted" ? (
                <span className="h-2 w-2 rounded-full bg-warning" />
              ) : (
                <Check className="h-3.5 w-3.5 text-success" weight="bold" />
              )}
              <CaretDown className="ml-1 h-3.5 w-3.5 transition-transform motion-reduce:transition-none group-open:rotate-180" />
            </span>
          </summary>
          <div className="border-t border-border px-3 py-2 text-sm">
            <ResponseBody content={thinkingText} markdown={markdown} className={bodyClassName} />
          </div>
        </details>
      )}
      <ResponseBody content={answer} markdown={markdown} className={bodyClassName} />
    </>
  );
}
