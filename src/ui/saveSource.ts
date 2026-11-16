// Browser side of save syncing: the File System Access API (Chrome, Edge), which lets a
// page keep a handle to a file or folder and read it again, plus a small IndexedDB store
// so the handle survives a reload. Kept thin; the decisions live in saveSync.ts.

import { type FileStamp, isMultiplayerFolder, isStateFile, type LinkedSave, newestStateFile } from './saveSync';

// The API isn't in TypeScript's DOM types yet (or only partly), so describe what we use.
type PermissionMode = { mode: 'read' };
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  queryPermission?(o: PermissionMode): Promise<PermissionState>;
  requestPermission?(o: PermissionMode): Promise<PermissionState>;
}
interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandle | DirHandle>;
  queryPermission?(o: PermissionMode): Promise<PermissionState>;
  requestPermission?(o: PermissionMode): Promise<PermissionState>;
}
type AnyHandle = FileHandle | DirHandle;

export type Source = { kind: 'file'; handle: FileHandle } | { kind: 'folder'; handle: DirHandle };

/** What FileSystemObserver reports; "errored" means it stopped watching. */
interface ChangeRecord {
  type: string;
}
interface PickerWindow {
  showOpenFilePicker?: (o: object) => Promise<FileHandle[]>;
  showDirectoryPicker?: (o: object) => Promise<DirHandle>;
  FileSystemObserver?: new (cb: (records: ChangeRecord[]) => void) => { observe(h: AnyHandle, o?: object): Promise<void>; disconnect(): void };
}
const w = (typeof window === 'undefined' ? {} : window) as PickerWindow;

/** Chrome and Edge on a computer. Firefox and Safari only have <input type=file>. */
export const fsAccess = typeof w.showOpenFilePicker === 'function' && typeof w.showDirectoryPicker === 'function';
export const canObserve = typeof w.FileSystemObserver === 'function';

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export async function pickFolder(startIn?: AnyHandle): Promise<Source | null> {
  try {
    const handle = await w.showDirectoryPicker!({ id: 'polytopia-saves', mode: 'read', ...(startIn ? { startIn } : {}) });
    return { kind: 'folder', handle };
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

export async function permission(src: Source, ask: boolean): Promise<PermissionState> {
  const h = src.handle;
  try {
    const q = await h.queryPermission?.({ mode: 'read' });
    if (q === 'granted' || !ask) return q ?? 'granted';
    return (await h.requestPermission?.({ mode: 'read' })) ?? 'granted';
  } catch {
    return 'denied';
  }
}

export interface Found {
  file: File;
  stamp: FileStamp;
}

const stampOf = (f: File): FileStamp => ({ name: f.name, lastModified: f.lastModified, size: f.size });

/**
 * The folders that hold saves: the picked folder if it has .state files, else any
 * "Singleplayer" folder up to three levels down (so picking Midjiwan\Polytopia works too).
 * Multiplayer folders are never followed: a multiplayer save would offer other players' views.
 */
async function saveFolders(dir: DirHandle): Promise<DirHandle[]> {
  if (isMultiplayerFolder(dir.name)) return [];
  for await (const e of dir.values()) if (e.kind === 'file' && isStateFile(e.name)) return [dir];
  const out: DirHandle[] = [];
  const walk = async (d: DirHandle, depth: number) => {
    for await (const e of d.values()) {
      if (e.kind !== 'directory' || isMultiplayerFolder(e.name)) continue;
      if (e.name.toLowerCase() === 'singleplayer') out.push(e);
      else if (depth < 3) await walk(e, depth + 1);
    }
  };
  await walk(dir, 1);
  return out;
}

const folderCache = new WeakMap<DirHandle, DirHandle[]>();

/**
 * The current file of a source: the file itself, or the newest save in the folder
 * (null when the folder has no game right now). Throws NotFoundError when a picked
 * file is gone, which happens when its game ends.
 */
export async function findCurrent(src: Source, prefer?: string, rescan = false): Promise<Found | null> {
  if (src.kind === 'file') {
    const file = await src.handle.getFile();
    return { file, stamp: stampOf(file) };
  }
  let dirs = rescan ? undefined : folderCache.get(src.handle);
  if (!dirs?.length) {
    dirs = await saveFolders(src.handle);
    folderCache.set(src.handle, dirs);
  }
  const files: File[] = [];
  for (const d of dirs) {
    for await (const e of d.values()) {
      if (e.kind !== 'file' || !isStateFile(e.name)) continue;
      try {
        files.push(await e.getFile());
      } catch {
        /* deleted while we looked */
      }
    }
  }
  const newest = newestStateFile(files, prefer);
  return newest ? { file: newest, stamp: stampOf(newest) } : null;
}

/**
 * Calls `onChange` when the source changes on disk, using FileSystemObserver where the
 * browser has it, and `onBroken` if the observer stops working. Returns a stop function,
 * or null when observing isn't possible (poll then).
 */
export async function observe(src: Source, onChange: () => void, onBroken: () => void): Promise<(() => void) | null> {
  if (!canObserve) return null;
  try {
    const obs = new w.FileSystemObserver!((records) => (records.some((r) => r.type === 'errored') ? onBroken() : onChange()));
    await obs.observe(src.handle, src.kind === 'folder' ? { recursive: true } : undefined);
    return () => obs.disconnect();
  } catch {
    return null;
  }
}

// ---------- remembered source (IndexedDB: handles can't go in localStorage) ----------

export interface StoredSource {
  /** Missing for a save opened with the plain file input. */
  source?: Source;
  /** The game on screen came from this source; null once another map replaced it. */
  link: LinkedSave | null;
}

const DB = 'market-planner';
const STORE = 'kv';
const KEY = 'save-source';

/** Runs one transaction on the store and closes the database once it is done. */
function withStore(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}

export async function loadStored(): Promise<StoredSource | null> {
  try {
    return ((await withStore('readonly', (s) => s.get(KEY))) as StoredSource | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Remembers the source (null forgets it); resolves once it is written. */
export async function saveStored(v: StoredSource | null) {
  try {
    await withStore('readwrite', (s) => (v ? s.put(v, KEY) : s.delete(KEY)));
  } catch {
    /* storage unavailable: the user picks the file again after a reload */
  }
}
