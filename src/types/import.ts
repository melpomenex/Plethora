/**
 * Typed Document Import Error and Lifecycle Model
 */

export type ImportErrorCode =
  | "unsupported_type"
  | "file_not_found"
  | "permission_denied"
  | "staging_failed"
  | "invalid_document"
  | "encrypted_document"
  | "extract_failed"
  | "duplicate_document"
  | "storage_full"
  | "persist_failed"
  | "cancelled"
  | "interrupted"
  | "internal";

export interface ImportErrorPayload {
  type: "import_error";
  code: ImportErrorCode;
  message: string;
  fileName?: string;
  details?: Record<string, unknown>;
}

export class ImportError extends Error {
  code: ImportErrorCode;
  fileName?: string;
  details?: Record<string, unknown>;

  constructor(payload: { code: ImportErrorCode; message: string; fileName?: string; details?: Record<string, unknown> }) {
    super(payload.message);
    this.name = "ImportError";
    this.code = payload.code;
    this.fileName = payload.fileName;
    this.details = payload.details;
  }
}

export type ImportStage =
  | "idle"
  | "selected"
  | "staging"
  | "staged"
  | "validating"
  | "extracting"
  | "persisting"
  | "post_processing"
  | "complete"
  | "failed";

export interface ImportProgress {
  current: number;
  total: number;
  fileName?: string;
  stage?: ImportStage;
  fraction?: number;
}
