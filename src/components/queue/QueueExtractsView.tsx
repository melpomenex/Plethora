import { ExtractsList } from "../extracts/ExtractsList";

interface QueueExtractsViewProps {
  documentId: string;
}

/**
 * Extracts view used by Queue/Scroll Mode.
 *
 * The surrounding Queue pane intentionally hides overflow for document
 * viewers, so this alternate view needs to own its scrollport without
 * changing the shared ExtractsList behavior used elsewhere.
 */
export function QueueExtractsView({ documentId }: QueueExtractsViewProps) {
  return (
    <div
      data-queue-extracts-view="true"
      className="h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain touch-pan-y px-3 pt-[calc(4.5rem+env(safe-area-inset-top,0px))] pb-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:px-4 md:px-6"
    >
      <ExtractsList documentId={documentId} />
    </div>
  );
}
