import { useEffect, useId, useRef, type ReactNode } from "react";

export function HealthDialog({ title, children, onClose }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return (
    <dialog ref={ref} className="health-dialog md-dialog-surface" aria-labelledby={titleId} onCancel={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
