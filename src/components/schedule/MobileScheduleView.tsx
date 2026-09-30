import { ScheduleView } from "./ScheduleView";

interface MobileScheduleViewProps {
  onStartReview?: (itemId?: string) => void;
  onOpenDocument?: (documentId: string, title: string) => void;
  /** Return the surrounding queue to its default view. */
  onExit?: () => void;
}

export function MobileScheduleView({ onStartReview, onOpenDocument, onExit }: MobileScheduleViewProps) {
  return (
    <ScheduleView
      isMobile
      onStartReview={onStartReview}
      onOpenDocument={onOpenDocument}
      onExit={onExit}
    />
  );
}
