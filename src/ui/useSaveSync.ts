// Keeps track of the save file the map came from, re-reads it on Refresh, and watches it
// for changes when "Keep up to date" is on. The app decides what a read means (same game
// or a new one); this hook only reads files and reports them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseStateFile, type RawSave } from '../parse/stateFile';
import { findCurrent, type Found, fsAccess, loadStored, observe, permission, pickFile, pickFolder, type Source, saveStored, type StoredSource } from './saveSource';
import { changed, type FileStamp, type LinkedSave, type SourceKind, withRetry } from './saveSync';

/** load: the user picked a file to open. refresh: they asked for a re-read. auto: the file changed. */
export type SyncWhy = 'load' | 'refresh' | 'auto';

export interface SaveRead {
  kind: SourceKind;
  stamp: FileStamp;
  /** The handle it came from (not for the plain file input). */
  source?: Source;
}

export type SyncStatus = { kind: 'idle' } | { kind: 'busy' } | { kind: 'note'; message: string } | { kind: 'problem'; message: string };

interface Options {
  /** A save was read. Call `linked` once it is on screen. */
  onSave: (save: RawSave, read: SaveRead, why: SyncWhy) => void;
  /** A file the user picked to open couldn't be read. */
  onLoadError: (message: string) => void;
  /** Click the page's <input type=file> (has to happen in the click handler). */
  openInput: () => void;
}

/** How often to look at the file when the browser can't tell us it changed. */
const POLL_MS = 2500;
/** Wait this long after a change before reading, and again between tries. The game writes in place. */
const SETTLE_MS = 700;
const RETRY_MS = 1200;
const WATCH_KEY = 'market-planner/sync-watch';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const parse = async (f: File) => parseStateFile(new Uint8Array(await f.arrayBuffer()));
const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));
const domName = (e: unknown) => (e instanceof DOMException ? e.name : '');

