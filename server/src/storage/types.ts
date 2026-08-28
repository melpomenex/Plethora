export interface StorageBackend {
  /** Store an object and return its storage key */
  putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;

  /** Read object bytes (server-side; for sync pull rehydration) */
  getObject(key: string): Promise<Buffer>;

  /** Generate a time-limited download URL */
  getSignedDownloadUrl(key: string, expiresSec?: number): Promise<string>;

  /** Generate a time-limited upload URL */
  getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresSec?: number,
    sizeBytes?: number
  ): Promise<string>;

  /** Delete an object */
  deleteObject(key: string): Promise<void>;
}
