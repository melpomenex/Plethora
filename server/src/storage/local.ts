import fs from 'fs/promises';
import path from 'path';
import type { StorageBackend } from './types.js';

/**
 * Local filesystem storage for development only.
 * Not suitable for production or multi-instance deployments.
 */
export function createLocalStorage(basePath: string): StorageBackend {
  const root = path.resolve(basePath);

  async function resolveKey(key: string): Promise<string> {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep) && full !== root) {
      throw new Error('Invalid storage key path');
    }
    return full;
  }

  return {
    async putObject(key: string, body: Buffer | Uint8Array, _contentType: string): Promise<void> {
      const filePath = await resolveKey(key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, body);
    },

    async getObject(key: string): Promise<Buffer> {
      const filePath = await resolveKey(key);
      return fs.readFile(filePath);
    },

    async getSignedDownloadUrl(key: string): Promise<string> {
      // Local dev: return file:// path marker (not a real presigned URL)
      const filePath = await resolveKey(key);
      return `file://${filePath}`;
    },

    async getSignedUploadUrl(key: string): Promise<string> {
      const filePath = await resolveKey(key);
      return `file://${filePath}`;
    },

    async deleteObject(key: string): Promise<void> {
      const filePath = await resolveKey(key);
      try {
        await fs.unlink(filePath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    },
  };
}
