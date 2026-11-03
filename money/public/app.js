/* China Fund money tracker — vanilla JS, synced through Supabase RPCs guarded by a PIN. */
(function () {
  'use strict';

  // ---------- Config ----------
  var SB_URL = 'https://adnpeaytzgelqxuvpdyf.supabase.co';
  // Public (anon) key. It can only call mt_load / mt_save, which both require the PIN.
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkbnBlYXl0emdlbHF4dXZwZHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MzgwNDcsImV4cCI6MjEwNzQxNDA0N30.JPTOEXRoF0zXBhHT7rf_6SSnXa7t5l-UcrB5dsyc4ug';
  var TZ = 'Europe/London';
  var LS = { pin: 'mt.pin', cache: 'mt.cache', theme: 'mt.theme' };

  // ---------- Small helpers ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { if (v === '' || v == null) return null; var n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : null; }

  var __todayOverride = null; // for testing: window.__mtSetToday('2026-11-05')
  function todayISO() {
    if (__todayOverride) return __todayOverride;
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function d(iso) { return new Date(iso + 'T00:00:00Z'); }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(isoStr, n) { var x = d(isoStr); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
  function diffDays(a, b) { return Math.round((d(a) - d(b)) / 86400000); } // a - b
  function dow(isoStr) { return d(isoStr).getUTCDay(); } // 0 = Sun
  function weekStart(isoStr) { var w = dow(isoStr); return addDays(isoStr, w === 0 ? -6 : 1 - w); }
  function nextSaturday(isoStr) { var w = dow(isoStr); return addDays(isoStr, (6 - w + 7) % 7); }
  var fmtDM = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  var fmtWDM = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  function fDate(isoStr) { return isoStr ? fmtDM.format(d(isoStr)) : ''; }
  function fDay(isoStr) { return isoStr ? fmtWDM.format(d(isoStr)).replace(',', '') : ''; }
  function money(n, opts) {
    if (n == null) return 'TBC';
    var neg = n < 0; var a = Math.abs(n);
    var s = '£' + a.toLocaleString('en-GB', { minimumFractionDigits: a % 1 ? 2 : 0, maximumFractionDigits: 2 });
    if (opts && opts.sign && !neg && n > 0) return '+' + s;
    return (neg ? '−' : '') + s;
  }
  function sum(arr, f) { return arr.reduce(function (t, x) { return t + (f(x) || 0); }, 0); }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }

  // ---------- Seed data ----------
  var GOAL_COLORS = [
    ['blue', '#2a78d6'], ['orange', '#eb6834'], ['aqua', '#1baf7a'], ['yellow', '#eda100'],
    ['magenta', '#e87ba4'], ['green', '#008300'], ['violet', '#6250d6'], ['red', '#e34948']
  ];
  function goalColor(name) { var c = GOAL_COLORS.find(function (x) { return x[0] === name; }); return c ? c[1] : GOAL_COLORS[0][1]; }

  function seedGoals() {
    function goal(o) { return Object.assign({ id: uid(), type: 'save', target: null, deadline: null, priority: 'med', emoji: '🎯', color: 'blue', notes: '', legalRisk: false, status: 'active', order: 0, completedAt: null, createdAt: todayISO() }, o); }
    var g = {
      pcn: goal({ name: 'PCN debt', type: 'payoff', target: 470, deadline: '2026-11-04', priority: 'high', emoji: '🚨', color: 'red', notes: 'CCJ risk. £510 total, £40 already paid.', legalRisk: true }),
      zable: goal({ name: 'Zable', type: 'payoff', target: 220, deadline: '2026-11-04', priority: 'high', emoji: '💳', color: 'orange' }),
      family: goal({ name: 'Family', target: 350, deadline: '2026-11-08', priority: 'high', emoji: '👪', color: 'magenta' }),
      cscs: goal({ name: 'CSCS card', target: null, deadline: '2026-11-28', priority: 'med', emoji: '🦺', color: 'yellow', notes: 'Cost TBC' }),
      china: goal({ name: 'China trip', target: 1175, deadline: '2026-12-02', priority: 'med', emoji: '✈️', color: 'blue', notes: 'Flight £475 + spending £700' }),
      moving: goal({ name: 'Moving out', target: null, deadline: null, priority: 'low', emoji: '🏠', color: 'green', status: 'paused' })
    };
    ['pcn', 'zable', 'family', 'cscs', 'china', 'moving'].forEach(function (k, i) { g[k].order = i; });
    return g;
  }

  function seed() {
    var days = [];
    function day(date, rate, status, note) { days.push({ id: uid(), date: date, rate: rate, status: status, note: note || '' }); }
    day('2026-10-23', 100, 'paid');
    day('2026-10-28', 80, 'unpaid', 'Delayed');
    day('2026-10-29', 100, 'paid');
    day('2026-10-30', 100, 'unpaid');
    day('2026-10-31', 100, 'paid');
    day('2026-11-01', 100, 'off');
    day('2026-11-02', 100, 'unpaid');
    day('2026-11-03', 100, 'unpaid');
    day('2026-11-04', 100, 'off');
    ['2026-11-05', '2026-11-06', '2026-11-07'].forEach(function (x) { day(x, 100, 'scheduled'); });
    for (var x = '2026-11-09'; x <= '2026-11-28'; x = addDays(x, 1)) { if (dow(x) !== 0) day(x, 100, 'scheduled'); }

    var g = seedGoals();
    var diversity = { id: uid(), date: '2026-11-04', source: 'Diversity', amount: 690, status: 'expected', note: 'Final salary' };
    var moneyIn = [
      { id: uid(), date: '2026-10-31', source: 'Job', amount: 100, status: 'received', note: '' },
      { id: uid(), date: '2026-11-02', source: 'Job', amount: 200, status: 'received', note: '' },
      diversity
    ];
    function out(o) { return Object.assign({ id: uid(), status: 'planned', priority: false, goalId: null, note: '', dateLabel: '' }, o); }
    var pcn = out({ date: '2026-11-04', category: 'PCN debt', amount: 470, goalId: g.pcn.id, note: 'CCJ risk' });
    var zable = out({ date: '2026-11-04', category: 'Zable', amount: 220, goalId: g.zable.id });
    var family = out({ date: '2026-11-07', dateLabel: '7/8 Nov', category: 'Family', amount: 350, goalId: g.family.id });
    var flight = out({ date: '2026-11-14', dateLabel: '14/15 Nov', category: 'China flight', amount: 475, goalId: g.china.id });
    var spend = out({ date: '2026-12-02', category: 'China spending money', amount: 700, goalId: g.china.id, note: 'Needed by 2 Dec' });
    var cscs = out({ date: '2026-11-21', dateLabel: 'Late Nov', category: 'CSCS card', amount: null, goalId: g.cscs.id, note: 'Cost TBC' });
    var moneyOut = [
      out({ date: '2026-10-31', category: 'Loan fees', amount: 100, status: 'paid' }),
      out({ date: '2026-11-02', category: 'Spending', amount: 20, status: 'paid' }),
      pcn, zable, family, flight, spend, cscs
    ];
    var plan = [
      { id: uid(), date: '2026-11-04', label: '4 Nov', amount: 690, source: 'Diversity', inId: diversity.id, items: [{ outId: pcn.id }, { outId: zable.id }] },
      { id: uid(), date: '2026-11-07', label: '7/8 Nov', amount: 680, source: 'Job', items: [{ outId: family.id }] },
      { id: uid(), date: '2026-11-14', label: '14/15 Nov', amount: 600, source: 'Job', items: [{ outId: flight.id }] },
      { id: uid(), date: '2026-11-21', label: '21/22 Nov', amount: 600, source: 'Job', items: [{ outId: cscs.id }] },
      { id: uid(), date: '2026-11-28', label: '28/29 Nov', amount: 600, source: 'Job', items: [] }
    ];
    return {
      schema: 2,
      settings: { workUntil: '2026-11-29', defaultRate: 100, adjust: 0 },
      days: days, moneyIn: moneyIn, moneyOut: moneyOut, plan: plan,
      goals: Object.keys(g).map(function (k) { return g[k]; }),
      allocations: []
    };
  }

  // ---------- Goal maths ----------
  var PRI = { high: 0, med: 1, low: 2 };
  var PRI_LABEL = { high: 'High', med: 'Med', low: 'Low' };
  function goalById(id) { return S.goals.find(function (g) { return g.id === id; }); }
  function sortGoals(list) {
    return list.slice().sort(function (a, b) { return (PRI[a.priority] - PRI[b.priority]) || (a.order - b.order); });
  }
  function activeGoals(s) { return sortGoals((s || S).goals.filter(function (g) { return g.status === 'active'; })); }
  function allocatedTo(s, gid) { return sum(s.allocations.filter(function (a) { return a.goalId === gid; }), function (a) { return a.amount; }); }
  function spentOn(s, gid, exceptOutId) {
    return sum(s.moneyOut.filter(function (o) { return o.goalId === gid && o.status === 'paid' && o.id !== exceptOutId; }), function (o) { return o.amount; });
  }
  function heldIn(s, gid) { return allocatedTo(s, gid) - spentOn(s, gid); }

  // When a goal-linked bill is paid, any part not already set aside for that goal is
  // taken from unallocated savings automatically, so goal progress stays right.
  function syncAutoAlloc(o) {
    S.allocations = S.allocations.filter(function (a) { return a.outId !== o.id; });
    if (o.status !== 'paid' || !o.goalId || !o.amount || !goalById(o.goalId)) return;
    var held = allocatedTo(S, o.goalId) - spentOn(S, o.goalId, o.id);
    var short = Math.round((o.amount - Math.max(0, held)) * 100) / 100;
    if (short > 0) S.allocations.push({ id: uid(), date: o.date, goalId: o.goalId, amount: short, outId: o.id, kind: 'auto', note: 'Paid from savings' });
  }

  function projectedBuckets(s, c) {
    // Money expected to be available, by the date it arrives.
    var t = c.today, st = s.settings, tomorrow = addDays(t, 1), b = {};
    function add(dt, v) { if (v) b[dt] = (b[dt] || 0) + v; }
    add(t, c.unallocated);
    s.moneyIn.forEach(function (x) { if (x.status === 'expected') add(x.date > t ? x.date : t, x.amount); });
    s.days.forEach(function (x) {
      var future = x.status === 'scheduled' && x.date >= t && x.date <= st.workUntil;
      if (x.status === 'unpaid' || future) {
        var pay = nextSaturday(x.date > t ? x.date : t);
        if (pay < t) pay = tomorrow;
        add(pay, x.rate);
      }
    });
    return Object.keys(b).sort().map(function (k) { return { date: k, amount: b[k] }; });
  }

  function calc(s) {
    var t = todayISO(), st = s.settings;
    var unpaidDays = s.days.filter(function (x) { return x.status === 'unpaid'; });
    var unpaid = sum(unpaidDays, function (x) { return x.rate; });
    var receivedIn = sum(s.moneyIn.filter(function (x) { return x.status === 'received'; }), function (x) { return x.amount; });
    var expectedIn = sum(s.moneyIn.filter(function (x) { return x.status === 'expected'; }), function (x) { return x.amount; });
    var paidOut = sum(s.moneyOut.filter(function (x) { return x.status === 'paid'; }), function (x) { return x.amount; });
    var planned = s.moneyOut.filter(function (x) { return x.status === 'planned'; });
    var plannedUnlinked = planned.filter(function (x) { return !x.goalId || !s.goals.some(function (g) { return g.id === x.goalId && (g.status === 'active' || g.status === 'paused'); }); });
    var saved = receivedIn - paidOut + (Number(st.adjust) || 0);
    var futureSched = s.days.filter(function (x) { return x.status === 'scheduled' && x.date >= t && x.date <= st.workUntil; });
    var pastSched = s.days.filter(function (x) { return x.status === 'scheduled' && x.date < t; });
    var schedValue = sum(futureSched, function (x) { return x.rate; });

    // Per-goal figures
    var gs = {};
    s.goals.forEach(function (g) {
      var allocated = allocatedTo(s, g.id), spent = spentOn(s, g.id), held = allocated - spent;
      var target = g.target == null ? null : Number(g.target);
      var progress = allocated;
      var left = target == null ? null : Math.max(0, Math.round((target - progress) * 100) / 100);
      var daysLeft = g.deadline ? diffDays(g.deadline, t) : null;
      var perWeek = null;
      if (left != null && left > 0 && daysLeft != null && daysLeft >= 0) perWeek = left / Math.max(1, daysLeft / 7);
      var overdue = daysLeft != null && daysLeft < 0 && (left == null || left > 0);
      gs[g.id] = {
        allocated: allocated, spent: spent, held: held, progress: progress, target: target, left: left, daysLeft: daysLeft,
        perWeek: perWeek, overdue: overdue,
        pct: target ? Math.max(0, Math.min(100, progress / target * 100)) : 0,
        flag: g.status === 'active' && g.type === 'payoff' && (left == null || left > 0) && (overdue || g.legalRisk)
      };
    });
    var heldTotal = sum(s.goals, function (g) { return Math.max(0, gs[g.id].held); });
    var unallocated = Math.round((saved - heldTotal) * 100) / 100;

    var c = {
      today: t, unpaid: unpaid, unpaidCount: unpaidDays.length, receivedIn: receivedIn, expectedIn: expectedIn,
      paidOut: paidOut, saved: saved, unallocated: unallocated, heldTotal: heldTotal, futureSched: futureSched, pastSched: pastSched,
      schedValue: schedValue, projection: unpaid + schedValue, plannedUnlinked: plannedUnlinked, goals: gs
    };

    // Priority waterfall: each goal (in priority order) takes the earliest money that
    // arrives before its deadline. Bills not tied to a goal are paid first.
    var buckets = projectedBuckets(s, c).map(function (x) { return { date: x.date, amount: x.amount }; });
    var debt = 0; // negative balances (e.g. over-allocated) are paid from the next money in
    buckets.forEach(function (bk) { if (bk.amount < 0) { debt += -bk.amount; bk.amount = 0; } else if (debt > 0) { var u = Math.min(debt, bk.amount); bk.amount -= u; debt -= u; } });
    function take(need, by) {
      var got = 0;
      for (var i = 0; i < buckets.length && got < need - 0.001; i++) {
        if (by && buckets[i].date > by) break;
        var u = Math.min(need - got, buckets[i].amount);
        buckets[i].amount -= u; got += u;
      }
      return got;
    }
    var extraCosts = sum(plannedUnlinked, function (x) { return x.amount; });
    plannedUnlinked.slice().sort(byDate).forEach(function (x) { if (x.amount) take(x.amount, null); });
    var behind = [], need = 0;
    activeGoals(s).forEach(function (g) {
      var x = gs[g.id];
      if (x.left == null) { x.status = 'tbc'; return; }
      if (x.left <= 0) { x.status = 'funded'; return; }
      need += x.left;
      var got = take(x.left, g.deadline && g.deadline >= t ? g.deadline : (g.deadline ? t : null));
      x.covered = got; x.shortfall = Math.max(0, x.left - got);
      x.status = x.overdue ? 'overdue' : (x.shortfall < 0.01 ? 'ontrack' : 'behind');
      if (x.status !== 'ontrack') behind.push(g);
    });
    s.goals.forEach(function (g) { if (g.status !== 'active') gs[g.id].status = g.status; });
    var funds = c.unallocated + expectedIn + c.projection;
    c.funds = funds; c.need = need; c.extraCosts = extraCosts;
    c.gap = funds - need - extraCosts;
    c.behind = behind;
    c.onTrack = behind.length === 0 && c.gap >= 0;
    c.tbc = activeGoals(s).filter(function (g) { return gs[g.id].left == null; });
    return c;
  }

  function chartSeries(s) {
    var t = todayISO(), st = s.settings;
    var all = [].concat(s.days, s.moneyIn, s.moneyOut).map(function (x) { return x.date; }).filter(Boolean).sort();
    var start = all[0] || t; if (start > t) start = t;
    var end = addDays(t, 28);
    s.goals.forEach(function (g) { if (g.status === 'active' && g.deadline && g.deadline > end) end = g.deadline; });
    var tomorrow = addDays(t, 1);
    var actIn = {}, actOut = {}, prjIn = {}, prjOut = {};
    function add(map, k, v) { if (!v) return; map[k] = (map[k] || 0) + v; }
    s.moneyIn.forEach(function (x) {
      if (x.status === 'received') add(actIn, x.date, x.amount);
      else add(prjIn, x.date > t ? x.date : tomorrow, x.amount);
    });
    s.moneyOut.forEach(function (x) {
      if (x.status === 'paid') add(actOut, x.date, x.amount);
      else add(prjOut, x.date > t ? x.date : tomorrow, x.amount);
    });
    s.days.forEach(function (x) {
      var future = x.status === 'scheduled' && x.date >= t && x.date <= st.workUntil;
      if (x.status === 'unpaid' || future) {
        var pay = nextSaturday(x.date > t ? x.date : t);
        if (pay <= t) pay = tomorrow;
        add(prjIn, pay, x.rate);
      }
    });
    var labels = [], dates = [], inS = [], outS = [], savedS = [], ci = 0, co = 0, todayIdx = 0;
    var adj = Number(st.adjust) || 0;
    for (var x = start; x <= end; x = addDays(x, 1)) {
      ci += actIn[x] || 0; co += actOut[x] || 0;
      if (x > t) { ci += prjIn[x] || 0; co += prjOut[x] || 0; }
      if (x === t) todayIdx = dates.length;
      dates.push(x); labels.push(fDate(x)); inS.push(ci); outS.push(co); savedS.push(ci - co + adj);
    }
    return { labels: labels, dates: dates, inS: inS, outS: outS, savedS: savedS, todayIdx: todayIdx };
  }

  // ---------- App state & sync ----------
  var S = null;           // data
  var version = 0;        // server version the local copy is based on
  var dirty = false;      // local changes not yet on server
  var syncState = 'idle'; // idle | saving | saved | offline | error
  var pin = lsGet(LS.pin);
  var saveTimer = null, saving = false, retryTimer = null;

  function cache() { lsSet(LS.cache, JSON.stringify({ data: S, version: version, dirty: dirty })); }
  function readCache() { try { return JSON.parse(lsGet(LS.cache) || 'null'); } catch (e) { return null; } }

  function rpc(name, body) {
    return fetch(SB_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var err = new Error((j && (j.hint || j.message)) || ('HTTP ' + r.status));
          err.locked = j && j.message === 'locked';
          err.http = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  function commit(msg) {
    dirty = true; cache(); render();
    if (msg) toast(msg);
    clearTimeout(saveTimer); saveTimer = setTimeout(pushSave, 500);
  }

  function setSync(x) { syncState = x; var el = document.getElementById('sync'); if (el) el.outerHTML = syncBadge(); }

  function pushSave() {
    if (!dirty || !pin) return;
    if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(pushSave, 400); return; }
    saving = true; setSync('saving');
    var snapshot = JSON.stringify(S);
    rpc('mt_save', { p_pin: pin, p_data: JSON.parse(snapshot), p_base_version: version }).then(function (r) {
      saving = false;
      if (r.ok) {
        version = r.version;
        if (JSON.stringify(S) === snapshot) dirty = false; else { clearTimeout(saveTimer); saveTimer = setTimeout(pushSave, 300); }
        cache(); setSync(dirty ? 'saving' : 'saved');
      } else if (r.error === 'conflict') {
        closeSheet(); S = migrate(r.data) || S; version = r.version; dirty = false; cache(); render();
        toast('Your other device changed things first — loaded the latest. Please redo your last change.', 'warn', 6000);
        setSync('saved');
      } else if (r.error === 'bad_pin') {
        lock('PIN no longer valid. Enter it again.');
      } else { setSync('error'); toast('Save failed: ' + (r.error || 'unknown'), 'warn'); }
    }).catch(function (e) {
      saving = false;
      setSync(e.locked ? 'error' : 'offline');
      clearTimeout(retryTimer); retryTimer = setTimeout(pushSave, 15000);
    });
  }

  function migrate(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.days)) return null;
    var base = seed();
    data.settings = Object.assign({}, base.settings, data.settings || {});
    ['moneyIn', 'moneyOut', 'plan', 'allocations'].forEach(function (k) { if (!Array.isArray(data[k])) data[k] = []; });
    if (!Array.isArray(data.goals)) {
      // v1 -> v2: create the starting goals and link existing bills to them by name
      var g = seedGoals(), map = [[/pcn/i, 'pcn'], [/zable/i, 'zable'], [/family/i, 'family'], [/china/i, 'china'], [/cscs/i, 'cscs']];
      data.moneyOut.forEach(function (o) {
        var m = map.find(function (r) { return r[0].test(o.category || ''); });
        o.goalId = m ? g[m[1]].id : null;
        if (m && m[1] === 'pcn') o.priority = false;
        delete o.china;
      });
      data.goals = Object.keys(g).map(function (k) { return g[k]; });
      data.moneyOut.forEach(function (o) {
        if (o.goalId && o.status === 'paid' && o.amount) data.allocations.push({ id: uid(), date: o.date, goalId: o.goalId, amount: o.amount, outId: o.id, kind: 'auto', note: 'Paid from savings' });
      });
      delete data.settings.target; delete data.settings.tripDate;
    }
    data.schema = 2;
    return data;
  }

  function loadFromServer(opts) {
    opts = opts || {};
    if (dirty) { pushSave(); return Promise.resolve(); }
    return rpc('mt_load', { p_pin: pin }).then(function (r) {
      if (!r.ok) { lock('Wrong PIN.'); return; }
      if (r.data == null) {
        S = seed(); version = r.version; dirty = true; cache(); render(); pushSave();
        toast('Loaded your starting data.');
      } else if ((r.version !== version || !S) && !(opts.background && sheetOpen())) {
        S = migrate(r.data); version = r.version; dirty = false; cache(); render();
        if (opts.notify) toast('Synced latest changes.');
      }
      setSync('saved');
    }).catch(function (e) {
      if (e.locked) { lock(e.message); return; }
      setSync('offline');
      if (!S) { renderLock('Can’t reach the server. Check your connection and try again.'); }
    });
  }

  function lock(msg) {
    pin = null; lsDel(LS.pin); lsDel(LS.cache); S = null; version = 0; dirty = false;
    renderLock(msg);
  }

  // ---------- Toast ----------
  function toast(msg, kind, ms) {
    var root = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast-enter pointer-events-auto max-w-sm w-full rounded-xl px-4 py-3 text-sm shadow-lg ' +
      (kind === 'warn' ? 'bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-50' : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 2600);
  }

  // ---------- UI pieces ----------
  var card = 'rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800';
  var btn = 'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold active:scale-[.98] transition select-none';
  var btnPrimary = btn + ' bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400';
  var btnGhost = btn + ' bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
  var input = 'w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500';
  var label = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  var dayPill = {
    paid: ['Paid', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'],
    unpaid: ['Unpaid', 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'],
    off: ['Off', 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'],
    scheduled: ['Scheduled', 'border border-dashed border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400']
  };
  function pill(text, cls) { return '<span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ' + cls + '">' + esc(text) + '</span>'; }

  function syncBadge() {
    var map = {
      idle: ['', 'bg-slate-400', ''], saving: ['Saving…', 'bg-amber-500 animate-pulse', ''],
      saved: ['Synced', 'bg-emerald-500', ''], offline: ['Offline — saved on this device', 'bg-slate-400', ''],
      error: ['Sync error', 'bg-red-500', '']
    };
    var m = map[syncState] || map.idle;
    return '<span id="sync" class="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400" aria-live="polite">' +
      '<span class="h-2 w-2 rounded-full ' + m[1] + '"></span><span>' + m[0] + '</span></span>';
  }

  function stat(labelTxt, value, sub, extra) {
    return '<div class="' + card + ' p-3.5 ' + (extra || '') + '"><div class="text-xs text-slate-500 dark:text-slate-400">' + labelTxt +
      '</div><div class="mt-0.5 text-2xl font-bold tnum">' + value + '</div>' + (sub ? '<div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">' + sub + '</div>' : '') + '</div>';
  }

  function sectionHead(id, title, right) {
    return '<div class="flex items-center justify-between mb-2 mt-7"><h2 id="' + id + '" class="text-lg font-bold">' + title + '</h2>' + (right || '') + '</div>';
  }

  // ---------- Render ----------
  var chart = null;
  var ui = { early: false, late: false, archived: false };

  function render() {
    if (!S) return;
    var c = calc(S), t = c.today;
    var todayRec = S.days.find(function (x) { return x.date === t; });
    var loggedToday = todayRec && (todayRec.status === 'unpaid' || todayRec.status === 'paid');

    var h = '';
    // Header
    h += '<header class="sticky top-0 z-30 bg-slate-50/90 dark:bg-[#0b0f14]/90 backdrop-blur border-b border-slate-200/70 dark:border-slate-800/70">' +
      '<div class="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">' +
      '<div><div class="font-bold leading-tight">Money Tracker</div>' + syncBadge() + '</div>' +
      '<div class="flex items-center gap-1">' +
      '<button data-action="refresh" class="' + btnGhost + ' h-10 w-10" aria-label="Refresh from server">↻</button>' +
      '<button data-action="settings" class="' + btnGhost + ' h-10 w-10" aria-label="Settings">⚙︎</button></div></div></header>';

    h += '<main class="max-w-xl mx-auto px-4 pt-4">';

    // ---- Dashboard
    var status = c.onTrack
      ? '<div class="rounded-2xl p-4 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-900"><div class="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300"><span aria-hidden="true">✓</span> On track</div>'
      : '<div class="rounded-2xl p-4 bg-red-50 border border-red-200 dark:bg-red-950/60 dark:border-red-900"><div class="flex items-center gap-2 font-bold text-red-800 dark:text-red-300"><span aria-hidden="true">!</span> Behind</div>';
    status += '<div class="text-sm mt-1" data-testid="overall">' + (c.behind.length
      ? c.behind.length + ' goal' + (c.behind.length === 1 ? '' : 's') + ' behind: ' + c.behind.map(function (g) { return esc(g.name); }).join(', ') + '. '
      : 'Every goal is covered by its deadline. ') +
      (c.gap >= 0 ? 'Projected surplus ' : 'Projected shortfall ') + '<b class="tnum">' + money(Math.abs(c.gap)) + '</b>.</div>' +
      '<details class="mt-2 text-sm"><summary class="cursor-pointer text-slate-600 dark:text-slate-400">How this is worked out</summary>' +
      '<table class="w-full mt-2 tnum text-sm"><tbody>' +
      row2('Unallocated savings', money(c.unallocated)) + row2('Expected money in', money(c.expectedIn)) + row2('Unpaid wages', money(c.unpaid)) +
      row2(c.futureSched.length + ' scheduled days to ' + fDate(S.settings.workUntil), money(c.schedValue)) +
      row2('<b>Projected funds</b>', '<b>' + money(c.funds) + '</b>') + row2('Still needed for goals', '−' + money(c.need)) +
      (c.extraCosts ? row2('Other planned bills', '−' + money(c.extraCosts)) : '') +
      row2('<b>' + (c.gap >= 0 ? 'Surplus' : 'Shortfall') + '</b>', '<b>' + money(c.gap) + '</b>') + '</tbody></table>' +
      '<div class="text-xs text-slate-500 dark:text-slate-400 mt-1">Goals take money in priority order, using only money that arrives before each deadline. Wages are counted on the Saturday after the work.</div>' +
      (c.tbc.length ? '<div class="text-xs text-slate-500 mt-1">Not counted yet (target TBC): ' + c.tbc.map(function (x) { return esc(x.name); }).join(', ') + '</div>' : '') +
      '</details></div>';

    h += '<section aria-labelledby="dash"><h1 id="dash" class="sr-only">Dashboard</h1>' +
      '<div class="grid grid-cols-2 gap-3">' +
      stat('Unpaid wages owed', '<span data-testid="unpaid">' + money(c.unpaid) + '</span>', c.unpaidCount + ' day' + (c.unpaidCount === 1 ? '' : 's')) +
      stat('Total saved', '<span data-testid="saved">' + money(c.saved) + '</span>', '<span data-testid="unalloc">' + money(c.unallocated) + '</span> unallocated' + (c.unallocated < 0 ? ' <b class="text-red-600 dark:text-red-400">(over-allocated)</b>' : '')) +
      '</div><div class="mt-3">' + status + '</div>';

    // Quick actions
    h += '<div class="grid grid-cols-3 gap-2 mt-3">' +
      (loggedToday
        ? '<button data-action="day" data-id="' + todayRec.id + '" class="' + btnGhost + ' col-span-3 h-14 text-base">✓ Today logged · ' + money(todayRec.rate) + ' ' + dayPill[todayRec.status][0] + '</button>'
        : '<button data-action="worked-today" class="' + btnPrimary + ' col-span-3 h-14 text-base">＋ Worked today (' + money(todayRec && todayRec.status === 'scheduled' ? todayRec.rate : S.settings.defaultRate) + ')</button>') +
      '<button data-action="got-paid" class="' + btnGhost + ' h-12 text-sm">£ Got paid</button>' +
      '<button data-action="out" class="' + btnGhost + ' h-12 text-sm">− Spent</button>' +
      '<button data-action="move" class="' + btnGhost + ' h-12 text-sm">⇄ Move</button></div>';

    // Alerts
    var alerts = [];
    activeGoals().forEach(function (g) {
      var x = c.goals[g.id];
      if (g.type !== 'payoff' || !x.left || x.daysLeft == null || x.daysLeft > 3) return;
      var dd = x.daysLeft;
      var when = dd < 0 ? 'overdue by ' + (-dd) + ' day' + (dd === -1 ? '' : 's') : dd === 0 ? 'due today' : dd === 1 ? 'due tomorrow' : 'due ' + fDate(g.deadline);
      alerts.push('<div class="flex items-center gap-3"><div class="flex-1 text-sm">' + esc(g.emoji) + ' <b>' + esc(g.name) + ' ' + money(x.left) + '</b> ' + when + (g.legalRisk ? ' · ' + riskText(g) : '') + '</div><button data-action="goal-pay" data-id="' + g.id + '" class="' + btnGhost + ' h-9 px-3 text-sm shrink-0">Pay</button></div>');
    });
    S.moneyOut.filter(function (x) { return x.status === 'planned' && x.priority && !x.goalId; }).sort(byDate).forEach(function (x) {
      var dd = diffDays(x.date, t);
      var when = dd < 0 ? 'overdue by ' + (-dd) + ' day' + (dd === -1 ? '' : 's') : dd === 0 ? 'due today' : dd === 1 ? 'due tomorrow' : 'due ' + fDate(x.date);
      alerts.push('<div class="flex items-center gap-3"><div class="flex-1 text-sm"><b>' + esc(x.category) + ' ' + money(x.amount) + '</b> ' + when + (x.note ? ' · ' + esc(x.note) : '') + '</div><button data-action="out-paid" data-id="' + x.id + '" class="' + btnGhost + ' h-9 px-3 text-sm shrink-0">Mark paid</button></div>');
    });
    c.pastSched.sort(byDate).forEach(function (x) {
      alerts.push('<div class="flex items-center gap-2"><div class="flex-1 text-sm">Did you work <b>' + fDay(x.date) + '</b>?</div>' +
        '<button data-action="day-set" data-id="' + x.id + '" data-status="unpaid" class="' + btnGhost + ' h-9 px-3 text-sm">Worked</button>' +
        '<button data-action="day-set" data-id="' + x.id + '" data-status="off" class="' + btnGhost + ' h-9 px-3 text-sm">Off</button></div>');
    });
    S.moneyIn.filter(function (x) { return x.status === 'expected' && x.date <= t; }).forEach(function (x) {
      alerts.push('<div class="flex items-center gap-3"><div class="flex-1 text-sm">Has <b>' + money(x.amount) + '</b> from ' + esc(x.source) + ' arrived?</div><button data-action="in-received" data-id="' + x.id + '" class="' + btnGhost + ' h-9 px-3 text-sm shrink-0">Received</button></div>');
    });
    if (c.unallocated < -0.005) alerts.push('<div class="text-sm">You’ve set aside <b>' + money(-c.unallocated) + '</b> more than you have. Move some back to unallocated.</div>');
    if (alerts.length) {
      h += '<div class="mt-3 rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 p-3.5 space-y-2.5"><div class="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Needs attention</div>' + alerts.join('') + '</div>';
    }
    h += '</section>';

    // ---- Goals
    var act = activeGoals();
    h += sectionHead('goals', 'Goals', '<button data-action="goal" class="' + btnGhost + ' h-9 px-3 text-sm">＋ Add goal</button>');
    h += '<div class="space-y-3" data-testid="goal-list">';
    if (!act.length) h += '<div class="' + card + ' p-6 text-center text-sm text-slate-500">No active goals. Add one to start saving towards it.</div>';
    act.forEach(function (g, i) { h += goalCard(g, c, i, act.length); });
    h += '</div>';
    var paused = sortGoals(S.goals.filter(function (g) { return g.status === 'paused'; }));
    if (paused.length) {
      h += '<div class="mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Paused</div><div class="mt-1.5 space-y-2">' +
        paused.map(function (g) { return miniGoal(g, c, 'Paused'); }).join('') + '</div>';
    }
    var done = S.goals.filter(function (g) { return g.status === 'done'; }).sort(function (a, b) { return (b.completedAt || '') < (a.completedAt || '') ? -1 : 1; });
    if (done.length) {
      h += '<div class="mt-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Done</div><div class="mt-1.5 space-y-2" data-testid="done-list">' +
        done.map(function (g) { return miniGoal(g, c, '✓ Completed ' + fDate(g.completedAt)); }).join('') + '</div>';
    }
    var archived = S.goals.filter(function (g) { return g.status === 'archived'; });
    if (archived.length) {
      h += '<button data-action="toggle-weeks" data-which="archived" class="mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">' + (ui.archived ? '▾ Hide' : '▸ Show') + ' ' + archived.length + ' archived goal' + (archived.length === 1 ? '' : 's') + '</button>';
      if (ui.archived) h += '<div class="mt-1.5 space-y-2">' + archived.map(function (g) { return miniGoal(g, c, 'Archived'); }).join('') + '</div>';
    }

    // ---- Work log
    h += sectionHead('work', 'Work log', '<button data-action="day" class="' + btnGhost + ' h-9 px-3 text-sm">＋ Add day</button>');
    var weeks = {};
    S.days.slice().sort(byDate).forEach(function (x) { var w = weekStart(x.date); (weeks[w] = weeks[w] || []).push(x); });
    h += '<div class="' + card + ' overflow-hidden"><table class="w-full text-sm"><thead class="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60"><tr><th class="text-left font-medium px-3 py-2">Day</th><th class="text-right font-medium px-3 py-2">Rate</th><th class="text-right font-medium px-3 py-2">Status</th></tr></thead>';
    var thisWeek = weekStart(t), keys = Object.keys(weeks).sort();
    var isEarly = function (w) { return w < addDays(thisWeek, -7) && !weeks[w].some(function (x) { return x.status === 'unpaid' || x.status === 'scheduled'; }); };
    var isLate = function (w) { return w > addDays(thisWeek, 7); };
    var nEarly = keys.filter(isEarly).length, nLate = keys.filter(isLate).length;
    if (nEarly) h += '<tbody><tr><td colspan="3" class="p-0"><button data-action="toggle-weeks" data-which="early" class="w-full px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 text-left">' + (ui.early ? '▾ Hide' : '▸ Show') + ' ' + nEarly + ' earlier fully-paid week' + (nEarly === 1 ? '' : 's') + '</button></td></tr></tbody>';
    keys.forEach(function (w) {
      if ((isEarly(w) && !ui.early) || (isLate(w) && !ui.late)) return;
      var list = weeks[w];
      var worked = list.filter(function (x) { return x.status !== 'off'; });
      var isCurrent = w === weekStart(t);
      h += '<tbody><tr class="bg-slate-50/70 dark:bg-slate-800/40"><td colspan="3" class="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">' +
        (isCurrent ? '<b class="text-slate-700 dark:text-slate-200">This week</b> · ' : '') + 'w/c ' + fDate(w) + ' · ' + worked.length + ' day' + (worked.length === 1 ? '' : 's') + ' · <span class="tnum">' + money(sum(worked, function (x) { return x.rate; })) + '</span></td></tr>';
      list.forEach(function (x) {
        var p = dayPill[x.status] || dayPill.scheduled;
        var isToday = x.date === t;
        h += '<tr data-action="day" data-id="' + x.id + '" class="border-t border-slate-100 dark:border-slate-800 cursor-pointer active:bg-slate-100 dark:active:bg-slate-800 ' + (isToday ? 'bg-emerald-50/60 dark:bg-emerald-950/30' : '') + '">' +
          '<td class="px-3 py-2.5"><span class="' + (x.status === 'off' ? 'text-slate-400' : '') + '">' + fDay(x.date) + '</span>' + (isToday ? ' <span class="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">TODAY</span>' : '') + (x.note ? '<div class="text-[11px] text-slate-500 dark:text-slate-400">' + esc(x.note) + '</div>' : '') + '</td>' +
          '<td class="px-3 py-2.5 text-right tnum ' + (x.status === 'off' ? 'text-slate-400 line-through' : '') + (x.rate !== Number(S.settings.defaultRate) ? ' font-semibold' : '') + '">' + money(x.rate) + '</td>' +
          '<td class="px-3 py-2.5 text-right">' + pill(p[0], p[1]) + '</td></tr>';
      });
      h += '</tbody>';
    });
    if (nLate) h += '<tbody><tr><td colspan="3" class="p-0 border-t border-slate-100 dark:border-slate-800"><button data-action="toggle-weeks" data-which="late" class="w-full px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 text-left">' + (ui.late ? '▾ Hide' : '▸ Show') + ' ' + nLate + ' later scheduled week' + (nLate === 1 ? '' : 's') + '</button></td></tr></tbody>';
    h += '</table></div><p class="text-xs text-slate-500 dark:text-slate-400 mt-1.5">Tap a day to mark it paid, change the rate or set it as a day off.</p>';

    // ---- Money in
    h += sectionHead('in', 'Money in', '<button data-action="in" class="' + btnGhost + ' h-9 px-3 text-sm">＋ Add</button>');
    h += listTable(S.moneyIn.slice().sort(byDate), function (x) {
      return '<tr data-action="in" data-id="' + x.id + '" class="border-t border-slate-100 dark:border-slate-800 cursor-pointer active:bg-slate-100 dark:active:bg-slate-800">' +
        '<td class="px-3 py-2.5 whitespace-nowrap">' + fDate(x.date) + '</td><td class="px-3 py-2.5">' + esc(x.source) + (x.note ? '<div class="text-[11px] text-slate-500 dark:text-slate-400">' + esc(x.note) + '</div>' : '') + '</td>' +
        '<td class="px-3 py-2.5 text-right"><div class="tnum font-semibold">' + money(x.amount) + '</div>' + (x.status === 'expected' ? pill('Expected', dayPill.scheduled[1]) : pill('Received', dayPill.paid[1])) + '</td></tr>';
    }, ['Date', 'Source', 'Amount'], 'Received ' + money(c.receivedIn) + (c.expectedIn ? ' · expected ' + money(c.expectedIn) : ''));

    // ---- Money out
    h += sectionHead('out', 'Money out', '<button data-action="out" class="' + btnGhost + ' h-9 px-3 text-sm">＋ Add</button>');
    h += listTable(S.moneyOut.slice().sort(function (a, b) { return (a.status === b.status ? 0 : a.status === 'planned' ? 1 : -1) || byDate(a, b); }), function (x) {
      var overdue = x.status === 'planned' && x.date < t;
      return '<tr data-action="out" data-id="' + x.id + '" class="border-t border-slate-100 dark:border-slate-800 cursor-pointer active:bg-slate-100 dark:active:bg-slate-800">' +
        '<td class="px-3 py-2.5 whitespace-nowrap">' + (x.dateLabel ? esc(x.dateLabel) : fDate(x.date)) + '</td>' +
        '<td class="px-3 py-2.5"><div class="flex flex-wrap items-center gap-1">' + esc(x.category) +
        (x.priority && x.status !== 'paid' ? ' ' + pill('HIGH PRIORITY', 'bg-red-600 text-white dark:bg-red-500 dark:text-red-950') : '') +
        (x.goalId && goalById(x.goalId) ? ' ' + pill((goalById(x.goalId).emoji || '') + ' ' + goalById(x.goalId).name, 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300') : '') +
        (overdue ? ' ' + pill('Overdue', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300') : '') + '</div>' +
        (x.note ? '<div class="text-[11px] text-slate-500 dark:text-slate-400">' + esc(x.note) + '</div>' : '') + '</td>' +
        '<td class="px-3 py-2.5 text-right"><div class="tnum font-semibold">' + money(x.amount) + '</div>' + (x.status === 'paid' ? pill('Paid', dayPill.paid[1]) : pill('Planned', dayPill.scheduled[1])) + '</td></tr>';
    }, ['Date', 'Category', 'Amount'], 'Paid ' + money(c.paidOut) + ' · still to pay ' + money(c.remainingCosts) + (c.tbc.length ? ' + TBC' : ''));

    // ---- Payday plan
    h += sectionHead('plan', 'Payday plan', '<button data-action="plan" class="' + btnGhost + ' h-9 px-3 text-sm">＋ Add</button>');
    h += '<div class="space-y-3">';
    S.plan.slice().sort(byDate).forEach(function (p) {
      var items = planItems(p);
      var allocated = sum(items, function (i) { return i.amount; });
      var left = (Number(p.amount) || 0) - allocated;
      var linkedIn = p.inId && S.moneyIn.find(function (x) { return x.id === p.inId; });
      var done = linkedIn ? linkedIn.status === 'received' : !!p.received;
      var past = p.date < t && !done;
      h += '<div class="' + card + ' p-4 ' + (done ? 'opacity-70' : '') + '"><div class="flex items-start justify-between gap-2">' +
        '<button data-action="plan" data-id="' + p.id + '" class="text-left"><div class="font-bold">' + esc(p.label || fDate(p.date)) + ' <span class="font-normal text-slate-500 dark:text-slate-400">· ' + esc(p.source || '') + '</span></div>' +
        '<div class="text-2xl font-bold tnum">' + money(p.amount) + '</div></button>' +
        (done ? pill('Received', dayPill.paid[1]) : '<button data-action="plan-received" data-id="' + p.id + '" class="' + btnGhost + ' h-9 px-3 text-sm shrink-0' + (past ? ' ring-2 ring-amber-400' : '') + '">Got it</button>') + '</div>' +
        '<ul class="mt-2 space-y-1 text-sm">';
      items.forEach(function (i) {
        h += '<li class="flex justify-between gap-2"><span>' + (i.paid ? '<span class="text-emerald-600 dark:text-emerald-400" aria-label="paid">✓</span> ' : '<span class="text-slate-400" aria-hidden="true">→</span> ') + esc(i.label) + (i.priority && !i.paid ? ' ' + pill('HIGH', 'bg-red-600 text-white dark:bg-red-500 dark:text-red-950') : '') + '</span><span class="tnum">' + money(i.amount) + '</span></li>';
      });
      h += '<li class="flex justify-between gap-2 font-semibold ' + (left < 0 ? 'text-red-700 dark:text-red-400' : 'text-[var(--series-saved)]') + '"><span>' + (left < 0 ? '! Over by' : '→ Save') + '</span><span class="tnum">' + money(Math.abs(left)) + '</span></li></ul></div>';
    });
    h += '</div>';

    // ---- Chart
    h += sectionHead('chart', 'Money over time', '');
    h += '<div class="' + card + ' p-3"><div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 mb-2" aria-hidden="true">' +
      legendKey('var(--series-in)', 'Money in (total)') + legendKey('var(--series-out)', 'Money out (total)') + legendKey('var(--series-saved)', 'Saved') + '</div>' +
      '<div class="relative h-64"><canvas id="mchart" role="img" aria-label="Cumulative money in, money out and savings over time"></canvas></div>' +
      '<p class="text-xs text-slate-500 dark:text-slate-400 mt-2">Solid = actual up to today. Dashed = projected (scheduled work paid at the weekend, expected money in, planned costs).</p></div>';

    h += '<div class="h-6"></div></main>';

    // Bottom nav
    h += '<nav class="fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-t border-slate-200 dark:border-slate-800" style="padding-bottom:env(safe-area-inset-bottom)">' +
      '<div class="max-w-xl mx-auto grid grid-cols-7 text-[10px] text-slate-600 dark:text-slate-300">' +
      [['dash', '🏠', 'Home'], ['goals', '🎯', 'Goals'], ['work', '🗓', 'Work'], ['in', '↓', 'In'], ['out', '↑', 'Out'], ['plan', '📋', 'Plan'], ['chart', '📈', 'Chart']].map(function (n) {
        return '<a href="#' + n[0] + '" data-action="nav" data-target="' + n[0] + '" class="flex flex-col items-center justify-center h-14 gap-0.5"><span class="text-base leading-none" aria-hidden="true">' + n[1] + '</span>' + n[2] + '</a>';
      }).join('') + '</div></nav>';

    var y = window.scrollY;
    document.getElementById('app').innerHTML = h;
    window.scrollTo(0, y);
    drawChart();
  }

  var priPill = {
    high: 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900',
    med: 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
    low: 'bg-slate-50 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  };
  function goalStatusPill(x) {
    var m = {
      ontrack: ['✓ On track', dayPill.paid[1]],
      funded: ['✓ Funded', dayPill.paid[1]],
      behind: ['! Behind ' + money(x.shortfall), 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'],
      overdue: ['! Overdue', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'],
      tbc: ['Target TBC', dayPill.off[1]]
    }[x.status];
    return m ? pill(m[0], m[1]) : '';
  }
  function daysText(x, g) {
    if (!g.deadline) return 'No deadline';
    var d = x.daysLeft;
    if (d < 0) return 'Due ' + fDate(g.deadline) + ' (' + (-d) + 'd ago)';
    if (d === 0) return 'Due today';
    return d + ' day' + (d === 1 ? '' : 's') + ' left · ' + fDate(g.deadline);
  }
  function riskText(g) { return /ccj/i.test(g.notes || '') ? 'CCJ risk' : 'legal risk'; }
  function goalCard(g, c, i, n) {
    var x = c.goals[g.id], col = goalColor(g.color), pay = g.type === 'payoff';
    var h = '<article class="' + card + ' p-4" data-goal="' + g.id + '" aria-label="' + esc(g.name) + '">' +
      '<div class="flex items-start gap-2"><button data-action="goal" data-id="' + g.id + '" class="flex-1 min-w-0 text-left">' +
      '<div class="flex items-center gap-1.5 flex-wrap"><span class="text-lg leading-none" aria-hidden="true">' + esc(g.emoji || '🎯') + '</span><span class="font-bold">' + esc(g.name) + '</span>' +
      pill(PRI_LABEL[g.priority], priPill[g.priority]) + (pay ? pill('Pay off', dayPill.off[1]) : '') + '</div>' +
      '<div class="flex flex-wrap gap-1 mt-1">' + (x.flag ? pill('HIGH PRIORITY' + (g.legalRisk ? ' · ' + riskText(g) : '') + (x.overdue ? ' · overdue' : ''), 'bg-red-600 text-white dark:bg-red-500 dark:text-red-950') : '') + goalStatusPill(x) + '</div></button>' +
      '<div class="flex flex-col gap-1 shrink-0">' +
      '<button data-action="goal-up" data-id="' + g.id + '" class="' + btnGhost + ' h-8 w-8 text-xs' + (i === 0 ? ' opacity-30' : '') + '" aria-label="Move ' + esc(g.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
      '<button data-action="goal-down" data-id="' + g.id + '" class="' + btnGhost + ' h-8 w-8 text-xs' + (i === n - 1 ? ' opacity-30' : '') + '" aria-label="Move ' + esc(g.name) + ' down"' + (i === n - 1 ? ' disabled' : '') + '>▼</button></div></div>' +
      '<div class="mt-2 flex items-baseline gap-1.5 tnum"><span class="text-2xl font-bold" data-testid="g-progress">' + money(x.progress) + '</span><span class="text-sm text-slate-500 dark:text-slate-400">' + (x.target == null ? (pay ? 'paid off' : 'saved') + ' · target TBC' : '/ ' + money(x.target) + (pay ? ' paid off' : ' saved')) + '</span></div>' +
      '<div class="mt-2 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-label="' + esc(g.name) + ' progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(x.pct) + '"><div class="h-full rounded-full" style="width:' + x.pct.toFixed(1) + '%;background:' + col + '"></div></div>' +
      '<div class="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500 dark:text-slate-400 tnum">' +
      '<div><div class="font-semibold text-slate-900 dark:text-slate-100 text-sm" data-testid="g-left">' + (x.left == null ? 'TBC' : money(x.left)) + '</div>' + (pay ? 'left to pay' : 'left') + '</div>' +
      '<div><div class="font-semibold text-slate-900 dark:text-slate-100 text-sm">' + (g.deadline ? (x.daysLeft < 0 ? 'Overdue' : x.daysLeft + 'd') : '—') + '</div>' + (g.deadline ? (pay ? 'due ' : 'by ') + fDate(g.deadline) : 'no deadline') + '</div>' +
      '<div><div class="font-semibold text-slate-900 dark:text-slate-100 text-sm">' + (x.perWeek != null ? money(Math.ceil(x.perWeek)) : x.left === 0 ? '£0' : '—') + '</div>per week</div></div>' +
      (pay && (x.spent || x.held) ? '<div class="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tnum">' + money(x.spent) + ' paid' + (x.held > 0 ? ' · ' + money(x.held) + ' set aside' : '') + '</div>' : (!pay && x.spent ? '<div class="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tnum">' + money(x.held) + ' set aside · ' + money(x.spent) + ' already spent</div>' : '')) +
      (g.notes ? '<div class="mt-1.5 text-xs text-slate-500 dark:text-slate-400">' + esc(g.notes) + '</div>' : '') +
      '<div class="mt-3 grid grid-cols-2 gap-2">' +
      (pay ? '<button data-action="goal-pay" data-id="' + g.id + '" class="' + btnPrimary + ' h-10 text-sm">Pay</button>' : '<button data-action="move" data-to="' + g.id + '" class="' + btnPrimary + ' h-10 text-sm">＋ Add money</button>') +
      (x.left === 0 ? '<button data-action="goal-complete" data-id="' + g.id + '" class="' + btnGhost + ' h-10 text-sm">✓ Mark complete</button>' : '<button data-action="goal" data-id="' + g.id + '" class="' + btnGhost + ' h-10 text-sm">Details</button>') +
      '</div></article>';
    return h;
  }
  function miniGoal(g, c, sub) {
    var x = c.goals[g.id];
    return '<button data-action="goal" data-id="' + g.id + '" class="' + card + ' w-full p-3 flex items-center gap-3 text-left opacity-80"><span class="text-lg" aria-hidden="true">' + esc(g.emoji || '🎯') + '</span>' +
      '<span class="flex-1 min-w-0"><span class="font-semibold">' + esc(g.name) + '</span><span class="block text-xs text-slate-500 dark:text-slate-400">' + esc(sub) + '</span></span>' +
      '<span class="text-sm tnum">' + money(x.progress) + (x.target != null ? ' / ' + money(x.target) : '') + '</span></button>';
  }

  function row2(a, b) { return '<tr><td class="py-0.5 pr-2">' + a + '</td><td class="py-0.5 text-right">' + b + '</td></tr>'; }
  function legendKey(color, text) { return '<span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5 rounded" style="background:' + color + '"></span>' + text + '</span>'; }

  function listTable(rows, rowFn, heads, footer) {
    var h = '<div class="' + card + ' overflow-hidden"><table class="w-full text-sm"><thead class="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60"><tr>' +
      '<th class="text-left font-medium px-3 py-2">' + heads[0] + '</th><th class="text-left font-medium px-3 py-2">' + heads[1] + '</th><th class="text-right font-medium px-3 py-2">' + heads[2] + '</th></tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="3" class="px-3 py-6 text-center text-slate-500">Nothing here yet.</td></tr>';
    rows.forEach(function (x) { h += rowFn(x); });
    h += '</tbody></table>' + (footer ? '<div class="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 tnum">' + footer + '</div>' : '') + '</div>';
    return h;
  }

  function planItems(p) {
    return (p.items || []).map(function (i) {
      if (i.outId) {
        var o = S.moneyOut.find(function (x) { return x.id === i.outId; });
        if (!o) return null;
        return { label: o.category, amount: o.amount, paid: o.status === 'paid', priority: o.priority };
      }
      return { label: i.label || 'Item', amount: num(i.amount), paid: false };
    }).filter(Boolean);
  }

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function drawChart() {
    var el = document.getElementById('mchart');
    if (!el || !window.Chart) return;
    if (chart) { chart.destroy(); chart = null; }
    var cs = chartSeries(S), ti = cs.todayIdx;
    var grid = cssVar('--chart-grid'), text = cssVar('--chart-text');
    var dash = { borderDash: function (ctx) { return ctx.p0DataIndex >= ti ? [5, 4] : undefined; } };
    function ds(lbl, data, color) {
      return { label: lbl, data: data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
        pointHitRadius: 12, tension: 0, stepped: false, segment: dash };
    }
    var todayLine = {
      id: 'todayLine',
      afterDatasetsDraw: function (ch) {
        var x = ch.scales.x.getPixelForValue(ti), a = ch.chartArea, ctx = ch.ctx;
        ctx.save(); ctx.strokeStyle = text; ctx.globalAlpha = 0.5; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
        ctx.globalAlpha = 0.9; ctx.setLineDash([]); ctx.fillStyle = text; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Today', x, a.top + 10); ctx.restore();
      }
    };
    chart = new Chart(el, {
      type: 'line',
      data: { labels: cs.labels, datasets: [ds('Money in', cs.inS, cssVar('--series-in')), ds('Money out', cs.outS, cssVar('--series-out')), ds('Saved', cs.savedS, cssVar('--series-saved'))] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { var i = items[0].dataIndex; return fDay(cs.dates[i]) + (i > ti ? ' (projected)' : ''); },
              label: function (it) { return ' ' + it.dataset.label + ': ' + money(it.parsed.y); }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: text, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 11 } } },
          y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, font: { size: 11 }, maxTicksLimit: 6, callback: function (v) { return '£' + Number(v).toLocaleString('en-GB'); } } }
        }
      },
      plugins: [todayLine]
    });
  }

  // ---------- Sheets ----------
  function openSheet(title, body, onAction) {
    var root = document.getElementById('sheet-root');
    root.innerHTML = '<div class="fixed inset-0 z-40 bg-black/40" data-sheet-close></div>' +
      '<div role="dialog" aria-modal="true" aria-label="' + esc(title) + '" class="sheet-enter fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-3xl bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-2xl" style="padding-bottom:calc(1rem + env(safe-area-inset-bottom))">' +
      '<div class="max-w-xl mx-auto px-4 pt-3"><div class="mx-auto h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700"></div>' +
      '<div class="flex items-center justify-between mt-2 mb-3"><h3 class="text-lg font-bold">' + esc(title) + '</h3><button data-sheet-close class="' + btnGhost + ' h-9 w-9" aria-label="Close">✕</button></div>' +
      '<form id="sheet-form" novalidate>' + body + '</form></div></div>';
    document.body.style.overflow = 'hidden';
    root.onclick = function (e) {
      if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
      var b = e.target.closest('[data-sheet-action]');
      if (b) { e.preventDefault(); onAction(b.getAttribute('data-sheet-action'), formData(), b); }
    };
    document.getElementById('sheet-form').onsubmit = function (e) { e.preventDefault(); onAction('save', formData()); };
  }
  function sheetOpen() { return !!document.getElementById('sheet-form'); }
  function closeSheet() { var r = document.getElementById('sheet-root'); r.onchange = null; r.oninput = null; r.innerHTML = ''; document.body.style.overflow = ''; }
  function formData() {
    var f = document.getElementById('sheet-form'), o = {};
    if (!f) return o;
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value;
    });
    return o;
  }
  function field(lbl, html) { return '<label class="block mb-3"><span class="' + label + '">' + lbl + '</span>' + html + '</label>'; }
  function seg(name, options, value) {
    return '<div class="grid gap-2 mb-3" style="grid-template-columns:repeat(' + options.length + ',minmax(0,1fr))">' + options.map(function (o) {
      return '<label class="cursor-pointer"><input type="radio" class="peer sr-only" name="' + name + '" value="' + o[0] + '"' + (o[0] === value ? ' checked' : '') + '>' +
        '<span class="flex h-11 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold peer-checked:bg-slate-900 peer-checked:text-white peer-checked:border-slate-900 dark:peer-checked:bg-slate-100 dark:peer-checked:text-slate-900 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500">' + o[1] + '</span></label>';
    }).join('') + '</div>';
  }
  function check(name, lbl, on) {
    return '<label class="flex items-center gap-3 mb-3 text-sm"><input type="checkbox" name="' + name + '" class="h-5 w-5 accent-emerald-600"' + (on ? ' checked' : '') + '>' + lbl + '</label>';
  }
  function actions(isEdit, extra) {
    return '<div class="flex gap-2 mt-4">' + (isEdit ? '<button type="button" data-sheet-action="delete" class="' + btn + ' h-12 px-4 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">Delete</button>' : '') +
      (extra || '') + '<button type="submit" class="' + btnPrimary + ' h-12 flex-1">Save</button></div>';
  }
  function confirmDelete() { return window.confirm('Delete this entry?'); }

  function find(list, id) { return S[list].find(function (x) { return x.id === id; }); }
  function remove(list, id) { S[list] = S[list].filter(function (x) { return x.id !== id; }); }

  // Work day sheet
  function daySheet(id) {
    var x = id ? find('days', id) : null;
    var isNew = !x;
    var rec = x || { date: todayISO(), rate: Number(S.settings.defaultRate), status: 'unpaid', note: '' };
    var body = '';
    if (!isNew) {
      body += '<div class="text-sm text-slate-500 dark:text-slate-400 -mt-1 mb-3">' + fDay(rec.date) + ' · now ' + dayPill[rec.status][0] + '</div>' +
        '<div class="grid grid-cols-3 gap-2 mb-2">' +
        '<button type="button" data-sheet-action="set-paid" class="' + btnPrimary + ' h-14 text-sm">✓ Paid</button>' +
        '<button type="button" data-sheet-action="set-unpaid" class="' + btnGhost + ' h-14 text-sm">Worked · unpaid</button>' +
        '<button type="button" data-sheet-action="set-off" class="' + btnGhost + ' h-14 text-sm">Day off</button></div>' +
        (rec.status !== 'paid' ? check('logIn', 'When marking paid, also add ' + money(rec.rate) + ' to Money in', true) : '') +
        '<div class="border-t border-slate-200 dark:border-slate-800 my-4"></div>';
    } else {
      body += field('Date', '<input name="date" type="date" required class="' + input + '" value="' + rec.date + '">');
    }
    body += field('Rate for this day (£)', '<div class="flex gap-2"><input name="rate" type="number" inputmode="decimal" min="0" step="1" class="' + input + ' tnum" value="' + rec.rate + '">' +
      '<button type="button" data-sheet-action="rate-default" class="' + btnGhost + ' h-11 px-3 text-sm shrink-0">£' + S.settings.defaultRate + '</button></div>');
    body += '<span class="' + label + '">Status</span>' + seg('status', [['unpaid', 'Unpaid'], ['paid', 'Paid'], ['off', 'Off'], ['scheduled', 'Sched.']], rec.status);
    body += field('Note', '<input name="note" class="' + input + '" value="' + esc(rec.note) + '" placeholder="Optional">');
    body += actions(!isNew);

    openSheet(isNew ? 'Add work day' : 'Edit work day', body, function (act, f) {
      if (act === 'rate-default') { document.querySelector('#sheet-form [name=rate]').value = S.settings.defaultRate; return; }
      if (act === 'delete') { if (confirmDelete()) { remove('days', x.id); closeSheet(); commit('Day deleted'); } return; }
      var rate = num(f.rate);
      if (rate == null || rate < 0) { toast('Enter a rate', 'warn'); return; }
      if (act.indexOf('set-') === 0) {
        var to = act.slice(4), was = x.status;
        x.rate = rate; x.note = f.note || '';
        x.status = to;
        if (to === 'paid' && was !== 'paid' && f.logIn) {
          S.moneyIn.push({ id: uid(), date: todayISO(), source: 'Job', amount: rate, status: 'received', note: 'Pay for ' + fDay(x.date) });
        }
        closeSheet(); commit(fDay(x.date) + ' → ' + dayPill[to][0]); return;
      }
      if (isNew) {
        if (!f.date) { toast('Pick a date', 'warn'); return; }
        var existing = S.days.find(function (y) { return y.date === f.date; });
        if (existing) { existing.rate = rate; existing.status = f.status || 'unpaid'; existing.note = f.note || ''; }
        else S.days.push({ id: uid(), date: f.date, rate: rate, status: f.status || 'unpaid', note: f.note || '' });
        closeSheet(); commit(existing ? 'Updated ' + fDay(f.date) : 'Added ' + fDay(f.date));
      } else {
        x.rate = rate; x.status = f.status || x.status; x.note = f.note || '';
        closeSheet(); commit('Saved');
      }
    });
  }

  // ----- Splitting money across goals
  function splitGoals() { return sortGoals(S.goals.filter(function (g) { return g.status === 'active' || g.status === 'paused'; })); }
  function splitFields(existing) {
    existing = existing || {};
    var c = calc(S);
    var rows = splitGoals().map(function (g) {
      var x = c.goals[g.id];
      return '<div class="flex items-center gap-2 mb-2"><span class="flex-1 min-w-0 text-sm"><span aria-hidden="true">' + esc(g.emoji || '🎯') + '</span> ' + esc(g.name) +
        '<span class="block text-[11px] text-slate-500 dark:text-slate-400">' + (x.left == null ? 'target TBC' : money(x.left) + ' left') + (g.status === 'paused' ? ' · paused' : '') + '</span></span>' +
        '<input name="sp_' + g.id + '" type="number" inputmode="decimal" min="0" step="0.01" class="' + input + ' w-24 tnum" placeholder="£0" value="' + (existing[g.id] || '') + '" aria-label="Amount for ' + esc(g.name) + '">' +
        '<button type="button" data-sheet-action="fill" data-g="' + g.id + '" class="' + btnGhost + ' h-11 px-2.5 text-xs shrink-0">Fill</button></div>';
    }).join('');
    return '<details class="mb-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3"' + (Object.keys(existing).length ? ' open' : '') + '><summary class="cursor-pointer text-sm font-semibold">Split across goals <span class="font-normal text-slate-500 dark:text-slate-400">(optional)</span></summary><div class="mt-3">' + rows +
      '<div class="flex justify-between text-sm font-semibold border-t border-slate-200 dark:border-slate-800 pt-2 mt-1"><span>Left as unallocated savings</span><span id="split-left" class="tnum"></span></div></div></details>';
  }
  function readSplits(f) {
    var out = [];
    Object.keys(f).forEach(function (k) { if (k.indexOf('sp_') === 0) { var v = num(f[k]); if (v && v > 0) out.push({ goalId: k.slice(3), amount: v }); } });
    return out;
  }
  function wireSplit(amountName) {
    var root = document.getElementById('sheet-root');
    function upd() {
      var f = formData(), amt = num(f[amountName]) || 0, used = sum(readSplits(f), function (x) { return x.amount; });
      var el = document.getElementById('split-left'); if (!el) return;
      var left = Math.round((amt - used) * 100) / 100;
      el.textContent = money(left); el.className = 'tnum ' + (left < 0 ? 'text-red-600 dark:text-red-400' : '');
    }
    root.oninput = upd; upd();
    return function fill(gid) {
      var f = formData(), amt = num(f[amountName]) || 0;
      var others = sum(readSplits(f).filter(function (x) { return x.goalId !== gid; }), function (x) { return x.amount; });
      var x = calc(S).goals[gid], room = Math.max(0, amt - others);
      var v = x.left == null ? room : Math.min(room, x.left);
      document.querySelector('#sheet-form [name="sp_' + gid + '"]').value = v ? Math.round(v * 100) / 100 : '';
      upd();
    };
  }
  function applyInAllocs(m) {
    S.allocations = S.allocations.filter(function (a) { return a.inId !== m.id; });
    if (m.status !== 'received') return;
    (m.splits || []).forEach(function (sp) {
      if (goalById(sp.goalId)) S.allocations.push({ id: uid(), date: m.date, goalId: sp.goalId, amount: sp.amount, inId: m.id, kind: 'split', note: 'From ' + m.source });
    });
  }
  function splitMap(list) { var o = {}; (list || []).forEach(function (x) { o[x.goalId] = (o[x.goalId] || 0) + x.amount; }); return o; }
  function planSplits(p) {
    var o = {};
    (p.items || []).forEach(function (i) {
      var out = i.outId && S.moneyOut.find(function (x) { return x.id === i.outId; });
      if (out && out.goalId && out.amount && out.status === 'planned' && goalById(out.goalId)) o[out.goalId] = (o[out.goalId] || 0) + out.amount;
    });
    return o;
  }

  function inSheet(id, pre) {
    var x = id ? find('moneyIn', id) : null;
    var rec = Object.assign({}, x || { date: todayISO(), source: 'Job', amount: '', status: 'received', note: '', splits: [] }, (pre && pre.rec) || {});
    var body = field('Amount (£)', '<input name="amount" type="number" inputmode="decimal" min="0" step="0.01" class="' + input + ' tnum text-xl font-bold" value="' + (rec.amount == null ? '' : rec.amount) + '" placeholder="0">') +
      '<div class="grid grid-cols-2 gap-3">' + field('Date', '<input name="date" type="date" class="' + input + '" value="' + rec.date + '">') +
      field('Source', '<input name="source" list="srcs" class="' + input + '" value="' + esc(rec.source) + '"><datalist id="srcs"><option value="Job"><option value="Diversity"></datalist>') + '</div>' +
      seg('status', [['received', 'Received'], ['expected', 'Expected']], rec.status) +
      splitFields((pre && pre.splits) || splitMap(rec.splits)) +
      '<p class="text-xs text-slate-500 dark:text-slate-400 -mt-1 mb-3">Splits on expected money are applied when you mark it received.</p>' +
      field('Note', '<input name="note" class="' + input + '" value="' + esc(rec.note) + '" placeholder="Optional">') +
      actions(!!x);
    openSheet(x ? 'Edit money in' : 'Add money in', body, function (act, f, b) {
      if (act === 'fill') return fill(b.getAttribute('data-g'));
      if (act === 'delete') {
        if (confirmDelete()) { S.allocations = S.allocations.filter(function (a) { return a.inId !== x.id; }); remove('moneyIn', x.id); closeSheet(); commit('Deleted'); }
        return;
      }
      var amt = num(f.amount);
      if (amt == null || amt <= 0) { toast('Enter an amount', 'warn'); return; }
      if (!f.date) { toast('Pick a date', 'warn'); return; }
      var splits = readSplits(f), used = sum(splits, function (s2) { return s2.amount; });
      if (used > amt + 0.001) { toast('Splits add up to more than ' + money(amt), 'warn'); return; }
      var o = x || { id: uid() };
      o.date = f.date; o.source = (f.source || 'Other').trim(); o.amount = amt; o.status = f.status || 'received'; o.note = f.note || ''; o.splits = splits;
      if (!x) S.moneyIn.push(o);
      applyInAllocs(o);
      if (pre && pre.planId) { var p = S.plan.find(function (y) { return y.id === pre.planId; }); if (p) p.received = o.status === 'received'; }
      closeSheet();
      commit((x ? 'Saved' : 'Added ' + money(amt) + ' in') + (splits.length && o.status === 'received' ? ' · ' + money(used) + ' to goals, ' + money(amt - used) + ' unallocated' : ''));
    });
    var fill = wireSplit('amount');
  }

  function outSheet(id, pre) {
    var x = id ? find('moneyOut', id) : null;
    var rec = Object.assign({}, x || { date: todayISO(), category: '', amount: '', status: 'paid', priority: false, goalId: null, note: '', dateLabel: '' }, pre || {});
    var cats = {}; S.moneyOut.forEach(function (o) { cats[o.category] = 1; }); ['Spending', 'Food', 'Transport', 'Bills'].forEach(function (k) { cats[k] = 1; });
    var goalOpts = '<option value="">— None —</option>' + sortGoals(S.goals.filter(function (g) { return g.status !== 'archived' || g.id === rec.goalId; })).map(function (g) {
      return '<option value="' + g.id + '"' + (g.id === rec.goalId ? ' selected' : '') + '>' + esc((g.emoji || '') + ' ' + g.name) + '</option>';
    }).join('');
    var body = field('Category', '<input name="category" list="cats" class="' + input + '" value="' + esc(rec.category) + '" placeholder="e.g. Spending"><datalist id="cats">' + Object.keys(cats).map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist>') +
      field('Amount (£) — leave blank if TBC', '<input name="amount" type="number" inputmode="decimal" min="0" step="0.01" class="' + input + ' tnum" value="' + (rec.amount == null ? '' : rec.amount) + '" placeholder="TBC">') +
      '<div class="grid grid-cols-2 gap-3">' + field('Date', '<input name="date" type="date" class="' + input + '" value="' + rec.date + '">') +
      field('Date label (optional)', '<input name="dateLabel" class="' + input + '" value="' + esc(rec.dateLabel) + '" placeholder="e.g. 7/8 Nov">') + '</div>' +
      seg('status', [['paid', 'Paid'], ['planned', 'Planned']], rec.status) +
      field('Towards goal', '<select name="goalId" class="' + input + '">' + goalOpts + '</select>') +
      check('priority', 'High priority', rec.priority) +
      field('Note', '<input name="note" class="' + input + '" value="' + esc(rec.note) + '" placeholder="Optional">') +
      actions(!!x);
    openSheet(x ? 'Edit money out' : 'Add money out', body, function (act, f) {
      if (act === 'delete') {
        if (confirmDelete()) {
          S.allocations = S.allocations.filter(function (a) { return a.outId !== x.id; });
          remove('moneyOut', x.id);
          S.plan.forEach(function (p) { p.items = (p.items || []).filter(function (i) { return i.outId !== x.id; }); });
          closeSheet(); commit('Deleted');
        }
        return;
      }
      var amt = num(f.amount);
      if (!f.category || !f.category.trim()) { toast('Enter a category', 'warn'); return; }
      if (amt != null && amt < 0) { toast('Amount can’t be negative', 'warn'); return; }
      if (f.status === 'paid' && amt == null) { toast('Enter the amount you paid', 'warn'); return; }
      if (!f.date) { toast('Pick a date', 'warn'); return; }
      var o = x || { id: uid() };
      o.category = f.category.trim(); o.amount = amt; o.date = f.date; o.dateLabel = (f.dateLabel || '').trim(); o.status = f.status || 'paid';
      o.priority = !!f.priority; o.goalId = f.goalId || null; o.note = f.note || '';
      delete o.china;
      if (!x) S.moneyOut.push(o);
      syncAutoAlloc(o);
      closeSheet(); commit(x ? 'Saved' : 'Added ' + money(amt) + ' out');
    });
  }

  function gotPaidSheet(prefill) {
    prefill = prefill || {};
    var c = calc(S);
    var amount = prefill.amount != null ? prefill.amount : c.unpaid;
    var body = '<p class="text-sm text-slate-600 dark:text-slate-300 -mt-1 mb-3">Adds the payment to Money in and marks unpaid days as paid, oldest first.</p>' +
      field('Amount received (£)', '<input name="amount" type="number" inputmode="decimal" min="0" step="0.01" class="' + input + ' tnum text-xl font-bold" value="' + (amount || '') + '">') +
      '<div class="grid grid-cols-2 gap-3">' + field('Date', '<input name="date" type="date" class="' + input + '" value="' + todayISO() + '">') +
      field('From', '<input name="source" list="srcs2" class="' + input + '" value="' + esc(prefill.source || 'Job') + '"><datalist id="srcs2"><option value="Job"><option value="Diversity"></datalist>') + '</div>' +
      check('markDays', 'Mark worked days as paid (' + c.unpaidCount + ' unpaid, ' + money(c.unpaid) + ')', (prefill.source || 'Job') === 'Job') +
      splitFields(prefill.splits) +
      '<button type="submit" class="' + btnPrimary + ' h-12 w-full mt-2">Log payment</button>';
    openSheet('Got paid', body, function (act, f, b) {
      if (act === 'fill') return fill(b.getAttribute('data-g'));
      var amt = num(f.amount);
      if (amt == null || amt <= 0) { toast('Enter an amount', 'warn'); return; }
      var splits = readSplits(f), used = sum(splits, function (s2) { return s2.amount; });
      if (used > amt + 0.001) { toast('Splits add up to more than ' + money(amt), 'warn'); return; }
      var marked = 0, left = amt;
      if (f.markDays) {
        S.days.filter(function (x) { return x.status === 'unpaid'; }).sort(byDate).forEach(function (x) {
          if (x.rate <= left + 0.001) { x.status = 'paid'; left -= x.rate; marked++; }
        });
      }
      var m = { id: uid(), date: f.date || todayISO(), source: (f.source || 'Job').trim(), amount: amt, status: 'received', note: marked ? marked + ' day' + (marked === 1 ? '' : 's') + ' paid' : '', splits: splits };
      S.moneyIn.push(m); applyInAllocs(m);
      if (prefill.planId) { var p = S.plan.find(function (y) { return y.id === prefill.planId; }); if (p) p.received = true; }
      closeSheet();
      commit('Logged ' + money(amt) + (marked ? ' · ' + marked + ' day' + (marked === 1 ? '' : 's') + ' marked paid' : '') + (f.markDays && left > 0.001 ? ' · ' + money(left) + ' not matched to a day' : '') + (used ? ' · ' + money(used) + ' to goals' : ''));
    });
    var fill = wireSplit('amount');
  }

  // ----- Moving money
  function moveSheet(pre) {
    pre = pre || {};
    var c = calc(S);
    var gl = sortGoals(S.goals.filter(function (g) { return g.status === 'active' || g.status === 'paused'; }));
    function opts(sel, isFrom) {
      return '<option value="u"' + (sel === 'u' ? ' selected' : '') + '>Unallocated (' + money(c.unallocated) + ')</option>' + gl.map(function (g) {
        var x = c.goals[g.id];
        return '<option value="' + g.id + '"' + (sel === g.id ? ' selected' : '') + '>' + esc((g.emoji || '') + ' ' + g.name) + ' (' + money(Math.max(0, x.held)) + (isFrom ? ' set aside' : '') + ')</option>';
      }).join('');
    }
    var from = pre.from || 'u', to = pre.to || (gl[0] && gl[0].id) || 'u';
    var suggested = '';
    if (to !== 'u' && from === 'u') { var tx = c.goals[to]; suggested = tx && tx.left != null ? Math.max(0, Math.min(tx.left, Math.max(0, c.unallocated))) : ''; }
    var body = field('From', '<select name="from" class="' + input + '">' + opts(from, true) + '</select>') +
      field('To', '<select name="to" class="' + input + '">' + opts(to, false) + '</select>') +
      field('Amount (£)', '<input name="amount" type="number" inputmode="decimal" min="0" step="0.01" class="' + input + ' tnum text-xl font-bold" value="' + (suggested ? Math.round(suggested * 100) / 100 : '') + '">') +
      field('Note', '<input name="note" class="' + input + '" placeholder="Optional">') +
      '<button type="submit" class="' + btnPrimary + ' h-12 w-full mt-1">Move money</button>';
    openSheet(pre.to && pre.from !== pre.to && !pre.from ? 'Add money to goal' : 'Move money', body, function (act, f) {
      var amt = num(f.amount);
      if (amt == null || amt <= 0) { toast('Enter an amount', 'warn'); return; }
      if (f.from === f.to) { toast('Pick two different places', 'warn'); return; }
      var cc = calc(S);
      var avail = f.from === 'u' ? cc.unallocated : Math.max(0, cc.goals[f.from].held);
      if (amt > avail + 0.001) { toast('Only ' + money(Math.max(0, avail)) + ' available there', 'warn'); return; }
      var mid = uid(), dt = todayISO(), note = f.note || '';
      if (f.from !== 'u') S.allocations.push({ id: uid(), date: dt, goalId: f.from, amount: -amt, moveId: mid, kind: 'move', note: note });
      if (f.to !== 'u') S.allocations.push({ id: uid(), date: dt, goalId: f.to, amount: amt, moveId: mid, kind: 'move', note: note });
      closeSheet();
      var name = function (k) { return k === 'u' ? 'unallocated' : goalById(k).name; };
      commit('Moved ' + money(amt) + ' from ' + name(f.from) + ' to ' + name(f.to));
    });
  }

  // ----- Goals
  function normaliseOrder() { sortGoals(S.goals).forEach(function (g, i) { g.order = i; }); }
  function moveGoal(id, dir) {
    var arr = activeGoals(), i = arr.findIndex(function (g) { return g.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    var g = arr[i], other = arr[j];
    arr[i] = other; arr[j] = g;
    var changed = g.priority !== other.priority;
    if (changed) g.priority = other.priority;
    arr.forEach(function (x, k) { x.order = k; });
    normaliseOrder();
    commit(g.name + ' moved ' + (dir < 0 ? 'up' : 'down') + (changed ? ' · now ' + PRI_LABEL[g.priority] + ' priority' : ''));
  }
  function payGoal(g) {
    var planned = S.moneyOut.filter(function (o) { return o.goalId === g.id && o.status === 'planned'; }).sort(byDate)[0];
    if (planned) return outSheet(planned.id, { status: 'paid', date: planned.date > todayISO() ? todayISO() : planned.date });
    var x = calc(S).goals[g.id];
    outSheet(null, { category: g.name, amount: x.left || '', goalId: g.id, status: 'paid' });
  }
  function releaseHeld(g, why) {
    var held = calc(S).goals[g.id].held;
    if (held > 0.004) S.allocations.push({ id: uid(), date: todayISO(), goalId: g.id, amount: -held, kind: 'release', note: why });
    return held;
  }
  function completeGoal(g) {
    var x = calc(S).goals[g.id];
    if (x.left && x.left > 0 && !window.confirm((g.type === 'payoff' ? money(x.left) + ' is still left to pay. ' : money(x.left) + ' short of the target. ') + 'Mark ' + g.name + ' complete anyway?')) return;
    function finish(msg) { g.status = 'done'; g.completedAt = todayISO(); closeSheet(); commit(msg || g.name + ' completed 🎉'); }
    if (x.held > 0.004) {
      openSheet('Complete ' + g.name, '<p class="text-sm mb-4"><b class="tnum">' + money(x.held) + '</b> is still set aside for this goal. What happened to it?</p>' +
        '<button type="button" data-sheet-action="spent" class="' + btnPrimary + ' h-12 w-full mb-2">I spent it — log ' + money(x.held) + ' as money out</button>' +
        '<button type="button" data-sheet-action="release" class="' + btnGhost + ' h-12 w-full">Return it to unallocated savings</button>', function (act) {
        if (act === 'spent') {
          var o = { id: uid(), date: todayISO(), category: g.name, amount: Math.round(x.held * 100) / 100, status: 'paid', priority: false, goalId: g.id, note: 'Goal completed', dateLabel: '' };
          S.moneyOut.push(o); syncAutoAlloc(o); finish(g.name + ' completed · ' + money(o.amount) + ' logged as spent');
        } else if (act === 'release') { releaseHeld(g, 'Goal completed'); finish(g.name + ' completed · ' + money(x.held) + ' back to unallocated'); }
      });
      return;
    }
    finish();
  }
  function deleteGoal(g) {
    var x = calc(S).goals[g.id];
    if (!window.confirm('Delete "' + g.name + '"?' + (x.held > 0 ? ' The ' + money(x.held) + ' set aside goes back to unallocated.' : '') + ' This can’t be undone.')) return;
    S.allocations = S.allocations.filter(function (a) { return a.goalId !== g.id; });
    S.moneyOut.forEach(function (o) { if (o.goalId === g.id) o.goalId = null; });
    S.moneyIn.forEach(function (m) { if (m.splits) m.splits = m.splits.filter(function (sp) { return sp.goalId !== g.id; }); });
    S.goals = S.goals.filter(function (y) { return y.id !== g.id; });
    closeSheet(); commit('Deleted ' + g.name);
  }

  function goalSheet(id) {
    var g = id ? goalById(id) : null;
    var rec = g || { name: '', type: 'save', target: '', deadline: '', priority: 'med', emoji: '🎯', color: GOAL_COLORS[S.goals.length % GOAL_COLORS.length][0], notes: '', legalRisk: false, status: 'active' };
    var c = calc(S), x = g ? c.goals[g.id] : null;
    var body = '';
    if (g) {
      var st = g.status;
      body += '<div class="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 mb-4 text-sm tnum">' +
        '<div class="flex justify-between"><span>' + (g.type === 'payoff' ? 'Paid off' : 'Saved') + '</span><b>' + money(x.progress) + ' / ' + money(x.target) + '</b></div>' +
        '<div class="flex justify-between text-slate-500 dark:text-slate-400"><span>Set aside now</span><span>' + money(Math.max(0, x.held)) + '</span></div>' +
        (x.spent ? '<div class="flex justify-between text-slate-500 dark:text-slate-400"><span>Spent / paid</span><span>' + money(x.spent) + '</span></div>' : '') +
        (g.completedAt ? '<div class="flex justify-between text-slate-500 dark:text-slate-400"><span>Completed</span><span>' + fDate(g.completedAt) + '</span></div>' : '') + '</div>';
      body += '<div class="grid grid-cols-2 gap-2 mb-4">';
      if (st === 'active' || st === 'paused') {
        body += (g.type === 'payoff' ? '<button type="button" data-sheet-action="pay" class="' + btnPrimary + ' h-11 text-sm">Pay</button>' : '<button type="button" data-sheet-action="add-money" class="' + btnPrimary + ' h-11 text-sm">＋ Add money</button>') +
          '<button type="button" data-sheet-action="move-out" class="' + btnGhost + ' h-11 text-sm">⇄ Move money out</button>' +
          '<button type="button" data-sheet-action="complete" class="' + btnGhost + ' h-11 text-sm">✓ Mark complete</button>' +
          '<button type="button" data-sheet-action="archive" class="' + btnGhost + ' h-11 text-sm">Archive</button>';
      } else {
        body += '<button type="button" data-sheet-action="reopen" class="' + btnGhost + ' h-11 text-sm col-span-2">' + (st === 'archived' ? 'Unarchive' : 'Reopen goal') + '</button>';
      }
      body += '</div><div class="border-t border-slate-200 dark:border-slate-800 mb-4"></div>';
    }
    body += field('Name', '<input name="name" class="' + input + '" value="' + esc(rec.name) + '" placeholder="e.g. Holiday" required>') +
      '<span class="' + label + '">Type</span>' + seg('type', [['save', 'Save up'], ['payoff', 'Pay off a debt']], rec.type) +
      '<div class="grid grid-cols-2 gap-3">' +
      field('Target (£) — blank = TBC', '<input name="target" type="number" inputmode="decimal" min="0" step="0.01" class="' + input + ' tnum" value="' + (rec.target == null ? '' : rec.target) + '" placeholder="TBC">') +
      field('Deadline (optional)', '<input name="deadline" type="date" class="' + input + '" value="' + (rec.deadline || '') + '">') + '</div>' +
      '<span class="' + label + '">Priority</span>' + seg('priority', [['high', 'High'], ['med', 'Med'], ['low', 'Low']], rec.priority) +
      '<div class="grid grid-cols-[5rem_1fr] gap-3">' + field('Emoji', '<input name="emoji" class="' + input + ' text-center text-xl" maxlength="4" value="' + esc(rec.emoji) + '">') +
      '<div><span class="' + label + '">Colour</span><div class="flex flex-wrap gap-2 mb-3">' + GOAL_COLORS.map(function (cl) {
        return '<label class="cursor-pointer"><input type="radio" name="color" value="' + cl[0] + '" class="peer sr-only"' + (cl[0] === rec.color ? ' checked' : '') + '><span class="block h-8 w-8 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-slate-900 peer-checked:ring-2 peer-checked:ring-slate-900 dark:peer-checked:ring-slate-100 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500" style="background:' + cl[1] + '" title="' + cl[0] + '"></span></label>';
      }).join('') + '</div></div></div>' +
      check('legalRisk', 'Legal risk (e.g. CCJ) — always flag as HIGH PRIORITY', rec.legalRisk) +
      (g && (g.status === 'active' || g.status === 'paused') ? check('paused', 'Paused (not counted in On track)', g.status === 'paused') : '') +
      field('Notes', '<textarea name="notes" rows="2" class="' + input + '" placeholder="Optional">' + esc(rec.notes) + '</textarea>') +
      actions(!!g);
    openSheet(g ? 'Edit goal' : 'Add goal', body, function (act, f) {
      if (act === 'delete') return deleteGoal(g);
      if (act === 'pay') { closeSheet(); return payGoal(g); }
      if (act === 'add-money') { closeSheet(); return moveSheet({ from: 'u', to: g.id }); }
      if (act === 'move-out') { closeSheet(); return moveSheet({ from: g.id, to: 'u' }); }
      if (act === 'complete') return completeGoal(g);
      if (act === 'archive') {
        if (!window.confirm('Archive "' + g.name + '"? It will be hidden from the dashboard.')) return;
        var rel = releaseHeld(g, 'Goal archived'); g.status = 'archived'; closeSheet();
        return commit(g.name + ' archived' + (rel > 0.004 ? ' · ' + money(rel) + ' back to unallocated' : ''));
      }
      if (act === 'reopen') { g.status = 'active'; g.completedAt = null; normaliseOrder(); closeSheet(); return commit(g.name + ' is active again'); }
      var name = (f.name || '').trim();
      if (!name) { toast('Give the goal a name', 'warn'); return; }
      var target = num(f.target);
      if (target != null && target <= 0) { toast('Target must be more than £0 (or blank for TBC)', 'warn'); return; }
      var o = g || { id: uid(), status: 'active', completedAt: null, createdAt: todayISO() };
      var priChanged = g && g.priority !== f.priority;
      o.name = name; o.type = f.type || 'save'; o.target = target; o.deadline = f.deadline || null; o.priority = f.priority || 'med';
      o.emoji = (f.emoji || '').trim() || '🎯'; o.color = f.color || 'blue'; o.notes = f.notes || ''; o.legalRisk = !!f.legalRisk;
      if (g && (g.status === 'active' || g.status === 'paused')) g.status = f.paused ? 'paused' : 'active';
      if (!g || priChanged) {
        // place by deadline within its priority group
        var peers = sortGoals(S.goals.filter(function (y) { return y.priority === o.priority && y.id !== o.id; }));
        var before = peers.find(function (y) { return o.deadline && (!y.deadline || y.deadline > o.deadline); });
        o.order = before ? before.order - 0.5 : (peers.length ? peers[peers.length - 1].order + 0.5 : S.goals.length);
      }
      if (!g) S.goals.push(o);
      normaliseOrder();
      closeSheet(); commit(g ? 'Goal saved' : 'Added goal ' + name);
    });
  }

  function planSheet(id) {
    var p = id ? S.plan.find(function (x) { return x.id === id; }) : null;
    var rec = p ? JSON.parse(JSON.stringify(p)) : { date: todayISO(), label: '', amount: '', source: 'Job', items: [] };
    var outs = S.moneyOut.filter(function (o) { return o.status === 'planned' || rec.items.some(function (i) { return i.outId === o.id; }); }).sort(byDate);
    function itemRow(i, n) {
      var opts = '<option value="">Custom…</option>' + outs.map(function (o) { return '<option value="' + o.id + '"' + (i.outId === o.id ? ' selected' : '') + '>' + esc(o.category) + ' (' + money(o.amount) + ')</option>'; }).join('');
      return '<div class="flex gap-2 mb-2" data-item="' + n + '"><select name="io' + n + '" class="' + input + ' flex-1 min-w-0">' + opts + '</select>' +
        '<input name="il' + n + '" class="' + input + ' flex-1 min-w-0' + (i.outId ? ' hidden' : '') + '" placeholder="Label" value="' + esc(i.label || '') + '">' +
        '<input name="ia' + n + '" type="number" inputmode="decimal" class="' + input + ' w-20 tnum' + (i.outId ? ' hidden' : '') + '" placeholder="£" value="' + (i.amount == null ? '' : esc(i.amount)) + '">' +
        '<button type="button" data-sheet-action="rm-item" data-n="' + n + '" class="' + btnGhost + ' h-11 w-11 shrink-0" aria-label="Remove">✕</button></div>';
    }
    function build() {
      return '<div class="grid grid-cols-2 gap-3">' + field('Label', '<input name="label" class="' + input + '" value="' + esc(rec.label) + '" placeholder="e.g. 21/22 Nov">') +
        field('Date', '<input name="date" type="date" class="' + input + '" value="' + rec.date + '">') + '</div>' +
        '<div class="grid grid-cols-2 gap-3">' + field('Expected (£)', '<input name="amount" type="number" inputmode="decimal" class="' + input + ' tnum" value="' + esc(rec.amount) + '">') +
        field('From', '<input name="source" class="' + input + '" value="' + esc(rec.source) + '">') + '</div>' +
        '<span class="' + label + '">Goes towards (anything left over is saved)</span><div id="items">' + rec.items.map(itemRow).join('') + '</div>' +
        '<button type="button" data-sheet-action="add-item" class="' + btnGhost + ' h-10 px-3 text-sm">＋ Add item</button>' + actions(!!p);
    }
    function readItems(f) {
      return rec.items.map(function (_, n) {
        var outId = f['io' + n];
        return outId ? { outId: outId } : { label: (f['il' + n] || '').trim() || 'Item', amount: num(f['ia' + n]) };
      });
    }
    function syncRec(f) { rec.label = f.label; rec.date = f.date; rec.amount = f.amount; rec.source = f.source; rec.items = readItems(f); }
    openSheet(p ? 'Edit payday' : 'Add payday', build(), function handler(act, f, b) {
      if (act === 'add-item') { syncRec(f); rec.items.push({ label: '', amount: null }); document.getElementById('sheet-form').innerHTML = build(); return; }
      if (act === 'rm-item') { syncRec(f); rec.items.splice(Number(b.getAttribute('data-n')), 1); document.getElementById('sheet-form').innerHTML = build(); return; }
      if (act === 'delete') { if (confirmDelete()) { S.plan = S.plan.filter(function (x) { return x.id !== p.id; }); closeSheet(); commit('Payday deleted'); } return; }
      var amt = num(f.amount);
      if (amt == null || amt < 0) { toast('Enter the expected amount', 'warn'); return; }
      if (!f.date) { toast('Pick a date', 'warn'); return; }
      var o = p || { id: uid() };
      o.label = (f.label || '').trim() || fDate(f.date); o.date = f.date; o.amount = amt; o.source = (f.source || '').trim(); o.items = readItems(f);
      if (!p) S.plan.push(o);
      closeSheet(); commit('Payday saved');
    });
    // toggle custom fields when a select changes
    document.getElementById('sheet-root').onchange = function (e) {
      var m = e.target.name && e.target.name.match(/^io(\d+)$/);
      if (!m) return;
      var row = e.target.closest('[data-item]');
      row.querySelectorAll('input').forEach(function (inp) { inp.classList.toggle('hidden', !!e.target.value); });
    };
  }

  function settingsSheet() {
    var st = S.settings, theme = lsGet(LS.theme) || 'system';
    var body = '<div class="grid grid-cols-2 gap-3">' +
      field('Default day rate (£)', '<input name="defaultRate" type="number" inputmode="decimal" class="' + input + ' tnum" value="' + st.defaultRate + '">') +
      field('Count work up to', '<input name="workUntil" type="date" class="' + input + '" value="' + st.workUntil + '">') + '</div>' +
      field('Savings correction (£) — use if your real balance differs', '<input name="adjust" type="number" inputmode="decimal" step="0.01" class="' + input + ' tnum" value="' + (st.adjust || 0) + '">') +
      '<span class="' + label + '">Theme</span>' + seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], theme) +
      '<button type="submit" class="' + btnPrimary + ' h-12 w-full">Save settings</button>' +
      '<div class="border-t border-slate-200 dark:border-slate-800 my-5"></div>' +
      '<div class="text-sm font-semibold mb-2">Backup</div><div class="grid grid-cols-2 gap-2">' +
      '<button type="button" data-sheet-action="export" class="' + btnGhost + ' h-11 text-sm">Export JSON</button>' +
      '<button type="button" data-sheet-action="import" class="' + btnGhost + ' h-11 text-sm">Import JSON</button></div>' +
      '<input id="import-file" type="file" accept="application/json,.json" class="hidden">' +
      '<button type="button" data-sheet-action="lock" class="' + btnGhost + ' h-11 text-sm w-full mt-2">Lock &amp; forget this device</button>' +
      '<p class="text-xs text-slate-500 dark:text-slate-400 mt-3">Data syncs to your private database and is cached on this device. Last server version: ' + version + '.</p>';
    openSheet('Settings', body, function (act, f) {
      if (act === 'export') {
        var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'money-tracker-' + todayISO() + '.json';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        toast('Exported'); return;
      }
      if (act === 'import') {
        var fi = document.getElementById('import-file');
        fi.onchange = function () {
          var file = fi.files && fi.files[0]; if (!file) return;
          file.text().then(function (txt) {
            var data; try { data = migrate(JSON.parse(txt)); } catch (e) { data = null; }
            if (!data) { toast('That file isn’t a valid backup', 'warn'); return; }
            if (!window.confirm('Replace all current data with this backup?')) return;
            S = data; closeSheet(); commit('Backup imported');
          });
        };
        fi.click(); return;
      }
      if (act === 'lock') { if (window.confirm('Lock the app and remove data from this device? It stays safe on the server.')) { closeSheet(); lock('Locked.'); } return; }
      var n = { defaultRate: num(f.defaultRate), adjust: num(f.adjust) || 0 };
      if (n.defaultRate == null || n.defaultRate < 0) { toast('Check the numbers', 'warn'); return; }
      if (!f.workUntil) { toast('Pick the date', 'warn'); return; }
      Object.assign(S.settings, n, { workUntil: f.workUntil });
      setTheme(f.theme || 'system');
      closeSheet(); commit('Settings saved');
    });
  }

  function setTheme(t) {
    lsSet(LS.theme, t);
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }

  // ---------- Actions ----------
  function workedToday() {
    var t = todayISO();
    var x = S.days.find(function (y) { return y.date === t; });
    if (x && (x.status === 'unpaid' || x.status === 'paid')) { toast('Today is already logged ✓'); return; }
    if (x) { if (x.status === 'off') x.rate = Number(S.settings.defaultRate); x.status = 'unpaid'; }
    else S.days.push({ id: uid(), date: t, rate: Number(S.settings.defaultRate), status: 'unpaid', note: '' });
    commit('Logged ' + fDay(t) + ' · ' + money((x || {}).rate || S.settings.defaultRate) + ' unpaid');
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || !S || el.closest('#sheet-root')) return;
    var a = el.getAttribute('data-action'), id = el.getAttribute('data-id');
    if (a === 'nav') {
      e.preventDefault();
      var target = document.getElementById(el.getAttribute('data-target'));
      if (el.getAttribute('data-target') === 'dash') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (a === 'worked-today') return workedToday();
    if (a === 'day') return daySheet(id);
    if (a === 'day-set') { var dd = find('days', id); if (dd) { dd.status = el.getAttribute('data-status'); commit(fDay(dd.date) + ' → ' + dayPill[dd.status][0]); } return; }
    if (a === 'in') return inSheet(id);
    if (a === 'in-received') {
      var mi = find('moneyIn', id);
      if (mi) { mi.status = 'received'; if (mi.date > todayISO()) mi.date = todayISO(); applyInAllocs(mi); commit(money(mi.amount) + ' from ' + mi.source + ' received' + ((mi.splits || []).length ? ' · split applied' : '')); }
      return;
    }
    if (a === 'goal') return goalSheet(id);
    if (a === 'goal-up' || a === 'goal-down') return moveGoal(id, a === 'goal-up' ? -1 : 1);
    if (a === 'goal-pay') { var gp = goalById(id); if (gp) payGoal(gp); return; }
    if (a === 'goal-complete') { var gc = goalById(id); if (gc) completeGoal(gc); return; }
    if (a === 'move') return moveSheet({ from: el.getAttribute('data-from') || 'u', to: el.getAttribute('data-to') || undefined });
    if (a === 'out') return outSheet(id);
    if (a === 'out-paid') { var mo = find('moneyOut', id); if (mo) { if (mo.amount == null) return outSheet(id); mo.status = 'paid'; mo.date = mo.date > todayISO() ? todayISO() : mo.date; syncAutoAlloc(mo); commit(mo.category + ' marked paid'); } return; }
    if (a === 'got-paid') return gotPaidSheet();
    if (a === 'plan') return planSheet(id);
    if (a === 'plan-received') {
      var p = S.plan.find(function (y) { return y.id === id; });
      if (!p) return;
      var linked = p.inId && find('moneyIn', p.inId);
      if (linked) return inSheet(linked.id, { rec: { status: 'received', date: linked.date > todayISO() ? todayISO() : linked.date }, splits: (linked.splits || []).length ? splitMap(linked.splits) : planSplits(p), planId: p.id });
      return gotPaidSheet({ amount: p.amount, source: p.source || 'Job', planId: p.id, splits: planSplits(p) });
    }
    if (a === 'toggle-weeks') { var k = el.getAttribute('data-which'); ui[k] = !ui[k]; render(); return; }
    if (a === 'settings') return settingsSheet();
    if (a === 'refresh') { setSync('saving'); loadFromServer({ notify: true }); return; }
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && pin && S) loadFromServer({ notify: true, background: true }); });
  window.addEventListener('online', function () { if (pin) { if (dirty) pushSave(); else loadFromServer(); } });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { setTheme(lsGet(LS.theme) || 'system'); if (S) drawChart(); });

  // ---------- Lock screen ----------
  function renderLock(msg) {
    closeSheet();
    var entered = '';
    function draw(err, busy) {
      var dots = ''; for (var i = 0; i < 6; i++) dots += '<span class="h-3.5 w-3.5 rounded-full ' + (i < entered.length ? 'bg-slate-900 dark:bg-slate-100' : 'border-2 border-slate-300 dark:border-slate-600') + '"></span>';
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
      document.getElementById('app').innerHTML =
        '<main class="min-h-[100dvh] flex flex-col items-center justify-center px-6 -mb-20"><div class="text-4xl mb-2" aria-hidden="true">💷</div><h1 class="text-xl font-bold">China Fund</h1>' +
        '<p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Enter your 6-digit PIN</p>' +
        '<div class="flex gap-3 my-6" aria-label="' + entered.length + ' of 6 digits entered">' + dots + '</div>' +
        '<p class="h-5 text-sm ' + (err ? 'text-red-600 dark:text-red-400' : 'text-slate-500') + '" role="alert">' + esc(busy ? 'Checking…' : (err || '')) + '</p>' +
        '<div class="grid grid-cols-3 gap-3 mt-4 w-full max-w-[280px]">' + keys.map(function (k) {
          if (!k) return '<span></span>';
          return '<button data-key="' + k + '" class="' + btnGhost + ' h-16 text-2xl font-semibold" ' + (busy ? 'disabled' : '') + ' aria-label="' + (k === '⌫' ? 'Delete' : k) + '">' + k + '</button>';
        }).join('') + '</div>' +
        '<input id="pin-input" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" class="sr-only" aria-label="PIN"></main>';
    }
    draw(msg);
    function submit() {
      draw('', true);
      var tryPin = entered;
      rpc('mt_load', { p_pin: tryPin }).then(function (r) {
        if (!r.ok) { entered = ''; draw('Wrong PIN. Try again.'); return; }
        pin = tryPin; lsSet(LS.pin, pin);
        if (r.data == null) { S = seed(); version = r.version; dirty = true; }
        else { S = migrate(r.data); version = r.version; dirty = false; }
        cache(); syncState = 'saved'; detach(); render();
        if (dirty) pushSave();
      }).catch(function (e) {
        entered = ''; draw(e.locked ? 'Too many wrong PINs. Try again in 15 minutes.' : 'Can’t reach the server. Check your connection.');
      });
    }
    function press(k) {
      if (k === '⌫') entered = entered.slice(0, -1);
      else if (entered.length < 6) entered += k;
      draw();
      if (entered.length === 6) submit();
    }
    function onClick(e) { var b = e.target.closest('[data-key]'); if (b && !b.disabled) press(b.getAttribute('data-key')); }
    function onKey(e) { if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); }
    function detach() { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
  }

  // ---------- Boot ----------
  window.__mtSetToday = function (x) { __todayOverride = x; if (S) render(); };
  window.__mtState = function () { return { S: S, version: version, dirty: dirty, calc: S ? calc(S) : null }; };

  if (pin) {
    var cached = readCache();
    if (cached && cached.data) { S = migrate(cached.data); version = cached.version || 0; dirty = !!cached.dirty; syncState = 'idle'; render(); }
    loadFromServer();
  } else {
    renderLock();
  }
})();
