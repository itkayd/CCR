import { create } from 'zustand';

type Theme = 'auto' | 'light' | 'dark';

interface State {
  station: string | null;
  route: string | null;
  theme: Theme;
  selectStation: (id: string | null) => void;
  toggleRoute: (id: string | null) => void;
  cycleTheme: () => void;
}

export const useStore = create<State>((set, get) => ({
  station: null,
  route: null,
  theme: 'auto',
  selectStation: (id) => set({ station: id }),
  toggleRoute: (id) => set({ route: id && get().route === id ? null : id }),
  cycleTheme: () => {
    const next: Theme = { auto: 'dark', dark: 'light', light: 'auto' }[get().theme] as Theme;
    if (next === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    set({ theme: next });
  },
}));
