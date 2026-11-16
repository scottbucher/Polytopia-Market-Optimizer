// Where Polytopia keeps its save files on each platform, and which one the visitor is on.
// Browsers can't open a path by name, so the load flow shows the folder and lets you copy it.

export type Os = 'windows' | 'mac' | 'linux' | 'chromeos' | 'android' | 'ios' | 'other';

export interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}

export function detectOs(nav: NavigatorLike | undefined): Os {
  if (!nav) return 'other';
  const hint = (nav.userAgentData?.platform ?? '').toLowerCase();
  const ua = nav.userAgent ?? '';
  const platform = nav.platform ?? '';
  if (hint === 'android' || /android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || /iphone|ipad|ipod/i.test(platform)) return 'ios';
  if (hint === 'chrome os' || hint === 'chromeos' || /\bCrOS\b/.test(ua)) return 'chromeos';
  if (hint === 'windows' || /windows/i.test(ua) || /^win/i.test(platform)) return 'windows';
  if (hint === 'macos' || /macintosh|mac os x/i.test(ua) || /^mac/i.test(platform)) {
    // iPadOS asks for desktop sites and says it is a Mac; only it has a touch screen.
    return (nav.maxTouchPoints ?? 0) > 1 ? 'ios' : 'mac';
  }
  if (hint === 'linux' || /linux|x11/i.test(ua) || /linux/i.test(platform)) return 'linux';
  return 'other';
}

export interface SavePath {
  /** What the path is, when there's more than one. */
  label?: string;
  /** Pasted into the file dialog. Ends at the last folder we know the name of. */
  copy: string;
  /** The whole path, for the README-style "full path" line. */
  full: string;
}

export interface SaveHint {
  name: string;
  paths: SavePath[];
  /** How to get to the path in that platform's file dialog. */
  howTo: string;
  /** What to open after pasting. */
  then: string;
  /**
   * Whether Chrome and Edge let a page keep a handle to this folder (needed for Refresh
   * without picking the file again, and for auto-update). They refuse app data folders on
   * macOS (~/Library) and Linux (~/.config, ~/.local/share); Windows' LocalLow is allowed.
   */
  canFollow: boolean;
}

const THEN = 'Then open your account folder (a long id), then Data, then Singleplayer. Each game is one .state file.';

export const SAVE_HINTS: Record<'windows' | 'mac' | 'linux', SaveHint> = {
  windows: {
    name: 'Windows',
    paths: [
      {
        copy: '%USERPROFILE%\\AppData\\LocalLow\\Midjiwan\\Polytopia',
        full: '%USERPROFILE%\\AppData\\LocalLow\\Midjiwan\\Polytopia\\<account id>\\Data\\Singleplayer\\',
      },
    ],
    howTo: "Paste it into the address bar at the top of the file dialog and press Enter.",
    then: THEN,
    canFollow: true,
  },
  mac: {
    name: 'Mac',
    paths: [
      {
        copy: '~/Library/Application Support',
        full: '~/Library/Application Support/<Polytopia folder>/<account id>/Data/Singleplayer/',
      },
    ],
    howTo: 'The Library folder is hidden: in the file dialog press ⇧⌘G (Go to folder), paste it and press Return.',
    then: 'Open the Polytopia folder there (its name has Midjiwan or Polytopia in it), then your account folder, Data, Singleplayer. Each game is one .state file.',
    canFollow: false,
  },
  linux: {
    name: 'Linux',
    paths: [
      {
        label: 'Steam',
        copy: '~/.config/unity3d/Midjiwan/Polytopia',
        full: '~/.config/unity3d/Midjiwan/Polytopia/<account id>/Data/Singleplayer/',
      },
      {
        label: 'Steam with Proton',
        copy: '~/.local/share/Steam/steamapps/compatdata/874390/pfx/drive_c/users/steamuser/AppData/LocalLow/Midjiwan/Polytopia',
        full: '~/.local/share/Steam/steamapps/compatdata/874390/pfx/drive_c/users/steamuser/AppData/LocalLow/Midjiwan/Polytopia/<account id>/Data/Singleplayer/',
      },
    ],
    howTo: 'The folder is hidden: in the file dialog press Ctrl+L, paste it and press Enter.',
    then: THEN,
    canFollow: false,
  },
};

export const MOBILE_NOTE = "Phone and tablet saves can't be opened here: the app keeps them where browsers can't reach. Use the Steam version on a computer.";

/** The hint for this platform, or null on phones and unknown systems (show them all). */
export function saveHint(os: Os): SaveHint | null {
  if (os === 'windows' || os === 'mac' || os === 'linux') return SAVE_HINTS[os];
  return null;
}

export function isMobile(os: Os) {
  return os === 'android' || os === 'ios';
}
