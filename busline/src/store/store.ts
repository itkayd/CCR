import { create } from 'zustand';

// remembered so service updates can cover the routes you usually use
const pushRecent = (id: string) => { try { const k = 'busline.recentRoutes.v1'; const a = JSON.parse(localStorage.getItem(k) ?? '[]'); localStorage.setItem(k, JSON.stringify([id, ...a.filter((x: string) => x !== id)].slice(0, 8))); } catch { /* ignore */ } };

type Theme = 'auto' | 'light' | 'dark';
export type Mode = 'live' | 'schematic';
/** Screens shown in the live sheet; the last one in the stack is visible. */
export interface Overlay { stops: { lon: number; lat: number; c: string; hub: string }[]; buses: { lon: number; lat: number; c: string; label: string }[] }
export interface Focus { lat: number; lon: number; zoom: number }
export interface Place { name: string; lat?: number; lon?: number; query?: string }
export interface Trip { legs: { mode: string; c: string; path: [number, number][] }[]; points: { lon: number; lat: number; kind: 'start' | 'end' | 'change' | 'via'; c: string; label?: string }[] }
export type Screen = { type: 'journey'; to: Place; planId?: string } | { type: 'updates' } | { type: 'nearby' } | { type: 'route'; id: string; dir?: string; focusHub?: string } | { type: 'place'; hub: string };
export type MapProvider = 'google' | 'openfreemap' | 'versatiles';
const PROVIDER_KEY = 'busline.mapProvider';
const savedProvider = (): MapProvider => {
  try { const v = localStorage.getItem(PROVIDER_KEY); return v === 'versatiles' || v === 'openfreemap' ? v : 'google'; } catch { return 'google'; }
};

interface State {
  mode: Mode;
  stack: Screen[];
  openJourney: (to: Place, planId?: string) => void;
  openUpdates: () => void;
  /** set while a journey search runs: the map 'searches' the network */
  searching: { from: { lat: number; lon: number }; to: Place } | null;
  setSearching: (s: State['searching']) => void;
  trip: Trip | null;
  setTrip: (t: Trip | null) => void;
  overlay: Overlay | null;
  setOverlay: (o: Overlay | null) => void;
  focus: Focus | null;
  setFocus: (f: Focus) => void;
  openRoute: (id: string, dir?: string, focusHub?: string) => void;
  openPlace: (hub: string) => void;
  back: () => void;
  home: () => void;
  provider: MapProvider;
  setProvider: (p: MapProvider) => void;
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
  setTheme: (t: Theme) => void;
  setSheetInset: (px: number) => void;
  askRecentre: () => void;
}

export const useStore = create<State>((set, get) => ({
  mode: 'live',
  stack: [{ type: 'nearby' }],
  openJourney: (to, planId) => set({ stack: [...get().stack, { type: 'journey', to, planId }], route: null }),
  openUpdates: () => set({ stack: [...get().stack, { type: 'updates' }], route: null }),
  searching: null,
  setSearching: (searching) => set({ searching }),
  trip: null,
  setTrip: (trip) => set({ trip }),
  overlay: null,
  setOverlay: (overlay) => set({ overlay }),
  focus: null,
  setFocus: (focus) => set({ focus }),
  // `route` mirrors the visible route screen so the map can highlight it
  openRoute: (id, dir, focusHub) => { pushRecent(id); set({ stack: [...get().stack, { type: 'route', id, dir, focusHub }], route: id }); },
  openPlace: (hub) => set({ stack: [...get().stack, { type: 'place', hub }], route: null }),
  back: () => {
    const stack = get().stack.length > 1 ? get().stack.slice(0, -1) : get().stack;
    const top = stack[stack.length - 1];
    set({ stack, route: top.type === 'route' ? top.id : null });
  },
  home: () => set({ stack: [{ type: 'nearby' }], route: null }),
  provider: savedProvider(),
  setProvider: (provider) => { try { localStorage.setItem(PROVIDER_KEY, provider); } catch { /* private mode */ } set({ provider }); },
  station: null,
  route: null,
  theme: 'auto',
  sheetInset: 0,
  recentre: 0,
  setMode: (mode) => set({ mode, station: null, route: null, sheetInset: 0 }),
  selectStation: (id) => set({ station: id }),
  toggleRoute: (id) => set({ route: id && get().route === id ? null : id }),
  setRoute: (id) => set({ route: id }),
  setTheme: (t) => {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    set({ theme: t });
  },
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

// handy for debugging on a phone: window.__busline.getState()
if (typeof window !== 'undefined') (window as unknown as { __busline: typeof useStore }).__busline = useStore;
