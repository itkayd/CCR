// "Time to leave" reminders for saved trips.
//
// Browsers only let a website notify you while it is open or running in the
// background (and on iPhone only once it is added to the Home Screen). So
// reminders are scheduled here while the app is alive, checked every 30 s.
import { leaveTime, loadPlans, type SavedPlan } from './plans';

const FIRED = 'busline.reminders.fired.v1';
let registration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { registration = await navigator.serviceWorker.register('/sw.js'); } catch { registration = null; }
  return registration;
}

export function reminderSupport(): 'ok' | 'denied' | 'ask' | 'unsupported' | 'install' {
  if (!('Notification' in window)) {
    // iPhone/iPad Safari: only installed (Home Screen) web apps can notify
    return /iP(hone|ad|od)/.test(navigator.userAgent) ? 'install' : 'unsupported';
  }
  return Notification.permission === 'granted' ? 'ok' : Notification.permission === 'denied' ? 'denied' : 'ask';
}

/** Ask for permission (call from a tap). */
export async function enableReminders(): Promise<boolean> {
  await registerServiceWorker();
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } }
  return Notification.permission === 'granted';
}

async function notify(title: string, body: string, tag: string) {
  try {
    const reg = registration ?? (await navigator.serviceWorker?.getRegistration());
    if (reg) { await reg.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' } }); return; }
  } catch { /* fall through */ }
  try { new Notification(title, { body, tag, icon: '/icon-192.png' }); } catch { /* ignore */ }
}

const fired = (): string[] => { try { return JSON.parse(localStorage.getItem(FIRED) ?? '[]'); } catch { return []; } };
const markFired = (k: string) => { try { localStorage.setItem(FIRED, JSON.stringify([k, ...fired()].slice(0, 50))); } catch { /* ignore */ } };

function message(p: SavedPlan, leave: number) {
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(leave));
  const b = p.last?.board;
  const bus = b ? `the ${b.line} from ${b.name}${b.letter ? ` (${b.letter})` : ''}` : 'your bus';
  return { title: `Leave at ${hhmm}: ${p.title}`, body: `Catch ${bus}. About ${p.last?.minutes ?? '?'} min to get there.` };
}

/** Check saved trips and fire any reminder that is due. Returns a stop function. */
export function startReminders(): () => void {
  const tick = () => {
    if (reminderSupport() !== 'ok') return;
    const now = Date.now();
    for (const p of loadPlans()) {
      if (!p.remind) continue;
      const leave = leaveTime(p, now);
      if (leave === null) continue;
      const key = `${p.id}@${leave}`;
      if (now >= leave - p.remind * 60_000 && now < leave + 5 * 60_000 && !fired().includes(key)) {
        const m = message(p, leave);
        notify(m.title, m.body, key);
        markFired(key);
      }
    }
  };
  registerServiceWorker();
  tick();
  const t = window.setInterval(tick, 30_000);
  const vis = () => document.visibilityState === 'visible' && tick();
  document.addEventListener('visibilitychange', vis);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
}
