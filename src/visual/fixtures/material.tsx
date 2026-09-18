import React from "react";
import { createRoot } from "react-dom/client";
import "../../index.css";
import { Checkbox, Radio } from "../../components/md3/Selection";
import { Dialog } from "../../components/md3/Dialog";
import { Toast, ToastType, useToastStore } from "../../components/common/Toast";
import { ResponsiveDialogSheet } from "../../components/adaptive/ResponsiveDialogSheet";
import { PresentationProvider } from "../../contexts/PresentationContext";

useToastStore.getState().addToast({ type: ToastType.Info, title: "Notification", duration: 0 });
createRoot(document.getElementById("root")!).render(
  <PresentationProvider>
    <Checkbox aria-label="Checkbox" defaultChecked />
    <Radio aria-label="Radio" defaultChecked />
    <ResponsiveDialogSheet open onClose={() => {}} title="Adaptive">Content</ResponsiveDialogSheet>
    <Dialog open disableFocusManagement onClose={() => {}} title="Dialog">Content</Dialog>
    <Toast />
  </PresentationProvider>,
);
