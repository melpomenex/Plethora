import { getConfig } from '../config/env.js';
import { createS3Storage } from './s3.js';
import { createLocalStorage } from './local.js';
import type { StorageBackend } from './types.js';

let storageBackend: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (!storageBackend) {
    throw new Error('Storage not initialized. Call initStorage() first.');
  }
  return storageBackend;
}

export function initStorage(): StorageBackend {
  const config = getConfig();

  if (config.s3) {
    storageBackend = createS3Storage(config.s3);
  } else {
    const localPath = process.env.STORAGE_PATH || './uploads';
    storageBackend = createLocalStorage(localPath);
  }

  return storageBackend;
}

export type { StorageBackend } from './types.js';
