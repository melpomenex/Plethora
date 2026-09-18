/**
 * Modal dialog and confirmation system
 */

import { create } from "zustand";
import { ReactNode, useCallback, useEffect } from "react";
import { CheckCircle, Info, Warning, X, XCircle } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { dialogSurface, useDialogFocus } from "../md3/Dialog";
import { Button } from "../md3/Button";
import { cn } from "../../utils/cn";

/**
 * Modal type
 */
export enum ModalType {
  Info = "info",
  Success = "success",
  Warning = "warning",
  Error = "error",
  Confirm = "confirm",
  Custom = "custom",
}

/**
 * Modal options
 */
export interface ModalOptions {
  type?: ModalType;
  title?: string;
  message?: string;
  content?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger" | "warning";
  closable?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

/**
 * Modal state
 */
interface ModalState {
  visible: boolean;
  type: ModalType;
  title: string;
  message: string;
  content?: ReactNode;
  confirmText: string;
  cancelText: string;
  variant: "default" | "danger" | "warning";
  closable: boolean;
  size: "sm" | "md" | "lg" | "xl" | "full";
  resolve?: (value: boolean) => void;
}

/**
 * Modal store
 */
interface ModalStore {
  modal: ModalState;
  showModal: (options: ModalOptions) => Promise<boolean>;
  hideModal: () => void;
}

export const useModalStore = create<ModalStore>((set, get) => ({
  modal: {
    visible: false,
    type: ModalType.Info,
    title: "",
    message: "",
    confirmText: "OK",
    cancelText: "Cancel",
    variant: "default",
    closable: true,
    size: "md",
  },

  showModal: (options) => {
    return new Promise<boolean>((resolve) => {
      set({
        modal: {
          visible: true,
          type: options.type || ModalType.Info,
          title: options.title || "",
          message: options.message || "",
          content: options.content,
          confirmText: options.confirmText || "OK",
          cancelText: options.cancelText || "Cancel",
          variant: options.variant || "default",
          closable: options.closable !== false,
          size: options.size || "md",
          resolve,
        },
      });
    });
  },

  hideModal: () => {
    const { modal } = get();
    modal.resolve?.(false);
    set({ modal: { ...modal, visible: false } });
  },
}));

/**
 * Modal component
 */
export function Modal() {
  const { modal, hideModal } = useModalStore();


  const handleConfirm = () => {
    modal.resolve?.(true);
    hideModal();
  };

  const handleCancel = () => {
    modal.resolve?.(false);
    hideModal();
  };

  const handleClose = () => {
    if (modal.closable) {
      handleCancel();
    }
  };

  const modalRef = useDialogFocus(modal.visible, handleClose);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!modal.visible) return;
      // Enter confirms input-driven modals (prompt, custom bodies like the
      // priority popup). Skipped for Confirm modals so a destructive yes/no
      // still needs a deliberate click, and for elements that own Enter
      // themselves (buttons, textareas, links).
      if (e.key === "Enter" && modal.type === ModalType.Custom) {
        const el = e.target as HTMLElement | null;
        if (el?.closest("button, a, textarea, [contenteditable='true']")) return;
        e.preventDefault();
        handleConfirm();
      }
    };

    if (modal.visible) {
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [modal.visible, modal.closable, modal.type]);

  if (!modal.visible) return null;

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-6xl",
  };

  const typeIcons: Record<ModalType, { IconCmp: Icon; className: string } | null> = {
    [ModalType.Info]: { IconCmp: Info, className: "text-primary" },
    [ModalType.Success]: { IconCmp: CheckCircle, className: "text-success" },
    [ModalType.Warning]: { IconCmp: Warning, className: "text-warning" },
    [ModalType.Error]: { IconCmp: XCircle, className: "text-error" },
    [ModalType.Confirm]: { IconCmp: Info, className: "text-primary" },
    [ModalType.Custom]: null,
  };

  const isConfirm = modal.type === ModalType.Confirm || modal.type === ModalType.Custom;

  return (
    <div className="fixed inset-0 z-[var(--md-z-dialog)] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="md-dialog-scrim absolute inset-0"
        onClick={handleClose}
      />

      {/* Modal — Material dialog surface contract (md3/Dialog.tsx) */}
      <div
        ref={modalRef}
        className={cn(dialogSurface, sizeClasses[modal.size], "mx-4 md:mx-auto max-h-[90vh] md:max-h-[80vh]")}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="flex items-start gap-2 md:gap-3 p-4 md:p-6 flex-shrink-0">
          {typeIcons[modal.type] && (() => {
            const { IconCmp, className: iconClassName } = typeIcons[modal.type]!;
            return <IconCmp weight="fill" className={`h-6 w-6 shrink-0 ${iconClassName}`} aria-hidden="true" />;
          })()}
          <div className="flex-1 min-w-0">
            <h2
              id="modal-title"
              className="md-title-large text-on-surface"
            >
              {modal.title}
            </h2>
            {modal.message && (
              <p className="md-body-medium mt-1 md:mt-2 text-on-surface-variant">
                {modal.message}
              </p>
            )}
          </div>
          {modal.closable && (
            <button
              onClick={handleClose}
              className="md-state -m-1 flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors min-w-[40px] min-h-[40px] flex-shrink-0"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Custom Content */}
        {modal.content && (
          <div className="px-4 md:px-6 pb-4 md:pb-6 overflow-y-auto flex-1 min-h-0">
            {modal.content}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 md:px-6 py-3 md:py-4 flex-shrink-0">
          {isConfirm && (
            <Button variant="text" onClick={handleCancel} className="min-h-11">
              {modal.cancelText}
            </Button>
          )}
          <Button
            variant={modal.variant === "danger" ? "destructive" : "filled"}
            onClick={handleConfirm}
            className={cn("min-h-11", modal.variant === "warning" && "bg-warning text-on-surface-variant")}
          >
            {modal.confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal helper hooks
 */
export function useModal() {
  const { showModal } = useModalStore();

  return {
    alert: useCallback(
      (message: string, title?: string) => {
        return showModal({
          type: ModalType.Info,
          title: title || "Info",
          message,
          confirmText: "OK",
        });
      },
      [showModal]
    ),

    confirm: useCallback(
      (message: string, title?: string, options?: Partial<ModalOptions>) => {
        return showModal({
          type: ModalType.Confirm,
          title: title || "Confirm",
          message,
          confirmText: options?.confirmText || "OK",
          cancelText: options?.cancelText || "Cancel",
          variant: options?.variant,
        });
      },
      [showModal]
    ),

    prompt: useCallback(
      (message: string, defaultValue = "", title?: string) => {
        return new Promise<string | null>((resolve) => {
          let value = defaultValue;

          showModal({
            type: ModalType.Custom,
            title: title || "Prompt",
            message,
            content: (
              <input
                type="text"
                defaultValue={defaultValue}
                onChange={(e) => (value = e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
            ),
            confirmText: "OK",
            cancelText: "Cancel",
          }).then((result) => {
            resolve(result ? value : null);
          });
        });
      },
      [showModal]
    ),

    success: useCallback(
      (message: string, title?: string) => {
        return showModal({
          type: ModalType.Success,
          title: title || "Success",
          message,
          confirmText: "OK",
        });
      },
      [showModal]
    ),

    warning: useCallback(
      (message: string, title?: string) => {
        return showModal({
          type: ModalType.Warning,
          title: title || "Warning",
          message,
          confirmText: "OK",
        });
      },
      [showModal]
    ),

    error: useCallback(
      (message: string, title?: string) => {
        return showModal({
          type: ModalType.Error,
          title: title || "Error",
          message,
          confirmText: "OK",
        });
      },
      [showModal]
    ),

    custom: useCallback(
      (content: ReactNode, options: ModalOptions = {}) => {
        return showModal({
          type: ModalType.Custom,
          ...options,
          content,
        });
      },
      [showModal]
    ),
  };
}

/**
 * Modal provider
 */
export function ModalProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Modal />
    </>
  );
}

/**
 * Confirmation dialog component
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogFocus(open, onCancel);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--md-z-dialog)] flex items-center justify-center">
      <div
        className="md-dialog-scrim absolute inset-0"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        className={cn(dialogSurface, "max-w-md mx-4")}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className="p-6">
          <h3 id="confirm-title" className="md-headline-small text-on-surface">
            {title}
          </h3>
          <p id="confirm-message" className="md-body-medium mt-2 text-on-surface-variant">
            {message}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 pb-6">
          <Button variant="text" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button
            variant={variant === "danger" ? "destructive" : "filled"}
            className={cn(variant === "warning" && "bg-warning text-on-surface-variant")}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Alert dialog component
 */
export function AlertDialog({
  open,
  title,
  message,
  buttonText = "OK",
  type = ModalType.Info,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  buttonText?: string;
  type?: ModalType;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus(open, onClose);

  if (!open) return null;

  const typeIcons: Record<string, { IconCmp: Icon; className: string }> = {
    [ModalType.Info]: { IconCmp: Info, className: "text-primary" },
    [ModalType.Success]: { IconCmp: CheckCircle, className: "text-success" },
    [ModalType.Warning]: { IconCmp: Warning, className: "text-warning" },
    [ModalType.Error]: { IconCmp: XCircle, className: "text-error" },
  };
  const { IconCmp, className: iconClassName } = typeIcons[type] ?? typeIcons[ModalType.Info];

  return (
    <div className="fixed inset-0 z-[var(--md-z-dialog)] flex items-center justify-center">
      <div
        className="md-dialog-scrim absolute inset-0"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={cn(dialogSurface, "max-w-md mx-4")}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 p-6">
          <div className={`flex-shrink-0 ${iconClassName}`}>
            <IconCmp weight="fill" className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 className="md-headline-small text-on-surface">{title}</h3>
            <p className="md-body-medium mt-2 text-on-surface-variant">{message}</p>
          </div>
        </div>
        <div className="px-6 pb-6">
          <Button onClick={onClose} className="w-full min-h-11">
            {buttonText}
          </Button>
        </div>
      </div>
    </div>
  );
}
