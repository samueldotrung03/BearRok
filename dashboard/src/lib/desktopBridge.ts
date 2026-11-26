// What the desktop shell exposes to the page (electron/preload.cjs). Undefined in a browser.
export type PermissionKind = 'screen' | 'disk' | 'control';
export type PermissionState = 'granted' | 'denied' | 'unknown';

/**
 * The xAI API key this copy of the app keeps, encrypted, for a student with no subscription. The
 * apps for the command line (Claude, ChatGPT, Grok) are connected through the backend instead
 * (src/lib/harnesses.ts). `managed` is false when the app did not start the backend itself.
 */
export interface GrokConnection {
  managed: boolean;
  mode: 'api' | null;
  canStoreKey: boolean;
  error?: string;
}

/** What the menu bar menu shows. Paths are routes inside the app. */
export interface MenuBarData {
  signedIn: boolean;
  searching: boolean;
  deadlines: { label: string; path: string }[];
  top: { label: string; path: string } | null;
}

export type MenuBarAction = { type: 'run' } | { type: 'stop' } | { type: 'open'; path: string };

interface DesktopBridge {
  platform: string;
  /** Full screen on and off. Absent in an older desktop shell. */
  onFullScreen?: (callback: (on: boolean) => void) => () => void;
  /** One-click set-up of Claude, ChatGPT (codex) or Grok in Terminal. Absent in an older desktop shell. */
  harness?: {
    setup: (id: 'claude' | 'codex' | 'grok') => Promise<{ ok: boolean; error?: string }>;
    setupStatus: (id: 'claude' | 'codex' | 'grok') => Promise<{ state: 'idle' | 'running' | 'done' | 'failed'; error?: string }>;
    setupClear: (id: 'claude' | 'codex' | 'grok') => Promise<void>;
  };
  /** Absent in a desktop shell older than the page. */
  grok?: {
    status: () => Promise<GrokConnection>;
    connect: (choice: { mode: 'api'; key: string }) => Promise<GrokConnection>;
    disconnect: () => Promise<GrokConnection>;
  };
  /** The menu bar icon at the top of the screen (macOS). Absent in an older desktop shell. */
  menuBar?: {
    update: (data: MenuBarData) => void;
    onAction: (callback: (action: MenuBarAction) => void) => () => void;
  };
  permissions: () => Promise<Record<PermissionKind, PermissionState>>;
  openPermission: (kind: PermissionKind) => Promise<boolean>;
}

// Undefined when the page is rendered outside a browser (tests render on the server).
export const desktopBridge: DesktopBridge | undefined =
  typeof window === 'undefined' ? undefined : (window as unknown as { bearrokDesktop?: DesktopBridge }).bearrokDesktop;

/**
 * Keeps the `is-fullscreen` class on the page in step with the desktop window, so the sidebar and
 * top bars use the room the hidden window buttons leave. Returns a function that stops it.
 */
export function followFullScreen(bridge: DesktopBridge | undefined, root: HTMLElement): () => void {
  if (!bridge?.onFullScreen) return () => {};
  return bridge.onFullScreen((on) => root.classList.toggle('is-fullscreen', on));
}

const KEY = 'bearrok.allowed';

/** Which abilities the student has said agents may use. Separate from what macOS has granted. */
export function loadAllowed(): Record<PermissionKind, boolean> {
  try {
    return { screen: false, disk: false, control: false, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as object) };
  } catch {
    return { screen: false, disk: false, control: false };
  }
}

export function saveAllowed(allowed: Record<PermissionKind, boolean>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(allowed));
  } catch {
    // Not remembered.
  }
}
