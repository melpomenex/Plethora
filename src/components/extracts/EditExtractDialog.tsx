import type { Extract } from "../../api/extracts";
import { CreateExtractDialog } from "./CreateExtractDialog";

interface EditExtractDialogProps {
  extract: Extract;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (extract: Extract) => void;
}

/**
 * The shared extract editor in edit mode. EditExtractDialog and
 * CreateExtractDialog used to be two different-capability surfaces (the edit
 * funnel had no Image Registry and could not write html_content), which is
 * why a quick-path extract could never be given images after creation
 * (issue #44 bug 08). Both funnels now run one editor.
 */
export function EditExtractDialog({ extract, isOpen, onClose, onUpdate }: EditExtractDialogProps) {
  return (
    <CreateExtractDialog
      documentId={extract.document_id ?? ""}
      extract={extract}
      isOpen={isOpen}
      onClose={onClose}
      onCreate={onUpdate}
    />
  );
}
