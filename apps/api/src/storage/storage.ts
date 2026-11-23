import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredFile {
  key: string;
  url: string;
}

export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
}

export const LOCAL_UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');

class LocalDiskStorage implements StorageProvider {
  private resolve(key: string) {
    const full = path.resolve(LOCAL_UPLOAD_ROOT, key);
    if (!full.startsWith(LOCAL_UPLOAD_ROOT + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<StoredFile> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' }); // never overwrite
    return { key, url: `/uploads/${key}` };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

let provider: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (provider) return provider;
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver === 'local') return (provider = new LocalDiskStorage());
  throw new Error(`Storage driver "${driver}" is not implemented yet (planned: cloudinary, s3).`);
}

/** Tests inject an in-memory provider. */
export function setStorageForTests(p: StorageProvider | undefined) {
  provider = p;
}