import {useCallback, useEffect, useSyncExternalStore} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'pv-theme';
const listeners = new Set<() => void>();
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {}
  return 'system';
}

let preference: ThemePreference =
  typeof window === 'undefined' ? 'system' : readPreference();

/** Mirrors the inline script in index.html, which runs before first paint. */
export function applyTheme(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
  return dark ? 'dark' : 'light';
}

function setPreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  applyTheme(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const query = media();
  query.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    query.removeEventListener('change', listener);
  };
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => preference);
  const systemDark = useSyncExternalStore(subscribe, () => media().matches);
  useEffect(() => {
    applyTheme(pref);
  }, [pref, systemDark]);
  const resolved: 'light' | 'dark' =
    pref === 'dark' || (pref === 'system' && systemDark) ? 'dark' : 'light';
  return {
    preference: pref,
    resolved,
    setPreference: useCallback(setPreference, []),
  };
}
