import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createLocalStorage } from '../storage/local.js';

describe('local storage backend', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plethora-storage-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves object keys', async () => {
    const storage = createLocalStorage(tmpDir);
    const key = 'user-1/doc.pdf';
    await storage.putObject(key, Buffer.from('pdf-content'), 'application/pdf');
    const url = await storage.getSignedDownloadUrl(key);
    expect(url).toContain('file://');
    const filePath = url.replace('file://', '');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toBe('pdf-content');
  });

  it('rejects path traversal keys', async () => {
    const storage = createLocalStorage(tmpDir);
    await expect(storage.putObject('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'Invalid storage key path'
    );
  });

  it('deletes objects', async () => {
    const storage = createLocalStorage(tmpDir);
    const key = 'delete-me.bin';
    await storage.putObject(key, Buffer.from('data'), 'application/octet-stream');
    await storage.deleteObject(key);
    const url = await storage.getSignedDownloadUrl(key);
    const filePath = url.replace('file://', '');
    await expect(fs.access(filePath)).rejects.toThrow();
  });
});
