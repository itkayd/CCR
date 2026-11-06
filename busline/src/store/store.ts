import { create } from 'zustand';

type Theme = 'auto' | 'light' | 'dark';
export type Mode = 'live' | 'schematic';

interface State {
  mode: Mode;
  station: string | null;
  route: string | null;
  theme: Theme;
  /** Height in px of the bottom sheet covering the map (0 on desktop). */
  sheetInset: number;
  /** Bumped to ask the live map to fly back to the user. */
  recentre: number;
  setMode: (m: Mode) => void;
  selectStation: (id: string | null) => void;
  toggleRoute: (id: string | null) => void;
  setRoute: (id: string | null) => void;
  cycleTheme: () => void;
  setSheetInset: (px: number) => void;
  askRecentre: () => void;
}

export const useStore = create<State>((set, get) => ({
  mode: 'live',
  station: null,
  route: null,
  theme: 'auto',
  sheetInset: 0,
  recentre: 0,
  setMode: (mode) => set({ mode, station: null, route: null, sheetInset: 0 }),
  selectStation: (id) => set({ station: id }),
  toggleRoute: (id) => set({ route: id && get().route === id ? null : id }),
  setRoute: (id) => set({ route: id }),
  cycleTheme: () => {
    const next: Theme = ({ auto: 'dark', dark: 'light', light: 'auto' } as const)[get().theme];
    if (next === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    set({ theme: next });
  },
  setSheetInset: (px) => set({ sheetInset: px }),
  askRecentre: () => set({ recentre: get().recentre + 1 }),
}));

/** Resolved light/dark, following the system when the theme is 'auto'. */
export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'auto') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
