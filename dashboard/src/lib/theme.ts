// The app's appearance: light or dark. The choice is kept on this device and applied to the
// <html> element as data-theme, which the stylesheets read. index.html applies the saved choice
// before the page paints, so there is no flash.
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme;

export const THEME_KEY = 'bearrok.theme';
const CHANGED = 'bearrok:theme';

export const themeChoices: { id: ThemeChoice; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** The saved choice; anything else (including the old "system" choice) is light. */
export function readThemeChoice(): ThemeChoice {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0b0f' : '#2f86e0');
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage can be blocked; the choice still applies until the page reloads.
  }
  applyTheme(choice);
  window.dispatchEvent(new CustomEvent(CHANGED));
}

/** The current choice, kept in step with Settings and other windows. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  useEffect(() => {
    const sync = () => {
      const next = readThemeChoice();
      applyTheme(next);
      setChoice(next);
    };
    sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return { choice, theme: choice, set: setThemeChoice };
}
