import { useEffect, useRef } from "react";
import { resolveNearestAvailableTabType } from "../../tabs/TabRegistry";
import { useToastStore, ToastType } from "../../common/Toast";
import { t } from "../../../lib/i18n";
import { useLibraryAskHandoffStore } from "../../../commandPalette/libraryAskHandoff";

/** Opens the canonical tab; its ready, active consumer acknowledges the intent. */
export function LibraryAskHost() {
  const nonce = useLibraryAskHandoffStore((state) => state.pending?.nonce);
  const navigated = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (nonce === undefined || navigated.current === nonce) return;
    navigated.current = nonce;
    const target = resolveNearestAvailableTabType("doc-qa");
    window.dispatchEvent(new CustomEvent("navigate", { detail: `/${target}` }));
    if (target !== "doc-qa") {
      useLibraryAskHandoffStore.getState().consumeAsk(nonce);
      useToastStore.getState().addToast({ type: ToastType.Info, title: t("toolbar.documentQA"), message: t("platform.unavailable.generic") });
    }
  }, [nonce]);
  return null;
}
