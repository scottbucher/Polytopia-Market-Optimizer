// Keeps track of the save file the map came from, re-reads it on Refresh, and watches it
// for changes when "Keep up to date" is on. The app decides what a read means (same game
// or a new one); this hook only reads files and reports them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { readPref, writePref } from '../model/prefs';
import { parseStateFile, type RawSave } from '../parse/stateFile';
import { findCurrent, type Found, fsAccess, loadStored, observe, permission, pickFolder, type Source, saveStored, type StoredSource } from './saveSource';
import { changed, type FileStamp, generationGate, type LinkedSave, type SyncWhy, withRetry } from './saveSync';

export type { SyncWhy } from './saveSync';

/** A save that was read, and the handle it came from (none for the plain file input). */
export type SaveRead = { stamp: FileStamp } & ({ kind: 'input' } | { kind: Source['kind']; source: Source });

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
const WATCH_KEY = 'market-planner/sync-watch/v1';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const parse = async (f: File) => parseStateFile(new Uint8Array(await f.arrayBuffer()));
const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));
const domName = (e: unknown) => (e instanceof DOMException ? e.name : '');
const FOLDER_REFUSED = 'No folder was loaded. If you picked one and nothing happened, your browser refused it: use Choose one file instead.';
const NO_GAME = 'No game in this folder right now. The next game you play loads here by itself.';
const notASave = (e: unknown) => `Couldn't read that save file. Make sure it's a .state file from the game's save folder. (Details: ${detail(e)})`;

export function useSaveSync(opts: Options) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [link, setLink] = useState<LinkedSave | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  // A remembered source from an earlier visit; the browser wants a click before reading it again.
  const [stored, setStored] = useState<Source | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  const [watch, setWatchState] = useState(() => readPref<unknown>(WATCH_KEY, true) !== false);
  const linkRef = useRef(link);
  linkRef.current = link;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const lastStamp = useRef<FileStamp | null>(null);
  const inputWhy = useRef<SyncWhy>('load');
  // The read in progress: auto checks skip while one runs, user actions wait for it.
  const busy = useRef<Promise<void> | null>(null);
  // Bumped whenever another map or save goes on screen, so a read that started before
  // (a refresh, or an auto-update still retrying) doesn't bring the old save back.
  const [generation] = useState(generationGate);

  const setWatch = (v: boolean) => {
    setWatchState(v);
    writePref(WATCH_KEY, v);
  };

  const persist = (v: StoredSource) => {
    setStored(v.source ?? null);
    void saveStored(v.source || v.link ? v : null);
  };

  // Come back to the save of the last visit, unless another map or save went on screen meanwhile.
  useEffect(() => {
    let live = true;
    const gen = generation.ticket();
    const current = () => live && generation.isCurrent(gen);
    loadStored().then(async (rec) => {
      if (!current() || !rec) return;
      if (rec.source && !fsAccess) return;
      setStored(rec.source ?? null);
      if (rec.link) {
        setLink(rec.link);
        lastStamp.current = { name: rec.link.fileName, lastModified: rec.link.lastModified, size: rec.link.size };
      }
      if (rec.source && rec.link) {
        const p = await permission(rec.source, false);
        if (!current()) return;
        setSource(rec.source);
        setNeedsPermission(p !== 'granted');
      }
    });
    return () => {
      live = false;
    };
  }, [generation]);

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
    const gen = generation.ticket();
    // A refresh or auto-update of a save that is no longer on screen.
    const gone = () => why !== 'load' && (!generation.isCurrent(gen) || sourceRef.current !== src);
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
      if (gone()) return;
      if (!got) {
        lastStamp.current = null;
        if (why === 'load') {
          setStatus({ kind: 'idle' });
          optsRef.current.onLoadError("There's no .state file in that folder. Choose the Singleplayer folder (see Where is it?).");
        } else setStatus({ kind: 'note', message: NO_GAME });
        return;
      }
      lastStamp.current = got.stamp;
      setStatus({ kind: 'idle' });
      optsRef.current.onSave(got.save, { kind: src.kind, stamp: got.stamp, source: src }, why);
    } catch (e) {
      if (gone()) return;
      // Don't try a broken file again until it changes.
      if (seen) lastStamp.current = seen;
      if (domName(e) === 'NotAllowedError') setNeedsPermission(true);
      if (why === 'load') {
        setStatus({ kind: 'idle' });
        optsRef.current.onLoadError(domName(e) ? problemFor(e, src) : notASave(e));
      } else setStatus({ kind: 'problem', message: problemFor(e, src) });
    } finally {
      // A dropped read takes back its "Reading…" and leaves any other status alone.
      if (gone()) setStatus((st) => (st.kind === 'busy' ? { kind: 'idle' } : st));
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
      optsRef.current.onLoadError(notASave(e));
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
      if (lastStamp.current) setStatus({ kind: 'note', message: NO_GAME });
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
    // No change events in this browser, or the observer broke: poll while the tab is visible.
    const poll = () => {
      if (stopped || timer !== undefined) return;
      unobserve?.();
      unobserve = null;
      timer = setInterval(() => visible() && check(), POLL_MS);
    };
    void observe(source, kick, poll).then((stop) => {
      if (stopped || timer !== undefined) stop?.();
      else if (stop) unobserve = stop;
      else poll();
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

    pickFolder: async () => {
      try {
        const src = await pickFolder(sourceRef.current?.handle ?? stored?.handle);
        // Chrome reports a folder it refuses the same way as a cancel, so say what to try.
        if (!src) optsRef.current.onLoadError(FOLDER_REFUSED);
        else await readFrom(src, 'load');
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
      generation.bump();
      const src = read.kind === 'input' ? null : read.source;
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
      generation.bump();
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