export function useSaveSync(opts: Options) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [link, setLink] = useState<LinkedSave | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  // A remembered source from an earlier visit; the browser wants a click before reading it again.
  const [stored, setStored] = useState<Source | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  const [watch, setWatchState] = useState(() => {
    try {
      return localStorage.getItem(WATCH_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const linkRef = useRef(link);
  linkRef.current = link;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const lastStamp = useRef<FileStamp | null>(null);
  const inputWhy = useRef<SyncWhy>('load');
  // The read in progress: auto checks skip while one runs, user actions wait for it.
  const busy = useRef<Promise<void> | null>(null);

  const setWatch = (v: boolean) => {
    setWatchState(v);
    try {
      localStorage.setItem(WATCH_KEY, v ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
  };

  const persist = (v: StoredSource) => {
    setStored(v.source ?? null);
    void saveStored(v.source || v.link ? v : null);
  };

  // Come back to the save of the last visit.
  useEffect(() => {
    let live = true;
    loadStored().then(async (rec) => {
      if (!live || !rec) return;
      if (rec.source && !fsAccess) return;
      setStored(rec.source ?? null);
      if (rec.link) {
        setLink(rec.link);
        lastStamp.current = { name: rec.link.fileName, lastModified: rec.link.lastModified, size: rec.link.size };
      }
      if (rec.source && rec.link) {
        const p = await permission(rec.source, false);
        if (!live) return;
        setSource(rec.source);
        setNeedsPermission(p !== 'granted');
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const problemFor = (e: unknown, src: Source | undefined): string => {
    const name = domName(e);
    if (name === 'NotFoundError')
      return src?.kind === 'file'
        ? 'The save file is gone. The game deletes it when a game ends. To pick up new games by themselves, load the save folder instead.'
        : "Can't find the save folder any more. Load your save again.";
    if (name === 'NotAllowedError') return "The browser didn't allow reading the save. Press Reconnect, or load it again.";
    return `Couldn't read the save file. (Details: ${detail(e)})`;
  };

  /** Reads a source (with retries for half-written files) and hands the save to the app. */
  const readFrom = async (src: Source, why: SyncWhy): Promise<void> => {
    if (busy.current) {
      if (why === 'auto') return;
      await busy.current.catch(() => {});
      return readFrom(src, why);
    }
    let done = () => {};
    busy.current = new Promise<void>((r) => (done = r));
    if (why !== 'auto') setStatus({ kind: 'busy' });
    let seen: FileStamp | null = null;
    try {
      const got = await withRetry(
        async () => {
          const found: Found | null = await findCurrent(src, linkRef.current?.fileName, why !== 'auto');
          if (!found) return null;
          seen = found.stamp;
          return { save: await parse(found.file), stamp: found.stamp };
        },
        why === 'load' ? 2 : 3,
        RETRY_MS,
      );
      if (!got) {
        lastStamp.current = null;
        if (why === 'load') {
          setStatus({ kind: 'idle' });
          optsRef.current.onLoadError("There's no .state file in that folder. Choose the Singleplayer folder (see Where is it?).");
        } else setStatus({ kind: 'note', message: 'No game in this folder right now. The next game you play loads here by itself.' });
        return;
      }
      lastStamp.current = got.stamp;
      setStatus({ kind: 'idle' });
      optsRef.current.onSave(got.save, { kind: src.kind, stamp: got.stamp, source: src }, why);
    } catch (e) {
      // Don't try a broken file again until it changes.
      if (seen) lastStamp.current = seen;
      if (domName(e) === 'NotAllowedError') setNeedsPermission(true);
      if (why === 'load') {
        setStatus({ kind: 'idle' });
        optsRef.current.onLoadError(
          domName(e) ? problemFor(e, src) : `Couldn't read that save file. Make sure it's a .state file from the game's save folder. (Details: ${detail(e)})`,
        );
      } else setStatus({ kind: 'problem', message: problemFor(e, src) });
    } finally {
      busy.current = null;
      done();
    }
  };

  const fromInput = async (file: File) => {
    const why = inputWhy.current;
    inputWhy.current = 'load';
    try {
      const save = await parse(file);
      optsRef.current.onSave(save, { kind: 'input', stamp: { name: file.name, lastModified: file.lastModified, size: file.size } }, why);
    } catch (e) {
      optsRef.current.onLoadError(`Couldn't read that save file. Make sure it's a .state file from the game's save folder. (Details: ${detail(e)})`);
    }
  };

  /** Looks at the file and reads it if it changed. */
  const check = useCallback(async () => {
    const src = sourceRef.current;
    if (!src || busy.current || !linkRef.current) return;
    let found: Found | null;
    try {
      found = await findCurrent(src, linkRef.current.fileName);
    } catch (e) {
      if (domName(e) === 'NotAllowedError') setNeedsPermission(true);
      setStatus({ kind: 'problem', message: problemFor(e, src) });
      return;
    }
    if (!found) {
      if (lastStamp.current) setStatus({ kind: 'note', message: 'No game in this folder right now. The next game you play loads here by itself.' });
      lastStamp.current = null;
      return;
    }
    if (!changed(lastStamp.current, found.stamp)) return;
    // Let the game finish writing: read only once the file stops changing.
    await sleep(SETTLE_MS);
    const again = await findCurrent(src, linkRef.current?.fileName).catch(() => null);
    if (!again || changed(found.stamp, again.stamp) || sourceRef.current !== src) return;
    await readFrom(src, 'auto');
  }, []);

  const watching = watch && !!source && !!link && !needsPermission;
  useEffect(() => {
    if (!watching || !source) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let unobserve: (() => void) | null = null;
    const visible = () => document.visibilityState !== 'hidden';
    const kick = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => !stopped && visible() && check(), 300);
    };
    void observe(source, kick).then((stop) => {
      if (stopped) stop?.();
      else if (stop) unobserve = stop;
      // No change events in this browser: poll while the tab is visible.
      else timer = setInterval(() => visible() && check(), POLL_MS);
    });
    const onVisible = () => visible() && check();
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(debounce);
      unobserve?.();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [watching, source, check]);

  return {
    link,
    status,
    watch,
    setWatch,
    /** Refresh reads the file again without a picker, and auto-update can work. */
    live: !!source,
    watching,
    needsPermission,
    /** A file or folder from before that isn't the map on screen now. */
    reopenable: !link && stored ? stored : null,

    pickFile: async () => {
      try {
        const src = await pickFile(sourceRef.current?.handle ?? stored?.handle);
        if (src) await readFrom(src, 'load');
      } catch (e) {
        optsRef.current.onLoadError(problemFor(e, undefined));
      }
    },
    pickFolder: async () => {
      try {
        const src = await pickFolder(sourceRef.current?.handle ?? stored?.handle);
        if (src) await readFrom(src, 'load');
      } catch (e) {
        optsRef.current.onLoadError(problemFor(e, undefined));
      }
    },
    /** Opens the plain file input (browsers without file handles, or a phone). */
    openInput: (why: SyncWhy = 'load') => {
      inputWhy.current = why;
      optsRef.current.openInput();
    },
    fromInput,
    refresh: async () => {
      const src = sourceRef.current;
      if (!src) {
        inputWhy.current = 'refresh';
        optsRef.current.openInput();
        return;
      }
      if (needsPermission) {
        if ((await permission(src, true)) !== 'granted') {
          setStatus({ kind: 'problem', message: "The browser didn't allow reading the save. Load it again with Load game save." });
          return;
        }
        setNeedsPermission(false);
      }
      await readFrom(src, 'refresh');
    },
    reopen: async () => {
      if (!stored) return;
      if ((await permission(stored, true)) !== 'granted') return;
      await readFrom(stored, 'load');
    },
    /** The app put this save on screen. */
    linked: (next: LinkedSave, read: SaveRead) => {
      const src = read.kind === 'input' ? null : (read.source ?? sourceRef.current);
      setLink(next);
      linkRef.current = next;
      sourceRef.current = src;
      setSource(src);
      setNeedsPermission(false);
      setStatus({ kind: 'idle' });
      lastStamp.current = read.stamp;
      persist({ source: src ?? undefined, link: next });
    },
    /** Another map replaced the save's: stop following it (it can still be opened again). */
    unlink: () => {
      if (!linkRef.current) return;
      setLink(null);
      linkRef.current = null;
      setStatus({ kind: 'idle' });
      const src = sourceRef.current;
      setSource(null);
      sourceRef.current = null;
      persist({ source: src ?? undefined, link: null });
    },
  };
}

export type SaveSync = ReturnType<typeof useSaveSync>;
