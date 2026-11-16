import { describe, expect, it } from 'vitest';
import { parseStateFile } from '../src/parse/stateFile';
import { toGameState } from '../src/parse/toGameState';
import { detectOs, SAVE_HINTS, saveHint } from '../src/ui/savePaths';
import { changed, formatAgo, gameKeyOf, makeLink, mergeRefresh, newestStateFile, sameGame, withRetry } from '../src/ui/saveSync';
import { type FakeTile, makeSave } from './saveWriter';

const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  cros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

describe('where the save is', () => {
  it('detects the system', () => {
    expect(detectOs({ userAgent: UA.win, platform: 'Win32' })).toBe('windows');
    expect(detectOs({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac');
    expect(detectOs({ userAgent: UA.linux, platform: 'Linux x86_64' })).toBe('linux');
    expect(detectOs({ userAgent: UA.android, platform: 'Linux armv8l' })).toBe('android');
    expect(detectOs({ userAgent: UA.iphone, platform: 'iPhone' })).toBe('ios');
    expect(detectOs({ userAgent: UA.cros })).toBe('chromeos');
    // iPadOS asks for the desktop site and looks like a Mac, but has a touch screen.
    expect(detectOs({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
    // Client hints win when the browser has them.
    expect(detectOs({ userAgent: UA.linux, userAgentData: { platform: 'Windows' } })).toBe('windows');
    expect(detectOs(undefined)).toBe('other');
    expect(detectOs({})).toBe('other');
  });

  it('maps the system to its save folder', () => {
    expect(saveHint('windows')?.paths[0].copy).toBe('%USERPROFILE%\\AppData\\LocalLow\\Midjiwan\\Polytopia');
    expect(saveHint('windows')?.paths[0].full).toMatch(/\\Data\\Singleplayer\\$/);
    expect(saveHint('mac')?.paths[0].copy).toBe('~/Library/Application Support');
    expect(saveHint('mac')?.howTo).toMatch(/⇧⌘G/);
    expect(saveHint('linux')?.paths.map((p) => p.copy)).toEqual([
      '~/.config/unity3d/Midjiwan/Polytopia',
      '~/.local/share/Steam/steamapps/compatdata/874390/pfx/drive_c/users/steamuser/AppData/LocalLow/Midjiwan/Polytopia',
    ]);
    expect(saveHint('android')).toBeNull();
    expect(saveHint('ios')).toBeNull();
    expect(saveHint('other')).toBeNull();
  });

  it('only offers following the folder where Chrome allows it', () => {
    // Chromium refuses ~/Library on macOS and ~/.config, ~/.local/share on Linux.
    expect(Object.entries(SAVE_HINTS).filter(([, h]) => h.canFollow).map(([k]) => k)).toEqual(['windows']);
  });
});

describe('following a folder', () => {
  it('picks the most recently changed .state file', () => {
    const files = [
      { name: 'a.state', lastModified: 100 },
      { name: 'b.state', lastModified: 300 },
      { name: 'notes.txt', lastModified: 900 },
      { name: 'c.STATE', lastModified: 200 },
      { name: '.hidden.state', lastModified: 999 },
    ];
    expect(newestStateFile(files)?.name).toBe('b.state');
    expect(newestStateFile([])).toBeNull();
    expect(newestStateFile([{ name: 'x.json', lastModified: 1 }])).toBeNull();
  });

  it("doesn't flip between games on a tie", () => {
    const files = [
      { name: 'a.state', lastModified: 100 },
      { name: 'b.state', lastModified: 100 },
    ];
    expect(newestStateFile(files, 'a.state')?.name).toBe('a.state');
    expect(newestStateFile(files, 'b.state')?.name).toBe('b.state');
    expect(newestStateFile(files)?.name).toBe(newestStateFile([...files].reverse())?.name);
  });

  it('notices a change by name, time or size', () => {
    const a = { name: 'a.state', lastModified: 1, size: 10 };
    expect(changed(null, a)).toBe(true);
    expect(changed(a, { ...a })).toBe(false);
    expect(changed(a, { ...a, lastModified: 2 })).toBe(true);
    expect(changed(a, { ...a, size: 11 })).toBe(true);
    expect(changed(a, { ...a, name: 'b.state' })).toBe(true);
  });
});

function world(size: number, production = 3): FakeTile[][] {
  const tiles: FakeTile[][] = [];
  for (let y = 0; y < size; y++) {
    const row: FakeTile[] = [];
    for (let x = 0; x < size; x++) {
      const mine = x <= 2 && y <= 2;
      row.push({ terrain: 3, owner: mine ? 1 : 0, ruling: mine ? [1, 1] : undefined, seenBy: [1] });
    }
    tiles.push(row);
  }
  tiles[1][1] = { ...tiles[1][1], improvement: 1, cityName: 'Home', production };
  return tiles;
}

const save = (o: { size?: number; turn?: number; stars?: number; production?: number; techs?: number[] } = {}) =>
  parseStateFile(
    makeSave({
      turn: o.turn ?? 7,
      tiles: world(o.size ?? 6, o.production),
      players: [
        { id: 1, name: 'Me', tribe: 4, stars: o.stars ?? 9, techs: o.techs ?? [] },
        { id: 2, name: 'Bot', tribe: 7, stars: 50, techs: [], ai: true },
      ],
    }),
  );

describe('same game or a new one', () => {
  it('is the same game when the file, map name and size match', () => {
    const a = gameKeyOf(save(), '123.state');
    expect(sameGame(a, gameKeyOf(save({ turn: 9, stars: 20 }), '123.state'))).toBe(true);
    expect(sameGame(a, gameKeyOf(save(), '456.state'))).toBe(false);
    expect(sameGame(a, gameKeyOf(save({ size: 7 }), '123.state'))).toBe(false);
    expect(sameGame(a, { ...a, mapName: 'Other map' })).toBe(false);
    expect(sameGame(null, a)).toBe(false);
  });

  it('remembers the player and the turn of a read', () => {
    const s = save({ turn: 12 });
    const link = makeLink('folder', { name: '123.state', lastModified: 5, size: 99 }, s, 1, 3, 1000);
    expect(link).toEqual({ fileName: '123.state', mapName: 'Test map', width: 6, height: 6, kind: 'folder', playerId: 1, incomeEstimate: 3, turn: 12, lastModified: 5, size: 99, syncedAt: 1000 });
  });
});

describe('refreshing the same game', () => {
  it('takes the game from the save and keeps what you set', () => {
    const first = toGameState(save({ stars: 9, production: 3 }), 1, '123.state');
    // What you changed in the planner since the first load.
    const prev = structuredClone(first.state);
    prev.settings = { ...prev.settings, allowClear: false, allowBurn: false, allowGrow: false, allowDestroy: true, allowNewTech: false, baseIncome: first.incomeEstimate + 2 };
    prev.settings.costs = { ...prev.settings.costs, market: 7 };
    prev.tiles[20].terrain = 'forest';
    prev.cities[0].name = 'Renamed';

    const later = toGameState(save({ turn: 9, stars: 25, production: 5, techs: [6] }), 1, '123.state');
    const next = mergeRefresh(prev, first.incomeEstimate, later.state);

    // From the save:
    expect(next.settings.stars).toBe(25);
    expect(next.settings.owned).toEqual(later.state.settings.owned);
    expect(next.tiles).toEqual(later.state.tiles);
    expect(next.cities).toEqual(later.state.cities);
    expect(next.source).toBe(later.state.source);
    // Kept:
    expect(next.settings).toMatchObject({ allowClear: false, allowBurn: false, allowGrow: false, allowDestroy: true, allowNewTech: false });
    expect(next.settings.costs.market).toBe(7);
    // Your +2 correction to the estimate rides along as the estimate grows from 3 to 5.
    expect(later.incomeEstimate).toBe(5);
    expect(next.settings.baseIncome).toBe(7);
    // Nothing was changed in place.
    expect(later.state.settings.allowClear).toBe(true);
    expect(prev.settings.stars).toBe(9);
  });

  it('keeps a correction downwards, never below zero', () => {
    const first = toGameState(save({ production: 3 }), 1);
    const prev = structuredClone(first.state);
    prev.settings.baseIncome = 1; // you said 2 less than the estimate
    expect(mergeRefresh(prev, 3, toGameState(save({ production: 5 }), 1).state).settings.baseIncome).toBe(3);
    expect(mergeRefresh(prev, 3, toGameState(save({ production: 1 }), 1).state).settings.baseIncome).toBe(0);
  });

  it('keeps any extra fields the save adds', () => {
    const fresh = { ...toGameState(save(), 1).state, extra: 42 } as ReturnType<typeof toGameState>['state'] & { extra: number };
    expect((mergeRefresh(fresh, 0, fresh) as typeof fresh).extra).toBe(42);
  });
});

describe('reading while the game writes', () => {
  const noSleep = async () => {};
  it('retries a half-written file', async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw new Error('truncated');
        return 'ok';
      },
      3,
      10,
      noSleep,
    );
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });

  it('gives up after the last try', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error('broken');
        },
        3,
        10,
        noSleep,
      ),
    ).rejects.toThrow('broken');
    expect(n).toBe(3);
  });

  it("doesn't retry a file that is gone", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new DOMException('gone', 'NotFoundError');
        },
        3,
        10,
        noSleep,
      ),
    ).rejects.toThrow('gone');
    expect(n).toBe(1);
  });
});

describe('sync status', () => {
  it('says how long ago', () => {
    expect(formatAgo(5_000)).toBe('just now');
    expect(formatAgo(-5)).toBe('just now');
    expect(formatAgo(60_000)).toBe('1 min ago');
    expect(formatAgo(125_000)).toBe('2 min ago');
    expect(formatAgo(3 * 3600_000)).toBe('3 h ago');
    expect(formatAgo(24 * 3600_000)).toBe('24 h ago');
    expect(formatAgo(48 * 3600_000)).toBe('2 days ago');
  });
});
