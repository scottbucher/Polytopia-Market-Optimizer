// "Load game save" with a hint of where the save is, and the bar that keeps it in sync.

import { useEffect, useRef, useState } from 'react';
import { detectOs, isMobile, MOBILE_NOTE, type Os, SAVE_HINTS, type SaveHint, saveHint } from './savePaths';
import { formatAgo } from './saveSync';
import { fsAccess } from './saveSource';
import type { SaveSync } from './useSaveSync';

export const OS: Os = detectOs(typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } }));
const HINT = saveHint(OS);
/** Chrome/Edge can keep a handle to the save folder on this system (see SaveHint.canFollow). */
export const CAN_FOLLOW = fsAccess && !!HINT?.canFollow;

function CopyPath({ text }: { text: string }) {
  const [done, setDone] = useState<'ok' | 'fail' | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 2000);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <span className="pathrow">
      <code>
        {/* Let long paths wrap after a folder separator rather than mid-name. */}
        {text.split(/(?<=[\\/])/).map((part, i) => (
          <span key={i}>
            {part}
            <wbr />
          </span>
        ))}
      </code>
      <button
        type="button"
        className="small-btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone('ok');
          } catch {
            setDone('fail');
          }
        }}
      >
        {done === 'ok' ? 'Copied' : 'Copy path'}
      </button>
      <span className="sr-only" aria-live="polite">
        {done === 'ok' ? 'Path copied' : done === 'fail' ? "Couldn't copy. Select the path and copy it." : ''}
      </span>
    </span>
  );
}

function Hint({ hint }: { hint: SaveHint }) {
  return (
    <div className="hint">
      {hint.paths.map((p) => (
        <div key={p.copy}>
          {p.label && <span className="small muted">{p.label}</span>}
          <CopyPath text={p.copy} />
        </div>
      ))}
      <p className="small">{hint.howTo}</p>
      <p className="small">{hint.then}</p>
    </div>
  );
}

export function LoadSave({ sync }: { sync: SaveSync }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');
  // Close on Escape or a click outside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !ref.current?.open) return;
      close();
      ref.current.querySelector('summary')?.focus();
    };
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);
  const others = (Object.keys(SAVE_HINTS) as (keyof typeof SAVE_HINTS)[]).filter((k) => SAVE_HINTS[k] !== HINT);
  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <details className="newmap loadsave" ref={ref}>
      <summary className="btn accent" title="Read a .state save file from Polytopia">
        Load game save
      </summary>
      <div className="pop">
        <div className="loadbtns">
          {CAN_FOLLOW ? (
            <>
              <button type="button" className="accent" onClick={act(sync.pickFolder)}>
                Choose save folder
              </button>
              <button type="button" onClick={act(sync.pickFile)}>
                Choose one file
              </button>
            </>
          ) : (
            <button type="button" className="accent" onClick={act(() => sync.openInput('load'))}>
              Choose save file
            </button>
          )}
          {sync.reopenable && (
            <button type="button" onClick={act(sync.reopen)}>
              Open {sync.reopenable.handle.name} again
            </button>
          )}
        </div>
        {CAN_FOLLOW && <p className="small muted">With the folder, the planner follows the game you're playing, new games too. Pick the Singleplayer folder or the Polytopia folder above it.</p>}
        <h3>Where is it?</h3>
        {isMobile(OS) && <p className="small warn">{MOBILE_NOTE}</p>}
        {HINT ? (
          <>
            <Hint hint={HINT} />
            <details className="others">
              <summary className="small">On another computer</summary>
              {others.map((k) => (
                <div key={k}>
                  <strong className="small">{SAVE_HINTS[k].name}</strong>
                  <Hint hint={SAVE_HINTS[k]} />
                </div>
              ))}
            </details>
          </>
        ) : (
          (Object.keys(SAVE_HINTS) as (keyof typeof SAVE_HINTS)[]).map((k) => (
            <div key={k}>
              <strong className="small">{SAVE_HINTS[k].name}</strong>
              <Hint hint={SAVE_HINTS[k]} />
            </div>
          ))
        )}
      </div>
    </details>
  );
}

/** Why auto-update isn't offered, in one line. */
export function noFollowReason(os: Os, canPick: boolean): string {
  if (isMobile(os) || os === 'chromeos') return "Auto-update can't work here: the game keeps its saves where browsers can't reach.";
  if (os === 'mac') return "Auto-update can't work on a Mac: browsers don't let pages watch the Library folder.";
  if (os === 'linux') return "Auto-update can't work here: browsers don't let pages watch hidden app folders.";
  if (!canPick) return 'Auto-update needs Chrome or Edge.';
  if (os === 'windows') return 'For auto-update, load the save folder with Load game save.';
  return 'Auto-update needs Chrome or Edge on Windows.';
}

export function SyncBar({ sync, planStale, onSolve }: { sync: SaveSync; planStale: boolean; onSolve: (() => void) | null }) {
  const link = sync.link;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [link?.syncedAt]);
  if (!link) return null;
  const st = sync.status;
  const what = link.kind === 'input' ? 'Loaded' : 'Synced';
  const when = sync.watching ? 'watching for changes' : formatAgo(now - link.syncedAt);
  return (
    <div className="syncbar" role="region" aria-label="Save file">
      <span className="syncinfo">
        <span className="syncfile" title={link.fileName}>
          {link.fileName}
        </span>
        <span aria-live="polite">
          {st.kind === 'busy' ? 'Reading…' : `${what} turn ${link.turn} · ${when}`}
        </span>
      </span>
      <span className="syncctl">
        {sync.needsPermission ? (
          <button type="button" onClick={sync.refresh} title="The browser asks once per visit before reading the save again">
            Reconnect
          </button>
        ) : (
          <button type="button" onClick={sync.refresh} disabled={st.kind === 'busy'} title={`${sync.live ? 'Read the save file again' : 'Choose the save file again to read it'}. Changes you made to the map are replaced.`}>
            Refresh
          </button>
        )}
        {sync.live ? (
          <label className="toggle small">
            <input type="checkbox" checked={sync.watch} onChange={(e) => sync.setWatch(e.target.checked)} /> Keep up to date
          </label>
        ) : (
          <span className="small muted">{noFollowReason(OS, fsAccess)}</span>
        )}
        {planStale && onSolve && (
          <span className="small">
            Plan is out of date.{' '}
            <button type="button" className="link" onClick={onSolve}>
              Solve again
            </button>
          </span>
        )}
      </span>
      {st.kind === 'note' && <p className="syncmsg small muted">{st.message}</p>}
      {st.kind === 'problem' && (
        <p className="syncmsg small err-text" role="alert">
          {st.message}
        </p>
      )}
    </div>
  );
}
