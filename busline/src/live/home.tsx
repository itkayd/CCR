// Home extras: saved trips with live "leave in" countdowns, and service updates.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarClock, ChevronRight, Trash2 } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import type { Data } from '../lib/data';
import { useStore } from '../store/store';
import { deletePlan, describeWhen, leaveTime, recentRoutes, useIssues, usePlans, type Issue, type SavedPlan } from './plans';
import { reminderSupport, enableReminders } from './reminders';

const badgeColour = (data: Data, id: string) => { const r = data.routes.get(id); return r?.via[0] ? data.hubs.get(r.via[0])!.colour! : NEUTRAL; };
/** "Today", "Tomorrow" or the weekday of a leave time. */
const dayLabel = (t: number) => {
  const d = (x: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x));
  if (d(t) === d(Date.now())) return 'Leave at';
  if (d(t) === d(Date.now() + 86_400_000)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(new Date(t));
};
const hhmm = (t: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));

function useNow(ms = 15_000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

function PlanCard({ data, p, issues }: { data: Data; p: SavedPlan; issues: Issue[] }) {
  const { openJourney } = useStore();
  const now = useNow();
  const leave = leaveTime(p, now);
  const to = p.points[p.points.length - 1].place;
  const mine = issues.filter((i) => p.last?.routes.includes(i.line) && i.now);
  const ms = leave === null ? null : leave - now;
  return (
    <article className="plancard">
      <button className="plancard-main" onClick={() => to && openJourney(to, p.id)}>
        <span className={`plan-when${ms !== null && ms < 20 * 60_000 ? ' soon' : ''}`} aria-live="polite">
          {ms === null ? <small>Done</small> : ms <= 60_000 ? <b>Leave now</b> : ms < 60 * 60_000 ? <><small>Leave in</small><b>{Math.ceil(ms / 60_000)} min</b></> : <><small>{dayLabel(leave!)}</small><b>{hhmm(leave!)}</b></>}
        </span>
        <span className="plan-text">
          <b>{p.title}</b>
          <small>{describeWhen(p)}{p.last ? <><span className="dot" />{p.last.minutes} min</> : ''}{p.remind ? <><span className="dot" />reminder on</> : ''}</small>
          <span className="rbadges">
            {(p.last?.routes ?? []).slice(0, 6).map((r) => <span key={r} className="cbadge" style={{ background: badgeColour(data, r) }}>{r}</span>)}
            {mine.length > 0 && <span className="issuechip"><AlertTriangle size={13} aria-hidden="true" /> Service change</span>}
          </span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="chev" />
      </button>
      <button className="iconbtn ghost" aria-label={`Delete ${p.title}`} onClick={() => deletePlan(p.id)}><Trash2 size={17} /></button>
    </article>
  );
}

/** Saved trips (soonest first) and the service-updates chip, above the Nearby cards. */
export function HomeExtras({ data, nearbyLines }: { data: Data; nearbyLines: string[] }) {
  const plans = usePlans();
  const { openUpdates } = useStore();
  const yourLines = useMemo(() => [...new Set([...plans.flatMap((p) => p.last?.routes ?? []), ...recentRoutes()])], [plans]);
  const issues = useIssues([...new Set([...yourLines, ...nearbyLines])]);
  const yours = issues.filter((i) => yourLines.includes(i.line) && i.now);
  const nearby = issues.filter((i) => nearbyLines.includes(i.line) && i.now);
  const now = useNow(60_000);
  const upcoming = plans.map((p) => ({ p, t: leaveTime(p, now) })).filter((x) => x.t !== null).sort((a, b) => a.t! - b.t!);
  const support = reminderSupport();
  const wantsReminders = plans.some((p) => p.remind);
  return (
    <>
      {(yours.length > 0 || nearby.length > 0) && (
        <button className="updateschip" onClick={openUpdates}>
          <AlertTriangle size={17} aria-hidden="true" />
          <span><b>{yours.length ? `${new Set(yours.map((i) => i.line)).size} of your routes` : `${new Set(nearby.map((i) => i.line)).size} routes near you`}</b> have diversions or changes</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
      {upcoming.length > 0 && (
        <section className="plans">
          <h4 className="sec"><CalendarClock size={15} aria-hidden="true" /> Your trips</h4>
          {upcoming.map(({ p }) => <PlanCard key={p.id} data={data} p={p} issues={issues} />)}
          {wantsReminders && support === 'ask' && <button className="ghostbtn" onClick={() => enableReminders()}>Turn on reminders</button>}
          {wantsReminders && support === 'install' && <p className="fineprint">For reminders on iPhone, add Busline to your Home Screen (Share → Add to Home Screen) and open it from there.</p>}
          {wantsReminders && support === 'denied' && <p className="fineprint">Notifications are blocked for this site. Allow them in your browser settings to get reminders.</p>}
        </section>
      )}
    </>
  );
}

/** Service updates for your routes and routes near you. */
export function UpdatesScreen({ data, nearbyLines }: { data: Data; nearbyLines: string[] }) {
  const { back, openRoute } = useStore();
  const plans = usePlans();
  const yourLines = useMemo(() => [...new Set([...plans.flatMap((p) => p.last?.routes ?? []), ...recentRoutes()])], [plans]);
  const allIssues = useIssues([...new Set([...yourLines, ...nearbyLines])]).filter((i) => i.now);
  const yoursHasIssues = allIssues.some((i) => yourLines.includes(i.line));
  const [tab, setTab] = useState<'yours' | 'near'>(yourLines.length && yoursHasIssues ? 'yours' : 'near');
  const lines = tab === 'yours' ? yourLines : nearbyLines;
  const issues = useIssues(lines);
  const byLine = new Map<string, Issue[]>();
  for (const i of issues) (byLine.get(i.line) ?? byLine.set(i.line, []).get(i.line)!).push(i);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  return (
    <>
      <div className="shead">
        <button className="iconbtn ghost" aria-label="Back" onClick={back}><ArrowLeft size={22} /></button>
        <div className="shead-main"><span className="shead-text"><b>Service updates</b><small>Diversions, closures and changes from TfL</small></span></div>
      </div>
      <div className="dirtabs" role="tablist">
        <button role="tab" aria-selected={tab === 'yours'} onClick={() => setTab('yours')}>Your routes ({yourLines.length})</button>
        <button role="tab" aria-selected={tab === 'near'} onClick={() => setTab('near')}>Near you ({nearbyLines.length})</button>
      </div>
      <div className="nlist" data-vaul-no-drag>
        {!lines.length && <p className="empty">{tab === 'yours' ? 'Save a trip or open a route and its updates will show here.' : 'No routes near you yet.'}</p>}
        {lines.length > 0 && !byLine.size && <p className="notice okbox">Good service on {lines.length === 1 ? 'this route' : `all ${lines.length} routes`}.</p>}
        {[...byLine].map(([line, list]) => (
          <article key={line} className="updcard">
            <button className="updhead" onClick={() => openRoute(line)}>
              <span className="nbadge" style={{ background: badgeColour(data, line) }}>{line}</span>
              <b>{list.some((i) => i.now) ? 'Affected now' : 'Planned change'}</b>
              <ChevronRight size={18} aria-hidden="true" className="chev" />
            </button>
            {list.map((i, k) => (
              <div key={k} className={`upd${i.now ? ' now' : ''}`}>
                <span className="upd-kind"><AlertTriangle size={13} aria-hidden="true" /> {i.kind ?? i.status}{i.from ? <><span className="dot" />{fmt(i.from)} – {fmt(i.to)}</> : ''}</span>
                <p>{i.reason}</p>
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}

/** Notices for one route (route screen banner). */
export function RouteIssues({ line }: { line: string }) {
  const issues = useIssues([line]).filter((i) => i.now);
  if (!issues.length) return null;
  return (
    <details className="routeissues">
      <summary><AlertTriangle size={15} aria-hidden="true" /> {issues.length === 1 ? 'Service change on this route' : `${issues.length} service changes on this route`}</summary>
      {issues.map((i, k) => <p key={k}>{i.reason}</p>)}
    </details>
  );
}
