import { create } from 'zustand';

type Theme = 'auto' | 'light' | 'dark';

interface State {
  station: string | null;
  route: string | null;
  theme: Theme;
  /** Height in px of the bottom sheet covering the map (0 on desktop). */
  sheetInset: number;
  selectStation: (id: string | null) => void;
  toggleRoute: (id: string | null) => void;
  cycleTheme: () => void;
  setSheetInset: (px: number) => void;
}

export const useStore = create<State>((set, get) => ({
  station: null,
  route: null,
  theme: 'auto',
  sheetInset: 0,
  selectStation: (id) => set({ station: id }),
  toggleRoute: (id) => set({ route: id && get().route === id ? null : id }),
  cycleTheme: () => {
    const next: Theme = ({ auto: 'dark', dark: 'light', light: 'auto' } as const)[get().theme];
    if (next === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    set({ theme: next });
  },
  setSheetInset: (px) => set({ sheetInset: px }),
}));
