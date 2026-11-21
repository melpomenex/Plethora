import { useState } from "react";
import { createRoot } from "react-dom/client";
import annotationsUrl from "../../../src-tauri/tests/fixtures/pdf-baseline/native-annotations.pdf?url";
import formsUrl from "../../../src-tauri/tests/fixtures/pdf-baseline/form-widgets.pdf?url";
import { PDFViewer } from "../../components/viewer/PDFViewer";
import { ThemeProvider } from "../../contexts/ThemeContext";
import "../../index.css";

const pdfUrl = new URLSearchParams(location.search).has("form") ? formsUrl : annotationsUrl;

function NativeAnnotationsHarness() {
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);

  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <PDFViewer
        documentId="native-annotations-fixture"
        fileUrl={pdfUrl}
        pageNumber={page}
        onPageChange={setPage}
        scale={scale}
        onScaleChange={setScale}
        zoomMode="custom"
        parentOwnsRestoration
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <NativeAnnotationsHarness />
  </ThemeProvider>,
);
