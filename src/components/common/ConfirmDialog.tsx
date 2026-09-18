/**
 * Confirmation Dialog Component
 * Used for destructive actions like delete, bulk delete, etc.
 */

import { useState } from "react";
import {
  Check,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { Button } from "../md3/Button";
import { cn } from "../../utils/cn";

export type ConfirmDialogVariant = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  details?: string[];
  itemName?: string;
  itemCount?: number;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "warning",
  details,
  itemName = "item",
  itemCount = 1,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const { delete: deleteHaptic } = useHapticFeedback();

  if (!isOpen) return null;

  const variantConfig = {
    danger: {
      iconBg: "bg-error-container",
      iconColor: "text-on-error-container",
      confirmVariant: "destructive" as const,
      confirmClassName: "",
    },
    warning: {
      iconBg: "bg-warning/20",
      iconColor: "text-warning",
      confirmVariant: "filled" as const,
      confirmClassName: "bg-warning text-on-surface-variant",
    },
    info: {
      iconBg: "bg-primary-container",
      iconColor: "text-on-primary-container",
      confirmVariant: "filled" as const,
      confirmClassName: "",
    },
  };

  const config = variantConfig[variant];

  const Icon = variant === "danger" ? Trash : variant === "warning" ? Warning : Check;

  return (
    <div className="fixed inset-0 z-[var(--md-z-dialog)] flex items-center justify-center p-4">
      <div className="md-dialog-scrim absolute inset-0" aria-hidden="true" />
      <div
        className="relative bg-surface-container-high text-on-surface rounded-[1.75rem] shadow-2xl max-w-md w-full animate-glass-scale-in"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        {/* Header */}
        <div className="relative p-6 pb-4">
          <button
            onClick={onClose}
            className="md-state absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors"
            aria-label={t("common.close")}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>

          <div className="flex items-center gap-4 pr-10">
            <div className={`w-12 h-12 ${config.iconBg} rounded-xl flex items-center justify-center`}>
              <Icon className={`w-6 h-6 ${config.iconColor}`} aria-hidden="true" />
            </div>
            <div>
              <h2 id="confirm-title" className="md-headline-small text-on-surface">
                {title}
              </h2>
              {itemCount > 1 && (
                <p className="md-body-small text-on-surface-variant">
                  {t("confirm.itemsSelected", { count: itemCount })}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          <p id="confirm-message" className="md-body-medium text-on-surface-variant mb-4">
            {message}
          </p>

          {/* Details list */}
          {details && details.length > 0 && (
            <div className="bg-surface-container-lowest rounded-lg p-3 mb-4 max-h-40 overflow-y-auto">
              <p className="md-label-small text-on-surface-variant uppercase tracking-wide mb-2">
                {t("confirm.itemsAffectedLabel", { itemName })}:
              </p>
              <ul className="space-y-1">
                {details.slice(0, 10).map((detail, index) => (
                  <li key={index} className="md-body-small text-on-surface truncate">
                    • {detail}
                  </li>
                ))}
                {details.length > 10 && (
                  <li className="md-body-small text-on-surface-variant">
                    {t("confirm.andMore", { count: details.length - 10 })}
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Warning message for destructive actions */}
          {variant === "danger" && (
            <div className="flex items-start gap-2 p-3 bg-error-container border border-error/20 rounded-lg">
              <Warning className="w-4 h-4 text-on-error-container mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p className="md-body-small text-on-error-container">
                {t("confirm.dangerWarning", { target: itemCount > 1 ? t("confirm.allSelectedItems") : t("confirm.thisItem") })}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <Button variant="outlined" onClick={onClose} className="flex-1 min-h-11">
            {cancelLabel}
          </Button>
          <Button
            variant={config.confirmVariant}
            className={cn("flex-1 min-h-11", config.confirmClassName)}
            onClick={() => {
              if (variant === "danger") deleteHaptic();
              onConfirm();
              onClose();
            }}
          >
            {variant === "danger" && <Trash className="w-4 h-4" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for managing confirmation dialogs
 */
export function useConfirmDialog() {
  const [state, setState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant: ConfirmDialogVariant;
    confirmLabel?: string;
    details?: string[];
    itemName?: string;
    itemCount?: number;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    variant: "warning",
  });

  const confirm = (
    options: {
      title: string;
      message: string;
      onConfirm: () => void;
      variant?: ConfirmDialogVariant;
      confirmLabel?: string;
      details?: string[];
      itemName?: string;
      itemCount?: number;
    }
  ) => {
    setState({
      isOpen: true,
      title: options.title,
      message: options.message,
      onConfirm: options.onConfirm,
      variant: options.variant || "warning",
      confirmLabel: options.confirmLabel,
      details: options.details,
      itemName: options.itemName,
      itemCount: options.itemCount,
    });
  };

  const close = () => {
    setState((prev) => ({ ...prev, isOpen: false }));
  };

  return {
    isOpen: state.isOpen,
    title: state.title,
    message: state.message,
    onConfirm: state.onConfirm,
    variant: state.variant,
    confirmLabel: state.confirmLabel,
    details: state.details,
    itemName: state.itemName,
    itemCount: state.itemCount,
    confirm,
    close,
  };
}

export default ConfirmDialog;
