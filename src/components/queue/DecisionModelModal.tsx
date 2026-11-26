import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { useI18n } from "../../lib/i18n";
import { DaqeDecisionModelSettings } from "./DaqeDecisionModelSettings";
import { useSmartFeedsStore } from "../../stores/smartFeedsStore";

export interface DecisionModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProviderChange?: () => void;
}

/**
 * Standalone modal for choosing, configuring, and starting/stopping the
 * active decision model (Laya, OpenRouter, Jev, Clef, OpenAI, Gemini, etc.).
 *
 * Mounts the single-source-of-truth `DaqeDecisionModelSettings` so users in
 * RSS View (Smart Feeds) or elsewhere do not have to open the Queue's
 * Customize Session modal.
 */
export function DecisionModelModal({
  isOpen,
  onClose,
  onProviderChange,
}: DecisionModelModalProps) {
  const { t } = useI18n();

  if (!isOpen) return null;

  const handleProviderChange = () => {
    void useSmartFeedsStore.getState().loadCapabilities();
    onProviderChange?.();
  };

  return (
    <ResponsiveDialogSheet
      open={isOpen}
      onClose={onClose}
      title={t("daqeModel.title")}
      closeLabel={t("common.close")}
      desktopMaxWidth="38rem"
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("common.done")}
          </button>
        </div>
      }
    >
      <DaqeDecisionModelSettings onProviderChange={handleProviderChange} />
    </ResponsiveDialogSheet>
  );
}
