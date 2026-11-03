/* Money Tracker — simple, mobile-first. Vanilla JS; synced via Supabase RPCs guarded by a PIN. */
(function () {
  'use strict';

  // ================= Config =================
  var SB_URL = 'https://adnpeaytzgelqxuvpdyf.supabase.co';
  // Public anon key: it can only call mt_load / mt_save, and both require the PIN.
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkbnBlYXl0emdlbHF4dXZwZHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MzgwNDcsImV4cCI6MjEwNzQxNDA0N30.JPTOEXRoF0zXBhHT7rf_6SSnXa7t5l-UcrB5dsyc4ug';
  var TZ = 'Europe/London';
  var K = { pin: 'mt.pin', cache: 'mt.cache', theme: 'mt.theme', remember: 'mt.remember' };
  var MAX_AMOUNT = 100000;

  // ================= Helpers =================
  function rememberMe() { try { return localStorage.getItem(K.remember) !== '0'; } catch (e) { return true; } }
  function sGet(k) { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (e) { return null; } }
  function sSet(k, v) { try { (rememberMe() ? localStorage : sessionStorage).setItem(k, v); } catch (e) {} }
  function sDel(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }
  function uid() {
    var a = new Uint8Array(8);
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 8; i++) a[i] = Math.random() * 256; }
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function r2(n) { return Math.round(n * 100) / 100; }
  function num(v) {
    if (v === '' || v == null) return null;
    var n = Number(String(v).replace(/[£,\s]/g, ''));
    return isFinite(n) ? r2(n) : null;
  }
  function amountOk(n) { return n != null && n > 0 && n <= MAX_AMOUNT; }
  function clean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max || 80); }

  var __today = null;
  function today() {
    if (__today) return __today;
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function D(s) { return new Date(s + 'T00:00:00Z'); }
  function addDays(s, n) { var x = D(s); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((D(a) - D(b)) / 86400000); }
  function dow(s) { return D(s).getUTCDay(); }
  function weekStart(s) { var w = dow(s); return addDays(s, w === 0 ? -6 : 1 - w); }
  function nextSaturday(s) { return addDays(s, (6 - dow(s) + 7) % 7); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(D(s)); }
  var fDM = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  var fWDM = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  var fW = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
  function fDate(s) { return s ? fDM.format(D(s)) : ''; }
  function fDay(s) { return s ? fWDM.format(D(s)).replace(',', '') : ''; }
  function relDay(s) {
    var n = diffDays(s, today());
    if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; if (n === -1) return 'yesterday';
    if (n < 0) return (-n) + ' days ago';
    if (n < 7) return fW.format(D(s));
    return fDate(s);
  }
  function money(n) {
    if (n == null) return 'TBC';
    var neg = n < -0.004, a = Math.abs(r2(n));
    return (neg ? '−' : '') + '£' + a.toLocaleString('en-GB', { minimumFractionDigits: a % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function sum(arr, f) { return arr.reduce(function (t, x) { return t + (Number(f(x)) || 0); }, 0); }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // ================= Goals: constants =================
  var COLORS = [['blue', '#2a78d6'], ['orange', '#eb6834'], ['aqua', '#1baf7a'], ['yellow', '#eda100'], ['magenta', '#e87ba4'], ['green', '#008300'], ['violet', '#6250d6'], ['red', '#e34948']];
  function colorOf(name) { var c = COLORS.find(function (x) { return x[0] === name; }); return (c || COLORS[0])[1]; }
  var PRI = { high: 0, med: 1, low: 2 }, PRI_LABEL = { high: 'High', med: 'Medium', low: 'Low' };
  function newGoal(o) {
    return Object.assign({ id: uid(), type: 'save', target: null, deadline: null, priority: 'med', emoji: '🎯', color: 'blue', notes: '', legalRisk: false, status: 'active', order: 0, completedAt: null, autoDone: false, createdAt: today() }, o);
  }

  // ================= Starting data =================
  function seed() {
    var days = [];
    function day(date, rate, status, note) { days.push({ id: uid(), date: date, rate: rate, status: status, note: note || '' }); }
    day('2026-10-23', 100, 'paid'); day('2026-10-28', 80, 'unpaid', 'Delayed'); day('2026-10-29', 100, 'paid');
    day('2026-10-30', 100, 'unpaid'); day('2026-10-31', 100, 'paid'); day('2026-11-01', 100, 'off');
    day('2026-11-02', 100, 'unpaid'); day('2026-11-03', 100, 'unpaid'); day('2026-11-04', 100, 'off');
    ['2026-11-05', '2026-11-06', '2026-11-07'].forEach(function (x) { day(x, 100, 'scheduled'); });
    for (var x = '2026-11-09'; x <= '2026-11-28'; x = addDays(x, 1)) if (dow(x) !== 0) day(x, 100, 'scheduled');
    var goals = [
      newGoal({ name: 'PCN debt', type: 'payoff', target: 470, deadline: '2026-11-04', priority: 'high', emoji: '🚨', color: 'red', notes: 'CCJ risk. £510 total, £40 already paid.', legalRisk: true }),
      newGoal({ name: 'Zable', type: 'payoff', target: 220, deadline: '2026-11-04', priority: 'high', emoji: '💳', color: 'orange' }),
      newGoal({ name: 'Family', type: 'payoff', target: 350, deadline: '2026-11-08', priority: 'high', emoji: '👪', color: 'magenta' }),
      newGoal({ name: 'CSCS card', target: null, deadline: '2026-11-28', priority: 'med', emoji: '🦺', color: 'yellow', notes: 'Cost to be confirmed' }),
      newGoal({ name: 'China trip', target: 1175, deadline: '2026-12-02', priority: 'med', emoji: '✈️', color: 'blue', notes: 'Flight £475 + spending money £700' }),
      newGoal({ name: 'Moving out', target: null, deadline: null, priority: 'low', emoji: '🏠', color: 'green', status: 'paused' })
    ];
    goals.forEach(function (g, i) { g.order = i; });
    return {
      schema: 3,
      settings: { workUntil: '2026-11-29', defaultRate: 100, adjust: 0 },
      days: days,
      moneyIn: [
        { id: uid(), date: '2026-10-31', source: 'Job', amount: 100, status: 'received', note: '' },
        { id: uid(), date: '2026-11-02', source: 'Job', amount: 200, status: 'received', note: '' },
        { id: uid(), date: '2026-11-04', source: 'Diversity', amount: 690, status: 'expected', note: 'Final salary' }
      ],
      moneyOut: [
        { id: uid(), date: '2026-10-31', category: 'Loan fees', amount: 100, goalId: null, note: '' },
        { id: uid(), date: '2026-11-02', category: 'Spending', amount: 20, goalId: null, note: '' }
      ],
      goals: goals,
      allocations: []
    };
  }

  // Bring any older saved data up to the current shape.
  function migrate(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.days)) return null;
    d.settings = Object.assign({ workUntil: '2026-11-29', defaultRate: 100, adjust: 0 }, d.settings || {});
    delete d.settings.target; delete d.settings.tripDate;
    ['moneyIn', 'moneyOut', 'goals', 'allocations'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    var v = d.schema || 1;
    if (v < 2 && !d.goals.length) {
      var fresh = seed().goals, by = {}; fresh.forEach(function (g) { by[g.name] = g; });
      var map = [[/pcn/i, 'PCN debt'], [/zable/i, 'Zable'], [/family/i, 'Family'], [/china/i, 'China trip'], [/cscs/i, 'CSCS card']];
      d.moneyOut.forEach(function (o) { var m = map.find(function (r) { return r[0].test(o.category || ''); }); o.goalId = m ? by[m[1]].id : null; });
      d.goals = fresh;
      d.moneyOut.forEach(function (o) {
        if (o.goalId && o.status !== 'planned' && o.amount) d.allocations.push({ id: uid(), date: o.date, goalId: o.goalId, amount: o.amount, outId: o.id, kind: 'auto' });
      });
    }
    if (v < 3) {
      // Planned bills are now goals; the money-out list only holds money actually spent.
      d.moneyOut = d.moneyOut.filter(function (o) {
        if (o.status !== 'planned') return true;
        if (!o.goalId && o.amount) d.goals.push(newGoal({ name: o.category || 'Bill', type: 'payoff', target: o.amount, deadline: o.date || null, priority: o.priority ? 'high' : 'med', emoji: '🧾', order: d.goals.length }));
        return false;
      });
      d.moneyOut.forEach(function (o) { delete o.status; delete o.china; delete o.priority; delete o.dateLabel; });
      d.goals.forEach(function (g) { if (g.autoDone == null) g.autoDone = false; });
      delete d.plan;
    }
    d.schema = 3;
    return d;
  }

  // ================= Maths =================
  function sortGoals(list) { return list.slice().sort(function (a, b) { return (PRI[a.priority] - PRI[b.priority]) || (a.order - b.order); }); }
  function activeGoals(s) { return sortGoals((s || S).goals.filter(function (g) { return g.status === 'active'; })); }
  function goalById(id, s) { return (s || S).goals.find(function (g) { return g.id === id; }); }

  // Future money: expected income + wages for owed/planned days (paid the Saturday after).
  function futureEvents(s, t) {
    var b = {};
    function add(date, amt, label) {
      if (!amt) return;
      var e = b[date] || (b[date] = { amount: 0, labels: [] });
      e.amount = r2(e.amount + amt); if (e.labels.indexOf(label) < 0) e.labels.push(label);
    }
    s.moneyIn.forEach(function (x) { if (x.status === 'expected') add(x.date > t ? x.date : t, x.amount, x.source); });
    s.days.forEach(function (x) {
      var future = x.status === 'scheduled' && x.date >= t && x.date <= s.settings.workUntil;
      if (x.status === 'unpaid' || future) add(nextSaturday(x.date > t ? x.date : t), x.rate, 'Wages');
    });
    return Object.keys(b).sort().map(function (k) { return { date: k, amount: b[k].amount, label: b[k].labels.join(' + ') }; });
  }

  // The plan: at each payment, goals take money in priority order. A goal due before the
  // next payment takes everything it still needs; others take an even share per payment.
  function simulate(goals, left0, events) {
    var left = Object.assign({}, left0), onTime = {}, carry = 0, plan = [];
    goals.forEach(function (g) { onTime[g.id] = 0; });
    events.forEach(function (e, i) {
      var money = carry + e.amount, uses = [];
      goals.forEach(function (g) {
        var L = left[g.id];
        if (!(L > 0.004) || money <= 0.004 || !g.deadline) return;
        var late = g.deadline < e.date, want;
        if (late) want = L;
        else {
          var n = 0; for (var j = i; j < events.length; j++) if (events[j].date <= g.deadline) n++;
          want = n <= 1 ? L : Math.min(L, Math.ceil(L / n));
        }
        var give = r2(Math.min(money, want));
        if (give <= 0) return;
        money = r2(money - give); left[g.id] = r2(L - give);
        if (!late) onTime[g.id] = r2(onTime[g.id] + give);
        uses.push({ goalId: g.id, amount: give, late: late });
      });
      carry = money;
      plan.push({ date: e.date, label: e.label, amount: e.amount, uses: uses, spare: carry, isSpare: !!e.isSpare });
    });
    return { plan: plan, left: left, onTime: onTime, spare: carry };
  }

  function calc(s) {
    var t = today(), st = s.settings;
    var unpaidDays = s.days.filter(function (x) { return x.status === 'unpaid'; }).sort(byDate);
    var unpaid = r2(sum(unpaidDays, function (x) { return x.rate; }));
    var received = s.moneyIn.filter(function (x) { return x.status === 'received'; });
    var expected = s.moneyIn.filter(function (x) { return x.status === 'expected'; }).sort(byDate);
    var receivedIn = r2(sum(received, function (x) { return x.amount; }));
    var spentTotal = r2(sum(s.moneyOut, function (x) { return x.amount; }));
    var saved = r2(receivedIn - spentTotal + (Number(st.adjust) || 0));
    var gs = {};
    s.goals.forEach(function (g) {
      var allocated = r2(sum(s.allocations.filter(function (a) { return a.goalId === g.id; }), function (a) { return a.amount; }));
      var spent = r2(sum(s.moneyOut.filter(function (o) { return o.goalId === g.id; }), function (o) { return o.amount; }));
      var target = g.target == null ? null : Number(g.target);
      var left = target == null ? null : Math.max(0, r2(target - allocated));
      var daysLeft = g.deadline ? diffDays(g.deadline, t) : null;
      var x = gs[g.id] = {
        allocated: allocated, spent: spent, held: r2(allocated - spent), progress: allocated, target: target, left: left, daysLeft: daysLeft,
        pct: target ? Math.max(0, Math.min(100, allocated / target * 100)) : 0,
        overdue: daysLeft != null && daysLeft < 0 && (left == null || left > 0)
      };
      x.urgent = g.status === 'active' && g.type === 'payoff' && x.left !== 0 && (x.overdue || g.legalRisk);
    });
    var setAside = r2(sum(s.goals, function (g) { return Math.max(0, gs[g.id].held); }));
    var spare = r2(saved - setAside);

    var goals = activeGoals(s).filter(function (g) { return gs[g.id].left != null && gs[g.id].left > 0.004; });
    var left0 = {}; goals.forEach(function (g) { left0[g.id] = gs[g.id].left; });
    var evs = futureEvents(s, t);
    function run(sp) { return simulate(goals, left0, (sp > 0.004 ? [{ date: t, amount: sp, label: 'Spare money', isSpare: true }] : []).concat(evs)); }
    function shortTotal(r) { return sum(goals, function (g) { return Math.max(0, left0[g.id] - r.onTime[g.id]); }); }
    var sp0 = Math.max(0, spare), base = shortTotal(run(sp0));
    // Safe to spend: the most you can take from spare money without any goal falling (further) behind.
    var lo = 0, hi = sp0;
    if (shortTotal(run(0)) <= base + 0.5) lo = hi;
    else for (var k = 0; k < 24 && hi - lo > 0.5; k++) { var mid = (lo + hi) / 2; if (shortTotal(run(sp0 - mid)) <= base + 0.5) lo = mid; else hi = mid; }
    var safe = Math.max(0, Math.floor(Math.min(lo, sp0)));
    // The plan only uses the spare money that goals actually need; the rest stays free.
    var need = r2(sp0 - Math.min(lo, sp0)); if (need < 1) need = 0;
    var sim = run(need);

    var behind = [];
    activeGoals(s).forEach(function (g) {
      var x = gs[g.id];
      if (x.left == null) { x.status = 'tbc'; return; }
      if (x.left <= 0.004) { x.status = 'funded'; return; }
      if (!g.deadline) { x.status = 'open'; return; }
      x.shortfall = Math.max(0, r2(left0[g.id] - sim.onTime[g.id]));
      x.status = x.overdue ? 'overdue' : x.shortfall > 0.5 ? 'behind' : 'ontrack';
      if (x.status !== 'ontrack') behind.push(g);
      var next = sim.plan.find(function (p) { return p.uses.some(function (u) { return u.goalId === g.id; }); });
      if (next) x.next = { date: next.date, amount: next.uses.find(function (u) { return u.goalId === g.id; }).amount, isSpare: next.isSpare };
    });
    s.goals.forEach(function (g) { if (g.status !== 'active') gs[g.id].status = g.status; });

    return {
      today: t, unpaid: unpaid, unpaidDays: unpaidDays, saved: saved, setAside: setAside, spare: spare, safe: safe,
      receivedIn: receivedIn, spentTotal: spentTotal, expected: expected, goals: gs, events: evs, sim: sim, behind: behind,
      onTrack: behind.length === 0, endSpare: r2(sim.spare + sp0 - need),
      tbc: activeGoals(s).filter(function (g) { return gs[g.id].left == null; }),
      pastSched: s.days.filter(function (x) { return x.status === 'scheduled' && x.date < t; }).sort(byDate)
    };
  }

  // Days a wage payment covers: owed days, oldest first, while they fit in the amount.
  function daysCovered(s, amount) {
    var left = amount, list = [];
    s.days.filter(function (x) { return x.status === 'unpaid'; }).sort(byDate).forEach(function (x) {
      if (x.rate <= left + 0.004) { list.push(x); left = r2(left - x.rate); }
    });
    return { days: list, extra: r2(left) };
  }

  // Suggested split for a new payment, using the same plan logic as the Plan tab.
  function suggestSplit(amount, opts) {
    opts = opts || {};
    var s2 = JSON.parse(JSON.stringify(S));
    if (opts.job) daysCovered(s2, amount).days.forEach(function (x) { x.status = 'paid'; });
    if (opts.inId) { var m = s2.moneyIn.find(function (x) { return x.id === opts.inId; }); if (m) m.status = 'received'; }
    var c2 = calc(s2);
    var goals = activeGoals(s2).filter(function (g) { return c2.goals[g.id].left > 0.004; });
    var left0 = {}; goals.forEach(function (g) { left0[g.id] = c2.goals[g.id].left; });
    var r = simulate(goals, left0, [{ date: today(), amount: amount, label: 'This payment' }].concat(c2.events));
    var out = {}; r.plan[0].uses.forEach(function (u) { out[u.goalId] = u.amount; });
    return out;
  }

  // ================= State, sync & undo =================
  var S = null, version = 0, dirty = false, syncState = 'idle';
  var pin = sGet(K.pin);
  var saveTimer = null, saving = false, retryTimer = null;
  var snap = null; // state just before the current user action (for Undo)

  function cache() { if (S) sSet(K.cache, JSON.stringify({ data: S, version: version, dirty: dirty })); }
  function readCache() { try { return JSON.parse(sGet(K.cache) || 'null'); } catch (e) { return null; } }

  function rpc(name, body) {
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
    return fetch(SB_URL + '/rest/v1/rpc/' + name, {
      method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
      body: JSON.stringify(body)
    }).then(function (r) {
      clearTimeout(to);
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var err = new Error((j && (j.hint || j.message)) || ('HTTP ' + r.status)); err.locked = !!(j && j.message === 'locked'); throw err; }
        return j;
      });
    }, function (e) { clearTimeout(to); throw e; });
  }

  // Auto-complete bills once fully paid; reopen them if a payment is later removed.
  function tidy() {
    var c = calc(S), done = [];
    S.goals.forEach(function (g) {
      var x = c.goals[g.id];
      if (g.type === 'payoff' && g.status === 'active' && x.target != null && x.spent >= x.target - 0.004) {
        g.status = 'done'; g.completedAt = today(); g.autoDone = true; done.push(g.name);
      } else if (g.autoDone && g.status === 'done' && (x.target == null || x.spent < x.target - 0.004)) {
        g.status = 'active'; g.completedAt = null; g.autoDone = false;
      }
    });
    return done;
  }

  function commit(msg, opts) {
    opts = opts || {};
    var done = tidy();
    dirty = true; cache(); render();
    var before = snap; snap = null;
    if (done.length) msg = (msg ? msg + ' · ' : '') + done.join(', ') + ' paid off 🎉';
    if (msg) toast(msg, { undo: opts.noUndo ? null : before });
    clearTimeout(saveTimer); saveTimer = setTimeout(pushSave, 400);
  }
  function undo(before) {
    S = migrate(JSON.parse(before)); closeSheet();
    dirty = true; cache(); render(); toast('Undone');
    clearTimeout(saveTimer); saveTimer = setTimeout(pushSave, 300);
  }

  function setSync(x) { syncState = x; var el = document.getElementById('sync'); if (el) el.outerHTML = syncBadge(); }

  function pushSave() {
    if (!dirty || !pin || !S) return;
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
        toast('Your other device saved a change first, so this one now shows the latest. Please redo your last step.', { warn: true, ms: 7000 });
        setSync('saved');
      } else if (r.error === 'bad_pin') { lock('Please enter your PIN again.'); }
      else { setSync('error'); toast('Couldn’t save — will try again.', { warn: true }); retry(); }
    }).catch(function (e) { saving = false; setSync(e.locked ? 'error' : 'offline'); retry(); });
  }
  function retry() { clearTimeout(retryTimer); retryTimer = setTimeout(pushSave, 15000); }

  function loadFromServer(opts) {
    opts = opts || {};
    if (dirty) { pushSave(); return Promise.resolve(); }
    return rpc('mt_load', { p_pin: pin }).then(function (r) {
      if (!r.ok) { lock('Please enter your PIN again.'); return; }
      if (r.data == null) { S = seed(); version = r.version; dirty = true; cache(); render(); pushSave(); }
      else if (r.version !== version || !S) {
        if (opts.background && sheetOpen()) return;
        var old = (r.data.schema || 1) < 3;
        S = migrate(r.data); version = r.version; dirty = old; cache(); render();
        if (old) pushSave();
        if (opts.notify) toast('Updated with your latest changes');
      }
      setSync('saved');
    }).catch(function (e) {
      if (e.locked) { lock('Too many wrong PINs. Wait 15 minutes, then try again.'); return; }
      setSync('offline');
      if (!S) renderLock('Can’t reach the server. Check your connection and try again.');
    });
  }

  function lock(msg) {
    pin = null; sDel(K.pin); sDel(K.cache); S = null; version = 0; dirty = false;
    renderLock(msg);
  }

  // ================= UI kit =================
  var card = 'rounded-3xl bg-white dark:bg-slate-900 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10';
  var btn = 'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold select-none transition active:scale-[.97] disabled:opacity-40 disabled:pointer-events-none';
  var btnP = btn + ' bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400';
  var btnS = btn + ' bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
  var btnD = btn + ' bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/60 dark:text-red-300';
  var btnLink = 'text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline';
  var inp = 'w-full rounded-2xl border-0 ring-1 ring-slate-300 dark:ring-slate-700 bg-white dark:bg-slate-950 px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-slate-400';
  var lbl = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5';
  var muted = 'text-slate-500 dark:text-slate-400';

  function pill(text, tone) {
    var t = {
      good: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/20',
      warn: 'bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-400/20',
      bad: 'bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-400/20',
      alarm: 'bg-red-600 text-white ring-red-700 dark:bg-red-500 dark:text-red-950',
      plain: 'bg-slate-100 text-slate-600 ring-slate-500/10 dark:bg-slate-800 dark:text-slate-300 dark:ring-white/10'
    }[tone || 'plain'];
    return '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap ' + t + '">' + esc(text) + '</span>';
  }
  var dayInfo = { paid: ['Paid', 'good'], unpaid: ['Owed', 'warn'], off: ['Off', 'plain'], scheduled: ['Planned', 'plain'] };
  function syncBadge() {
    var m = { idle: ['', 'bg-slate-300'], saving: ['Saving…', 'bg-amber-500 animate-pulse'], saved: ['Saved', 'bg-emerald-500'], offline: ['Offline · saved on this phone', 'bg-slate-400'], error: ['Not saved yet', 'bg-red-500'] }[syncState] || ['', 'bg-slate-300'];
    return '<span id="sync" class="inline-flex items-center gap-1.5" aria-live="polite"><span class="h-1.5 w-1.5 rounded-full ' + m[1] + '"></span>' + m[0] + '</span>';
  }
  function bar(pct, color, label) {
    return '<div class="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><div class="h-full rounded-full" style="width:' + pct.toFixed(1) + '%;background:' + color + '"></div></div>';
  }
  function emptyState(icon, text, action) {
    return '<div class="' + card + ' p-8 text-center"><div class="text-3xl mb-2" aria-hidden="true">' + icon + '</div><p class="' + muted + ' text-sm">' + text + '</p>' + (action || '') + '</div>';
  }
  function statusPill(x) {
    switch (x.status) {
      case 'ontrack': return pill('On track', 'good');
      case 'funded': return pill('Fully funded', 'good');
      case 'behind': return pill('Behind ' + money(x.shortfall), 'bad');
      case 'overdue': return pill('Overdue', 'bad');
      case 'tbc': return pill('Set a target', 'plain');
      case 'open': return pill('No deadline', 'plain');
      default: return '';
    }
  }
  function urgentPill(g, x) { return x.urgent ? pill('HIGH PRIORITY' + (g.legalRisk ? ' · CCJ risk' : x.overdue ? ' · overdue' : ''), 'alarm') : ''; }

  // ================= Navigation =================
  var TABS = [['home', 'Home', '🏠'], ['work', 'Work', '🗓️'], ['goals', 'Goals', '🎯'], ['money', 'Money', '💷'], ['plan', 'Plan', '📈']];
  var ui = { tab: 'home', reorder: false, showEarly: false, showLate: false, showArchived: false, filter: 'all', moreNext: false };
  function tabFromHash() { var h = (location.hash || '').slice(1); return TABS.some(function (t) { return t[0] === h; }) ? h : 'home'; }
  window.addEventListener('hashchange', function () { ui.tab = tabFromHash(); if (S) { render(); window.scrollTo(0, 0); } });
  ui.tab = tabFromHash();

  // ================= Render =================
  var chart = null;
  function render() {
    if (!S) return;
    var c = calc(S);
    var title = { home: 'Your money', work: 'Work', goals: 'Goals', money: 'Money in & out', plan: 'The plan' }[ui.tab];
    var h = '<header class="sticky top-0 z-30 bg-slate-50/85 dark:bg-[#0b0f14]/85 backdrop-blur-md"><div class="max-w-lg mx-auto px-5 pt-4 pb-3 flex items-center justify-between gap-3">' +
      '<div class="min-w-0"><h1 class="text-2xl font-bold tracking-tight">' + title + '</h1><div class="flex items-center gap-2 text-xs ' + muted + '"><span>' + fDay(c.today) + '</span><span aria-hidden="true">·</span>' + syncBadge() + '</div></div>' +
      '<button data-action="settings" class="' + btnS + ' h-11 w-11 rounded-full shrink-0" aria-label="Settings and security">⚙️</button></div></header>';
    h += '<main class="max-w-lg mx-auto px-5 pt-1 pb-8">' + ({ home: viewHome, work: viewWork, goals: viewGoals, money: viewMoney, plan: viewPlan })[ui.tab](c) + '</main>';
    h += '<nav class="fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800" style="padding-bottom:env(safe-area-inset-bottom)" aria-label="Sections"><div class="max-w-lg mx-auto grid grid-cols-5">' +
      TABS.map(function (tb) {
        var on = ui.tab === tb[0];
        return '<a href="#' + tb[0] + '" class="flex flex-col items-center justify-center gap-1 h-16 text-[11px] font-semibold ' + (on ? 'text-emerald-700 dark:text-emerald-400' : muted) + '"' + (on ? ' aria-current="page"' : '') + '>' +
          '<span class="text-xl leading-none ' + (on ? '' : 'grayscale opacity-60') + '" aria-hidden="true">' + tb[2] + '</span>' + tb[1] + '</a>';
      }).join('') + '</div></nav>';
    var y = window.scrollY;
    document.getElementById('app').innerHTML = h;
    window.scrollTo(0, y);
    if (ui.tab === 'plan') drawChart(c);
  }

  // ---------- Home ----------
  function nextUp(c) {
    var items = [], t = c.today;
    activeGoals().forEach(function (g) {
      var x = c.goals[g.id];
      if (g.type !== 'payoff' || !x.left || x.daysLeft == null || x.daysLeft > 3) return;
      var when = x.daysLeft < 0 ? 'was due ' + fDate(g.deadline) : 'due ' + relDay(g.deadline);
      items.push({ tone: x.urgent ? 'bad' : 'warn', icon: g.emoji, html: '<b>Pay ' + esc(g.name) + ' ' + money(x.left) + '</b><br><span class="' + muted + '">' + when + (g.legalRisk ? ' · CCJ risk' : '') + '</span>', btn: ['Pay', 'goal-pay', g.id] });
    });
    c.expected.filter(function (x) { return x.date <= t; }).forEach(function (x) {
      items.push({ icon: '💷', html: '<b>Has ' + money(x.amount) + ' from ' + esc(x.source) + ' arrived?</b><br><span class="' + muted + '">Expected ' + relDay(x.date) + '</span>', btn: ['Yes', 'got-paid-expected', x.id] });
    });
    if (c.pastSched.length) {
      var x = c.pastSched[0];
      items.push({ icon: '🗓️', html: '<b>Did you work on ' + fDay(x.date) + '?</b>' + (c.pastSched.length > 1 ? '<br><span class="' + muted + '">' + plural(c.pastSched.length - 1, 'more day') + ' to check</span>' : ''), btn: ['Yes', 'day-set', x.id, 'unpaid'], btn2: ['No', 'day-set', x.id, 'off'] });
    }
    activeGoals().forEach(function (g) {
      var x = c.goals[g.id];
      if (g.type === 'save' && x.status === 'funded') items.push({ tone: 'good', icon: '🎉', html: '<b>' + esc(g.name) + ' is fully funded</b><br><span class="' + muted + '">' + money(x.progress) + ' set aside</span>', btn: ['Mark done', 'goal-complete', g.id] });
    });
    if (c.spare < -0.004) items.push({ tone: 'bad', icon: '⚠️', html: '<b>You’ve set aside ' + money(-c.spare) + ' more than you have</b><br><span class="' + muted + '">Take some money back out of a goal</span>', btn: ['Fix', 'goto', 'goals'] });
    return items;
  }

  function viewHome(c) {
    var t = c.today, todayRec = S.days.find(function (x) { return x.date === t; });
    var logged = todayRec && (todayRec.status === 'unpaid' || todayRec.status === 'paid');
    var h = '<section class="' + card + ' p-5" aria-label="Summary">' +
      '<div class="text-sm font-medium ' + muted + '">Total saved</div>' +
      '<div class="text-[40px] leading-tight font-bold tracking-tight tnum" data-testid="saved">' + money(c.saved) + '</div>' +
      '<div class="mt-4 grid grid-cols-3 gap-2 text-center">' +
      miniStat('In goals', money(c.setAside), 'setaside') + miniStat('Spare', money(c.spare), 'spare', c.spare < -0.004 ? 'text-red-600 dark:text-red-400' : '') + miniStat('Owed to you', money(c.unpaid), 'unpaid') + '</div>' +
      '<a href="#plan" class="mt-4 rounded-2xl px-4 py-3 flex items-center gap-3 ' + (c.onTrack ? 'bg-emerald-50 dark:bg-emerald-950/50' : 'bg-red-50 dark:bg-red-950/50') + '" data-testid="overall">' +
      '<span class="text-xl" aria-hidden="true">' + (c.onTrack ? '✅' : '⚠️') + '</span><span class="text-sm flex-1">' +
      (c.onTrack ? '<b class="text-emerald-900 dark:text-emerald-200">On track for every goal</b>' : '<b class="text-red-900 dark:text-red-200">Behind on ' + c.behind.map(function (g) { return esc(g.name); }).join(', ') + '</b>') +
      '<span class="block ' + (c.onTrack ? 'text-emerald-900/80 dark:text-emerald-200/80' : 'text-red-900/80 dark:text-red-200/80') + '">Safe to spend now: <b data-testid="safe">' + money(c.safe) + '</b></span></span><span aria-hidden="true" class="' + muted + '">›</span></a></section>';

    h += '<section class="mt-4 grid grid-cols-2 gap-3" aria-label="Quick actions">' +
      (logged
        ? '<button data-action="day" data-id="' + todayRec.id + '" class="' + btnS + ' col-span-2 h-16 text-base">✓ Today logged · ' + money(todayRec.rate) + '</button>'
        : '<button data-action="worked-today" class="' + btnP + ' col-span-2 h-16 text-lg shadow-sm">＋ I worked today</button>') +
      '<button data-action="got-paid" class="' + btnS + ' h-14">💷 I got paid</button>' +
      '<button data-action="spent" class="' + btnS + ' h-14">🛒 I spent money</button></section>';

    var items = nextUp(c);
    h += '<section class="mt-7" aria-labelledby="nextup"><h2 id="nextup" class="text-lg font-bold mb-2">Next up</h2>';
    if (!items.length) h += '<div class="' + card + ' p-4 flex items-center gap-3"><span class="text-2xl" aria-hidden="true">😌</span><p class="text-sm">You’re all caught up.</p></div>';
    else {
      var shown = ui.moreNext ? items : items.slice(0, 3);
      h += '<div class="space-y-2" data-testid="nextup">' + shown.map(function (it) {
        var ring = it.tone === 'bad' ? ' ring-2 ring-red-500/60' : it.tone === 'good' ? ' ring-2 ring-emerald-500/50' : '';
        function b(x, cls) { return '<button data-action="' + x[1] + '" data-id="' + x[2] + '"' + (x[3] ? ' data-v="' + x[3] + '"' : '') + ' class="' + cls + ' h-11 px-4 text-sm shrink-0">' + x[0] + '</button>'; }
        return '<div class="' + card + ring + ' p-4 flex items-center gap-3"><span class="text-2xl shrink-0" aria-hidden="true">' + esc(it.icon) + '</span><div class="flex-1 min-w-0 text-sm leading-snug">' + it.html + '</div>' +
          (it.btn2 ? b(it.btn2, btnS) : '') + b(it.btn, btnP) + '</div>';
      }).join('') + '</div>';
      if (items.length > 3) h += '<button data-action="toggle" data-k="moreNext" class="' + btnLink + ' mt-2">' + (ui.moreNext ? 'Show less' : 'Show ' + (items.length - 3) + ' more') + '</button>';
    }
    h += '</section>';

    var act = activeGoals();
    h += '<section class="mt-7" aria-labelledby="hgoals"><div class="flex items-center justify-between mb-2"><h2 id="hgoals" class="text-lg font-bold">Goals</h2><a href="#goals" class="' + btnLink + '">See all ›</a></div>';
    if (!act.length) h += emptyState('🎯', 'No goals yet.', '<button data-action="goal" class="' + btnP + ' h-11 px-5 mt-4 text-sm">Add a goal</button>');
    else h += '<div class="' + card + ' divide-y divide-slate-100 dark:divide-slate-800" data-testid="home-goals">' + act.map(function (g) { return goalRow(g, c); }).join('') + '</div>';
    return h + '</section>';
  }
  function miniStat(label, value, id, cls) {
    return '<div class="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-2 py-2.5"><div class="text-[11px] font-medium ' + muted + '">' + label + '</div><div class="font-bold tnum ' + (cls || '') + '" data-testid="' + id + '">' + value + '</div></div>';
  }
  function goalRow(g, c) {
    var x = c.goals[g.id];
    return '<button data-action="goal" data-id="' + g.id + '" class="w-full text-left p-4 flex items-center gap-3 active:bg-slate-50 dark:active:bg-slate-800/60 first:rounded-t-3xl last:rounded-b-3xl">' +
      '<span class="text-2xl" aria-hidden="true">' + esc(g.emoji) + '</span><span class="flex-1 min-w-0">' +
      '<span class="flex items-center justify-between gap-2"><span class="font-semibold truncate">' + esc(g.name) + '</span><span class="text-sm tnum ' + muted + ' whitespace-nowrap">' + money(x.progress) + ' / ' + money(x.target) + '</span></span>' +
      '<span class="block mt-1.5">' + bar(x.pct, colorOf(g.color), g.name) + '</span>' +
      '<span class="mt-1.5 flex items-center gap-1.5 flex-wrap">' + urgentPill(g, x) + statusPill(x) +
      (g.deadline ? '<span class="text-xs ' + muted + '">' + (g.type === 'payoff' ? 'due ' : 'by ') + fDate(g.deadline) + '</span>' : '') + '</span></span></button>';
  }

  // ---------- Work ----------
  function viewWork(c) {
    var t = c.today, ws = weekStart(t);
    var wk = S.days.filter(function (x) { return weekStart(x.date) === ws && (x.status === 'paid' || x.status === 'unpaid'); });
    var h = '<section class="' + card + ' p-4 grid grid-cols-3 gap-2 text-center">' +
      miniStat('Worked this week', plural(wk.length, 'day'), 'wk-days') + miniStat('Earned this week', money(sum(wk, function (x) { return x.rate; })), 'wk-earned') + miniStat('Owed to you', money(c.unpaid), 'wk-owed') + '</section>';
    h += '<div class="mt-4 flex gap-3"><button data-action="day" class="' + btnS + ' h-12 flex-1 text-sm">＋ Add a day</button>' +
      (c.unpaid ? '<button data-action="got-paid" class="' + btnP + ' h-12 flex-1 text-sm">💷 I got paid</button>' : '') + '</div>';
    var weeks = {};
    S.days.slice().sort(byDate).forEach(function (x) { var w = weekStart(x.date); (weeks[w] = weeks[w] || []).push(x); });
    var keys = Object.keys(weeks).sort();
    var early = keys.filter(function (w) { return w < addDays(ws, -7) && !weeks[w].some(function (x) { return x.status === 'unpaid' || x.status === 'scheduled'; }); });
    var late = keys.filter(function (w) { return w > addDays(ws, 7); });
    h += '<div class="mt-4 space-y-3">';
    if (early.length) h += '<button data-action="toggle" data-k="showEarly" class="' + btnLink + '">' + (ui.showEarly ? 'Hide' : 'Show') + ' ' + plural(early.length, 'earlier week') + ' (all paid)</button>';
    keys.forEach(function (w) {
      if ((early.indexOf(w) >= 0 && !ui.showEarly) || (late.indexOf(w) >= 0 && !ui.showLate)) return;
      var list = weeks[w], worked = list.filter(function (x) { return x.status !== 'off'; });
      h += '<div class="' + card + ' overflow-hidden"><div class="px-4 py-2.5 flex justify-between text-xs font-semibold ' + muted + ' bg-slate-50 dark:bg-slate-800/40">' +
        '<span>' + (w === ws ? 'This week' : w > ws ? 'Week of ' + fDate(w) : 'Week of ' + fDate(w)) + '</span><span class="tnum">' + plural(worked.length, 'day') + ' · ' + money(sum(worked, function (x) { return x.rate; })) + '</span></div>' +
        '<ul class="divide-y divide-slate-100 dark:divide-slate-800">' + list.map(function (x) {
          var info = dayInfo[x.status] || dayInfo.scheduled, isT = x.date === t;
          return '<li><button data-action="day" data-id="' + x.id + '" class="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-slate-50 dark:active:bg-slate-800/60' + (isT ? ' bg-emerald-50/70 dark:bg-emerald-950/30' : '') + '">' +
            '<span class="flex-1"><span class="font-medium ' + (x.status === 'off' ? muted : '') + '">' + fDay(x.date) + '</span>' + (isT ? ' <span class="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">TODAY</span>' : '') +
            (x.note ? '<span class="block text-xs ' + muted + '">' + esc(x.note) + '</span>' : '') + '</span>' +
            '<span class="tnum text-sm ' + (x.status === 'off' ? muted + ' line-through' : 'font-semibold') + '">' + money(x.rate) + '</span>' + pill(info[0], info[1]) + '</button></li>';
        }).join('') + '</ul></div>';
    });
    if (late.length) h += '<button data-action="toggle" data-k="showLate" class="' + btnLink + '">' + (ui.showLate ? 'Hide' : 'Show') + ' ' + plural(late.length, 'later week') + '</button>';
    return h + '</div><p class="text-xs ' + muted + ' mt-4">Tap a day to change it. When you’re paid, “I got paid” marks the oldest owed days as paid for you.</p>';
  }

  // ---------- Goals ----------
  function viewGoals(c) {
    var act = activeGoals();
    var h = '<div class="flex gap-3"><button data-action="goal" class="' + btnP + ' h-12 flex-1 text-sm">＋ New goal</button>' +
      '<button data-action="move" class="' + btnS + ' h-12 flex-1 text-sm">⇄ Move money</button>' +
      (act.length > 1 ? '<button data-action="toggle" data-k="reorder" class="' + btnS + ' h-12 px-4 text-sm' + (ui.reorder ? ' ring-2 ring-emerald-500' : '') + '" aria-pressed="' + ui.reorder + '">' + (ui.reorder ? 'Done' : 'Reorder') + '</button>' : '') + '</div>';
    if (ui.reorder) h += '<p class="text-xs ' + muted + ' mt-2">Use ▲ ▼ to set priority. Moving past a goal with a different priority takes on its priority.</p>';
    h += '<div class="mt-4 space-y-3" data-testid="goal-list">';
    if (!act.length) h += emptyState('🎯', 'No active goals.');
    act.forEach(function (g, i) { h += goalCard(g, c, i, act.length); });
    h += '</div>';
    function group(title, list, sub, id) {
      if (!list.length) return '';
      return '<h2 class="text-sm font-bold uppercase tracking-wide ' + muted + ' mt-7 mb-2">' + title + '</h2><div class="' + card + ' divide-y divide-slate-100 dark:divide-slate-800"' + (id ? ' data-testid="' + id + '"' : '') + '>' +
        list.map(function (g) {
          var x = c.goals[g.id];
          return '<button data-action="goal" data-id="' + g.id + '" class="w-full p-4 flex items-center gap-3 text-left"><span class="text-xl" aria-hidden="true">' + esc(g.emoji) + '</span><span class="flex-1 min-w-0"><span class="font-semibold">' + esc(g.name) + '</span><span class="block text-xs ' + muted + '">' + sub(g) + '</span></span><span class="text-sm tnum ' + muted + '">' + money(x.progress) + (x.target != null ? ' / ' + money(x.target) : '') + '</span></button>';
        }).join('') + '</div>';
    }
    h += group('Paused', sortGoals(S.goals.filter(function (g) { return g.status === 'paused'; })), function () { return 'Paused · not in the plan'; });
    h += group('Done', S.goals.filter(function (g) { return g.status === 'done'; }).sort(function (a, b) { return (b.completedAt || '').localeCompare(a.completedAt || ''); }), function (g) { return '✓ Completed ' + fDate(g.completedAt); }, 'done-list');
    var arch = S.goals.filter(function (g) { return g.status === 'archived'; });
    if (arch.length) {
      h += '<button data-action="toggle" data-k="showArchived" class="' + btnLink + ' mt-6 block">' + (ui.showArchived ? 'Hide' : 'Show') + ' ' + plural(arch.length, 'archived goal') + '</button>';
      if (ui.showArchived) h += group('Archived', arch, function () { return 'Archived'; });
    }
    return h;
  }
  function goalCard(g, c, i, n) {
    var x = c.goals[g.id], pay = g.type === 'payoff';
    var meta = [];
    if (x.left != null) meta.push('<b class="text-slate-900 dark:text-slate-100">' + money(x.left) + '</b> ' + (pay ? 'left to pay' : 'to go'));
    if (g.deadline) meta.push(x.daysLeft < 0 ? 'was due ' + fDate(g.deadline) : (x.daysLeft === 0 ? 'due today' : plural(x.daysLeft, 'day') + ' left'));
    var plan = x.next && x.status !== 'funded' ? 'Plan: ' + money(x.next.amount) + (x.next.isSpare ? ' from your spare money now' : ' from ' + fDay(x.next.date) + ' money') : '';
    return '<article class="' + card + ' p-4" data-goal="' + g.id + '" aria-label="' + esc(g.name) + '">' +
      '<div class="flex items-start gap-3"><span class="text-3xl leading-none mt-0.5" aria-hidden="true">' + esc(g.emoji) + '</span>' +
      '<button data-action="goal" data-id="' + g.id + '" class="flex-1 min-w-0 text-left"><div class="font-bold text-lg leading-tight">' + esc(g.name) + '</div>' +
      '<div class="mt-1 flex flex-wrap gap-1.5">' + urgentPill(g, x) + statusPill(x) + pill(PRI_LABEL[g.priority] + ' priority', 'plain') + (pay ? pill('Bill', 'plain') : '') + '</div></button>' +
      (ui.reorder ? '<div class="flex flex-col gap-1"><button data-action="goal-up" data-id="' + g.id + '" class="' + btnS + ' h-9 w-9 text-xs" aria-label="Move ' + esc(g.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>▲</button><button data-action="goal-down" data-id="' + g.id + '" class="' + btnS + ' h-9 w-9 text-xs" aria-label="Move ' + esc(g.name) + ' down"' + (i === n - 1 ? ' disabled' : '') + '>▼</button></div>' : '') + '</div>' +
      '<div class="mt-3 flex items-baseline gap-1.5 tnum"><span class="text-2xl font-bold" data-testid="g-progress">' + money(x.progress) + '</span><span class="text-sm ' + muted + '">' + (x.target == null ? (pay ? 'paid' : 'saved') + ' · no target yet' : 'of ' + money(x.target) + (pay ? ' paid' : ' saved')) + '</span></div>' +
      '<div class="mt-2">' + bar(x.pct, colorOf(g.color), g.name) + '</div>' +
      (meta.length ? '<div class="mt-2 text-sm ' + muted + '">' + meta.join(' · ') + '</div>' : '') +
      (plan ? '<div class="mt-1 text-xs ' + muted + '">' + plan + '</div>' : '') +
      (x.held > 0.004 && pay ? '<div class="mt-1 text-xs ' + muted + '">' + money(x.held) + ' set aside, not paid yet</div>' : '') +
      '<div class="mt-3 flex gap-2">' +
      (pay ? '<button data-action="goal-pay" data-id="' + g.id + '" class="' + btnP + ' h-11 flex-1 text-sm">Pay</button>'
        : x.left === 0 ? '<button data-action="goal-complete" data-id="' + g.id + '" class="' + btnP + ' h-11 flex-1 text-sm">✓ Mark done</button>'
          : '<button data-action="move" data-to="' + g.id + '" class="' + btnP + ' h-11 flex-1 text-sm">＋ Add money</button>') +
      '<button data-action="goal" data-id="' + g.id + '" class="' + btnS + ' h-11 px-5 text-sm">Open</button></div></article>';
  }

  // ---------- Money ----------
  function viewMoney(c) {
    var h = '<div class="grid grid-cols-2 gap-3"><button data-action="got-paid" class="' + btnP + ' h-12 text-sm">💷 I got paid</button><button data-action="spent" class="' + btnS + ' h-12 text-sm">🛒 I spent money</button></div>';
    if (c.expected.length) {
      h += '<h2 class="text-lg font-bold mt-7 mb-2">Coming in</h2><div class="' + card + ' divide-y divide-slate-100 dark:divide-slate-800">' + c.expected.map(function (x) {
        return '<div class="p-4 flex items-center gap-3"><span class="text-xl" aria-hidden="true">⏳</span><button data-action="in" data-id="' + x.id + '" class="flex-1 text-left min-w-0"><div class="font-semibold truncate">' + esc(x.source) + ' · <span class="tnum">' + money(x.amount) + '</span></div><div class="text-xs ' + muted + '">Expected ' + relDay(x.date) + (x.note ? ' · ' + esc(x.note) : '') + '</div></button><button data-action="got-paid-expected" data-id="' + x.id + '" class="' + btnS + ' h-10 px-4 text-sm">It arrived</button></div>';
      }).join('') + '</div>';
    }
    h += '<div class="flex items-center justify-between mt-7 mb-2"><h2 class="text-lg font-bold">History</h2><div class="flex gap-1 rounded-full bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold" role="group" aria-label="Filter history">' +
      [['all', 'All'], ['in', 'In'], ['out', 'Out']].map(function (f) { return '<button data-action="filter" data-v="' + f[0] + '" class="px-3 py-1.5 rounded-full ' + (ui.filter === f[0] ? 'bg-white dark:bg-slate-950 shadow-sm' : muted) + '" aria-pressed="' + (ui.filter === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div></div>';
    var rows = [];
    if (ui.filter !== 'out') S.moneyIn.filter(function (x) { return x.status === 'received'; }).forEach(function (x) { rows.push({ kind: 'in', x: x, date: x.date }); });
    if (ui.filter !== 'in') S.moneyOut.forEach(function (x) { rows.push({ kind: 'out', x: x, date: x.date }); });
    if (!rows.length) return h + emptyState('🧾', 'Nothing here yet.');
    var byDay = {}; rows.forEach(function (r) { (byDay[r.date] = byDay[r.date] || []).push(r); });
    h += '<div class="space-y-4" data-testid="history">' + Object.keys(byDay).sort().reverse().map(function (dt) {
      return '<div><div class="text-xs font-semibold ' + muted + ' mb-1.5 px-1">' + fDay(dt) + '</div><div class="' + card + ' divide-y divide-slate-100 dark:divide-slate-800">' + byDay[dt].map(function (r) {
        var x = r.x, g = r.kind === 'out' && x.goalId ? goalById(x.goalId) : null;
        var splits = r.kind === 'in' ? S.allocations.filter(function (a) { return a.inId === x.id; }) : [];
        var sub = r.kind === 'in' ? (splits.length ? 'Split: ' + splits.map(function (a) { var gg = goalById(a.goalId); return (gg ? gg.name : 'goal') + ' ' + money(a.amount); }).join(', ') : (x.note || 'Kept as spare money')) : (g ? 'For ' + g.emoji + ' ' + g.name : (x.note || ''));
        return '<button data-action="' + r.kind + '" data-id="' + x.id + '" class="w-full p-4 flex items-center gap-3 text-left"><span class="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ' + (r.kind === 'in' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300') + '" aria-hidden="true">' + (r.kind === 'in' ? '↓' : '↑') + '</span>' +
          '<span class="flex-1 min-w-0"><span class="block font-medium truncate">' + esc(r.kind === 'in' ? x.source : x.category) + '</span>' + (sub ? '<span class="block text-xs truncate ' + muted + '">' + esc(sub) + '</span>' : '') + '</span>' +
          '<span class="tnum font-semibold whitespace-nowrap ' + (r.kind === 'in' ? 'text-emerald-700 dark:text-emerald-400' : '') + '">' + (r.kind === 'in' ? '+' : '−') + money(x.amount) + '</span></button>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
    return h + '<p class="text-xs ' + muted + ' mt-4 text-center tnum">In ' + money(c.receivedIn) + ' · Out ' + money(c.spentTotal) + ' · Saved ' + money(c.saved) + '</p>';
  }

  // ---------- Plan ----------
  function viewPlan(c) {
    var h = '<section class="' + card + ' p-5"><div class="flex items-center gap-3"><span class="text-2xl" aria-hidden="true">' + (c.onTrack ? '✅' : '⚠️') + '</span><div>' +
      '<div class="font-bold">' + (c.onTrack ? 'Every goal is covered in time' : 'Not enough in time for ' + c.behind.map(function (g) { return esc(g.name); }).join(', ')) + '</div>' +
      '<div class="text-sm ' + muted + '">Spare money left after all goals: <b class="tnum" data-testid="end-spare">' + money(c.endSpare) + '</b></div></div></div>' +
      (c.tbc.length ? '<p class="text-xs ' + muted + ' mt-3">Not in the plan until you set a target: ' + c.tbc.map(function (g) { return esc(g.name); }).join(', ') + '.</p>' : '') + '</section>';
    h += '<h2 class="text-lg font-bold mt-7 mb-1">Where each payment goes</h2><p class="text-xs ' + muted + ' mb-3">Worked out for you from owed days, planned shifts and deadlines. Goals due soonest and with the highest priority come first.</p>';
    var steps = c.sim.plan.filter(function (p) { return p.amount > 0; });
    if (!steps.length) h += emptyState('📭', 'No money expected yet. Add planned work days or expected money.');
    h += '<ol class="space-y-3" data-testid="plan">' + steps.map(function (p) {
      return '<li class="' + card + ' p-4"><div class="flex items-baseline justify-between gap-2"><div class="font-bold">' + (p.isSpare ? 'Now · your spare money' : fDay(p.date) + ' · ' + esc(p.label)) + '</div><div class="tnum font-bold">' + money(p.amount) + '</div></div>' +
        '<ul class="mt-2 space-y-1 text-sm">' + (p.uses.length ? p.uses.map(function (u) {
          var g = goalById(u.goalId);
          return '<li class="flex justify-between gap-2"><span>' + esc(g.emoji) + ' ' + esc(g.name) + (u.late ? ' ' + pill('late', 'bad') : '') + '</span><span class="tnum">' + money(u.amount) + '</span></li>';
        }).join('') : '<li class="' + muted + '">Nothing needed from this one</li>') +
        '<li class="flex justify-between gap-2 ' + muted + ' pt-1"><span>Spare after this</span><span class="tnum">' + money(p.spare) + '</span></li></ul></li>';
    }).join('') + '</ol>';
    h += '<h2 class="text-lg font-bold mt-7 mb-2">Money over time</h2><div class="' + card + ' p-4"><div class="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2" aria-hidden="true">' +
      legend('var(--series-in)', 'Money in') + legend('var(--series-out)', 'Money out') + legend('var(--series-saved)', 'Saved') + '</div>' +
      '<div class="relative h-60"><canvas id="mchart" role="img" aria-label="Money in, money out and savings over time, with the plan ahead"></canvas></div>' +
      '<p class="text-xs ' + muted + ' mt-2">Solid = so far. Dashed = the plan.</p></div>';
    return h;
  }
  function legend(col, t) { return '<span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0.5 rounded" style="background:' + col + '"></span>' + t + '</span>'; }

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function drawChart(c) {
    var el = document.getElementById('mchart');
    if (!el || !window.Chart) return;
    if (chart) { chart.destroy(); chart = null; }
    var t = c.today;
    var dates = [].concat(S.days, S.moneyIn, S.moneyOut).map(function (x) { return x.date; }).filter(Boolean).sort();
    var start = dates[0] && dates[0] < t ? dates[0] : addDays(t, -7), end = addDays(t, 21);
    S.goals.forEach(function (g) { if (g.status === 'active' && g.deadline && g.deadline > end) end = g.deadline; });
    if (diffDays(end, start) > 400) start = addDays(end, -400);
    var inA = {}, outA = {}, inP = {}, outP = {};
    function add(m, k, v) { if (v) m[k] = (m[k] || 0) + v; }
    S.moneyIn.forEach(function (x) { if (x.status === 'received') add(inA, x.date, x.amount); });
    S.moneyOut.forEach(function (x) { add(outA, x.date, x.amount); });
    c.sim.plan.forEach(function (p) {
      var dt = p.date > t ? p.date : addDays(t, 1);
      if (!p.isSpare) add(inP, dt, p.amount);
      p.uses.forEach(function (u) { var g = goalById(u.goalId); if (g && g.type === 'payoff') add(outP, dt, u.amount); });
    });
    var labels = [], ds = [], iS = [], oS = [], sS = [], ci = 0, co = 0, ti = 0, adj = Number(S.settings.adjust) || 0;
    for (var x = start; x <= end; x = addDays(x, 1)) {
      if (x < start) continue;
      ci += inA[x] || 0; co += outA[x] || 0;
      if (x > t) { ci += inP[x] || 0; co += outP[x] || 0; }
      if (x === t) ti = labels.length;
      labels.push(fDate(x)); ds.push(x); iS.push(r2(ci)); oS.push(r2(co)); sS.push(r2(ci - co + adj));
    }
    var grid = cssVar('--chart-grid'), text = cssVar('--chart-text');
    function set(l, d, col) { return { label: l, data: d, borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12, segment: { borderDash: function (ctx) { return ctx.p0DataIndex >= ti ? [5, 4] : undefined; } } }; }
    chart = new Chart(el, {
      type: 'line',
      data: { labels: labels, datasets: [set('Money in', iS, cssVar('--series-in')), set('Money out', oS, cssVar('--series-out')), set('Saved', sS, cssVar('--series-saved'))] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (it) { var i = it[0].dataIndex; return fDay(ds[i]) + (i > ti ? ' (plan)' : ''); }, label: function (it) { return ' ' + it.dataset.label + ': ' + money(it.parsed.y); } } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: text, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, font: { size: 11 } } },
          y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, maxTicksLimit: 5, font: { size: 11 }, callback: function (v) { return '£' + Number(v).toLocaleString('en-GB'); } } }
        }
      },
      plugins: [{ id: 'today', afterDatasetsDraw: function (ch) {
        var px = ch.scales.x.getPixelForValue(ti), a = ch.chartArea, ctx = ch.ctx;
        ctx.save(); ctx.strokeStyle = text; ctx.globalAlpha = .45; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.globalAlpha = .9; ctx.setLineDash([]); ctx.fillStyle = text; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Today', px, a.top + 10); ctx.restore();
      } }]
    });
  }

  // ================= Sheets =================
  function sheetOpen() { return !!document.getElementById('sheet-form'); }
  function openSheet(title, body, onAction, opts) {
    opts = opts || {};
    var root = document.getElementById('sheet-root');
    root.innerHTML = '<div class="fixed inset-0 z-40 bg-slate-950/50" data-close></div>' +
      '<div role="dialog" aria-modal="true" aria-labelledby="sheet-title" class="sheet-enter fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-[28px] bg-white dark:bg-slate-900 shadow-2xl" style="padding-bottom:calc(1.25rem + env(safe-area-inset-bottom))">' +
      '<div class="max-w-lg mx-auto px-5 pt-3"><div class="mx-auto h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>' +
      '<div class="flex items-center justify-between gap-3 mt-3 mb-4"><h2 id="sheet-title" class="text-xl font-bold truncate">' + esc(title) + '</h2><button type="button" data-close class="' + btnS + ' h-10 w-10 rounded-full shrink-0" aria-label="Close">✕</button></div>' +
      '<form id="sheet-form" novalidate autocomplete="off">' + body + '</form></div></div>';
    document.body.style.overflow = 'hidden';
    root.onclick = function (e) {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      var b = e.target.closest('[data-sa]');
      if (b) { e.preventDefault(); onAction(b.getAttribute('data-sa'), formData(), b); }
    };
    document.getElementById('sheet-form').onsubmit = function (e) { e.preventDefault(); onAction('save', formData()); };
    var first = root.querySelector('[autofocus]');
    if (first && !opts.noFocus) setTimeout(function () { try { first.focus(); } catch (e) {} }, 60);
  }
  function closeSheet() { var r = document.getElementById('sheet-root'); if (!r) return; r.onchange = null; r.oninput = null; r.onclick = null; r.innerHTML = ''; document.body.style.overflow = ''; }
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
  function field(label, html, hint) { return '<label class="block mb-4"><span class="' + lbl + '">' + label + '</span>' + html + (hint ? '<span class="block text-xs ' + muted + ' mt-1">' + hint + '</span>' : '') + '</label>'; }
  function moneyInput(name, value, o) {
    o = o || {};
    return '<div class="relative"><span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ' + muted + ' ' + (o.big ? 'text-2xl' : '') + '">£</span><input name="' + name + '" type="text" inputmode="decimal" class="' + inp + ' tnum pl-9 ' + (o.big ? 'text-3xl font-bold py-4' : '') + '" value="' + (value == null || value === '' ? '' : esc(value)) + '" placeholder="' + esc(o.placeholder || '0') + '"' + (o.autofocus ? ' autofocus' : '') + ' aria-label="' + esc(o.label || 'Amount') + '"></div>';
  }
  function seg(name, options, value) {
    return '<div class="grid gap-2 mb-4" style="grid-template-columns:repeat(' + options.length + ',minmax(0,1fr))" role="radiogroup">' + options.map(function (o) {
      return '<label class="cursor-pointer"><input type="radio" class="peer sr-only" name="' + name + '" value="' + o[0] + '"' + (o[0] === value ? ' checked' : '') + '>' +
        '<span class="flex h-12 items-center justify-center rounded-2xl ring-1 ring-slate-300 dark:ring-slate-700 text-sm font-semibold text-center px-1 peer-checked:bg-slate-900 peer-checked:text-white peer-checked:ring-slate-900 dark:peer-checked:bg-white dark:peer-checked:text-slate-900 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500">' + o[1] + '</span></label>';
    }).join('') + '</div>';
  }
  function chips(name, options, value) {
    return '<div class="flex flex-wrap gap-2 mb-4" role="radiogroup">' + options.map(function (o) {
      return '<label class="cursor-pointer"><input type="radio" class="peer sr-only" name="' + name + '" value="' + esc(o[0]) + '"' + (o[0] === value ? ' checked' : '') + '>' +
        '<span class="inline-flex h-10 items-center rounded-full px-4 ring-1 ring-slate-300 dark:ring-slate-700 text-sm font-semibold peer-checked:bg-emerald-600 peer-checked:text-white peer-checked:ring-emerald-600 dark:peer-checked:bg-emerald-500 dark:peer-checked:text-emerald-950 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500">' + o[1] + '</span></label>';
    }).join('') + '</div>';
  }
  function toggle(name, label, on, hint) {
    return '<label class="flex items-start gap-3 mb-4 cursor-pointer"><input type="checkbox" name="' + name + '" class="mt-0.5 h-5 w-5 rounded accent-emerald-600"' + (on ? ' checked' : '') + '><span class="text-sm"><span class="font-medium">' + label + '</span>' + (hint ? '<span class="block text-xs ' + muted + '">' + hint + '</span>' : '') + '</span></label>';
  }
  function dateField(name, value, label) { return field(label || 'Date', '<input name="' + name + '" type="date" class="' + inp + '" value="' + esc(value || '') + '" min="2020-01-01" max="2100-12-31">'); }
  function more(title, html, open) { return '<details class="mb-4 group"' + (open ? ' open' : '') + '><summary class="cursor-pointer list-none text-sm font-semibold ' + muted + ' py-2 flex items-center gap-1.5"><span class="inline-block transition group-open:rotate-90" aria-hidden="true">›</span>' + title + '</summary><div class="pt-2">' + html + '</div></details>'; }

  function askConfirm(o) {
    openSheet(o.title, '<p class="text-sm mb-5">' + o.text + '</p><div class="grid grid-cols-2 gap-3"><button type="button" data-close class="' + btnS + ' h-12">Cancel</button><button type="button" data-sa="ok" class="' + (o.danger ? btnD : btnP) + ' h-12">' + esc(o.ok) + '</button></div>', function (a) { if (a === 'ok') o.then(); }, { noFocus: true });
  }
  function find(list, id) { return S[list].find(function (x) { return x.id === id; }); }

  // ---------- Work day ----------
  function daySheet(id) {
    var x = id ? find('days', id) : null, rate = S.settings.defaultRate;
    if (!x) {
      var body = dateField('date', today()) + field('Pay for the day', moneyInput('rate', rate)) +
        '<span class="' + lbl + '">What happened?</span>' + seg('status', [['unpaid', 'Worked'], ['scheduled', 'Planned'], ['off', 'Day off']], 'unpaid') +
        '<button type="submit" class="' + btnP + ' h-14 w-full text-base">Add day</button>';
      return openSheet('Add a day', body, function (a, f) {
        var r = num(f.rate);
        if (!validDate(f.date)) return toast('Pick a date', { warn: true });
        if (r == null || r < 0 || r > 2000) return toast('Enter the pay for the day', { warn: true });
        var ex = S.days.find(function (y) { return y.date === f.date; });
        if (ex) { ex.rate = r; ex.status = f.status || 'unpaid'; } else S.days.push({ id: uid(), date: f.date, rate: r, status: f.status || 'unpaid', note: '' });
        closeSheet(); commit((ex ? 'Updated ' : 'Added ') + fDay(f.date));
      }, { noFocus: true });
    }
    var info = dayInfo[x.status];
    function opt(k, label) { return '<button type="button" data-sa="' + k + '" class="' + (x.status === k ? btnP : btnS) + ' h-14"' + (x.status === k ? ' aria-pressed="true"' : '') + '>' + label + '</button>'; }
    var body2 = '<div class="flex items-center justify-between -mt-2 mb-4"><span class="' + muted + ' text-sm">' + fDay(x.date) + '</span>' + pill(info[0], info[1]) + '</div>' +
      '<div class="grid grid-cols-2 gap-3 mb-4">' + opt('unpaid', 'Worked · owed') + opt('paid', 'Paid ✓') + opt('off', 'Day off') + opt('scheduled', 'Planned') + '</div>' +
      (x.status !== 'paid' ? toggle('logIn', 'When I tap “Paid”, also add ' + money(x.rate) + ' to money in', true, 'Turn this off if you already logged the pay with “I got paid”.') : '') +
      field('Pay for this day', '<div class="flex gap-2"><div class="flex-1">' + moneyInput('rate', x.rate) + '</div><button type="button" data-sa="rate" class="' + btnS + ' h-12 px-4 text-sm shrink-0">Save</button></div>', 'Usually ' + money(rate) + '.') +
      more('Note or delete', field('Note', '<input name="note" class="' + inp + '" maxlength="80" value="' + esc(x.note) + '" placeholder="Optional">') +
        '<div class="grid grid-cols-2 gap-3"><button type="button" data-sa="note" class="' + btnS + ' h-11 text-sm">Save note</button><button type="button" data-sa="delete" class="' + btnD + ' h-11 text-sm">Delete day</button></div>');
    openSheet('Work day', body2, function (a, f) {
      var r = num(f.rate);
      if (r == null || r < 0 || r > 2000) return toast('Enter the pay for the day', { warn: true });
      if (a === 'delete') { S.days = S.days.filter(function (y) { return y.id !== x.id; }); closeSheet(); return commit('Day deleted'); }
      x.rate = r;
      if (a === 'note') x.note = clean(f.note);
      if (dayInfo[a]) {
        var was = x.status; x.status = a;
        var logged = a === 'paid' && was !== 'paid' && f.logIn;
        if (logged) S.moneyIn.push({ id: uid(), date: today(), source: 'Job', amount: r, status: 'received', note: 'Pay for ' + fDay(x.date) });
        closeSheet(); return commit(fDay(x.date) + ' → ' + dayInfo[a][0] + (logged ? ' · ' + money(r) + ' added' : ''));
      }
      closeSheet(); commit('Saved');
    }, { noFocus: true });
  }

  // ---------- I got paid (the main flow) ----------
  function splitRows() {
    var c = calc(S), list = activeGoals();
    if (!list.length) return '<p class="text-sm py-3 ' + muted + '">No goals yet — it will all be kept as spare money.</p>';
    return list.map(function (g) {
      var x = c.goals[g.id];
      return '<div class="py-3 flex items-center gap-3"><span class="text-xl" aria-hidden="true">' + esc(g.emoji) + '</span><div class="flex-1 min-w-0"><div class="font-medium text-sm truncate">' + esc(g.name) + '</div>' +
        '<div class="text-xs ' + muted + '">' + (x.left == null ? 'no target yet' : money(x.left) + ' to go') + (g.deadline ? ' · ' + (g.type === 'payoff' ? 'due ' : 'by ') + fDate(g.deadline) : '') + '</div>' +
        (g.type === 'payoff' ? '<label data-pn="' + g.id + '" class="mt-1 hidden items-center gap-1.5 text-xs font-medium"><input type="checkbox" name="pn_' + g.id + '" class="h-4 w-4 accent-emerald-600" checked>Pay it now</label>' : '') +
        '</div><div class="w-28">' + moneyInput('sp_' + g.id, '', { label: 'Amount for ' + g.name }) + '</div></div>';
    }).join('');
  }
  function readSplits(f) {
    var out = [];
    Object.keys(f).forEach(function (k) { if (k.indexOf('sp_') === 0) { var v = num(f[k]); if (v && v > 0) out.push({ goalId: k.slice(3), amount: v, payNow: !!f['pn_' + k.slice(3)] }); } });
    return out;
  }
  function applySplits(m, splits) {
    splits.forEach(function (sp) {
      var g = goalById(sp.goalId); if (!g) return;
      S.allocations.push({ id: uid(), date: m.date, goalId: g.id, amount: sp.amount, inId: m.id, kind: 'split' });
      if (sp.payNow && g.type === 'payoff') S.moneyOut.push({ id: uid(), date: m.date, category: g.name, amount: sp.amount, goalId: g.id, inId: m.id, note: 'Paid from ' + m.source });
    });
  }

  function gotPaidSheet(pre) {
    pre = pre || {};
    var c = calc(S), exp = pre.inId ? find('moneyIn', pre.inId) : null;
    var sources = [['Job', 'Job']].concat(c.expected.map(function (x) { return ['exp:' + x.id, esc(x.source) + ' · ' + money(x.amount)]; })).concat([['Other', 'Other']]);
    var src = exp ? 'exp:' + exp.id : 'Job';
    var body = field('How much did you get?', moneyInput('amount', exp ? exp.amount : (c.unpaid || ''), { big: true, autofocus: !exp, label: 'Amount received' })) +
      '<span class="' + lbl + '">From</span>' + chips('src', sources, src) +
      '<div id="other-wrap" class="hidden">' + field('Who from?', '<input name="other" class="' + inp + '" maxlength="40" placeholder="e.g. Gift">') + '</div>' +
      '<p id="cover" class="text-sm rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3 mb-6" aria-live="polite"></p>' +
      '<div class="flex items-center justify-between"><span class="font-bold">Where should it go?</span><span class="flex gap-4"><button type="button" data-sa="suggest" class="' + btnLink + '">Suggest</button><button type="button" data-sa="clear" class="' + btnLink + '">Clear</button></span></div>' +
      '<p class="text-xs ' + muted + ' mb-1">Filled in from your plan. Change anything you like.</p>' +
      '<div id="splits" class="divide-y divide-slate-100 dark:divide-slate-800">' + splitRows() + '</div>' +
      '<div class="flex justify-between font-bold border-t border-slate-200 dark:border-slate-700 pt-3 mt-1 mb-5"><span>Kept as spare money</span><span id="spare-left" class="tnum"></span></div>' +
      more('Change date', dateField('date', today())) +
      '<button type="submit" class="' + btnP + ' h-14 w-full text-base">Save</button>';
    var touched = false;
    openSheet('I got paid', body, function (a, f) {
      if (a === 'suggest') return fill(true);
      if (a === 'clear') { document.querySelectorAll('#splits input[name^="sp_"]').forEach(function (i) { i.value = ''; }); touched = true; return update(); }
      var amt = num(f.amount);
      if (!amountOk(amt)) return toast('Enter how much you got', { warn: true });
      if (!validDate(f.date)) return toast('Pick a date', { warn: true });
      var splits = readSplits(f), used = r2(sum(splits, function (x) { return x.amount; }));
      if (used > amt + 0.004) return toast('That’s ' + money(used - amt) + ' more than you got', { warn: true });
      var isJob = f.src === 'Job', expId = (f.src || '').indexOf('exp:') === 0 ? f.src.slice(4) : null;
      var marked = isJob ? daysCovered(S, amt).days : [];
      marked.forEach(function (x) { x.status = 'paid'; });
      var m;
      if (expId && find('moneyIn', expId)) { m = find('moneyIn', expId); m.status = 'received'; m.amount = amt; m.date = f.date; }
      else { m = { id: uid(), date: f.date, source: isJob ? 'Job' : (clean(f.other, 40) || 'Other'), amount: amt, status: 'received', note: marked.length ? plural(marked.length, 'day') + ' paid' : '' }; S.moneyIn.push(m); }
      applySplits(m, splits);
      closeSheet();
      var bills = splits.filter(function (x) { return x.payNow && goalById(x.goalId).type === 'payoff'; });
      commit('Saved ' + money(amt) + (marked.length ? ' · ' + plural(marked.length, 'day') + ' marked paid' : '') + (bills.length ? ' · paid ' + bills.map(function (x) { return goalById(x.goalId).name; }).join(', ') : ''));
    }, { noFocus: !!exp });

    var root = document.getElementById('sheet-root');
    function update() {
      var f = formData(), amt = num(f.amount) || 0;
      var used = sum(readSplits(f), function (x) { return x.amount; }), left = r2(amt - used);
      var el = document.getElementById('spare-left');
      if (el) { el.textContent = money(left); el.className = 'tnum ' + (left < -0.004 ? 'text-red-600 dark:text-red-400' : ''); }
      document.getElementById('other-wrap').classList.toggle('hidden', f.src !== 'Other');
      document.querySelectorAll('#splits [data-pn]').forEach(function (l) { var on = (num(f['sp_' + l.getAttribute('data-pn')]) || 0) > 0; l.classList.toggle('hidden', !on); l.classList.toggle('inline-flex', on); });
      var cov = document.getElementById('cover'), owed = calc(S).unpaid;
      if (f.src === 'Job') {
        var r = daysCovered(S, amt), ds = r.days;
        cov.innerHTML = !amt ? 'Enter the amount to see which days it pays for.'
          : ds.length ? '✓ Pays for <b>' + plural(ds.length, 'owed day') + '</b> (' + fDate(ds[0].date) + (ds.length > 1 ? ' – ' + fDate(ds[ds.length - 1].date) : '') + '). They’ll be marked paid.' +
            (r.extra > 0.004 ? '<br>' + money(r.extra) + ' extra on top.' : '') + (owed - amt + r.extra > 0.004 ? '<br><span class="' + muted + '">Still owed after this: ' + money(r2(owed - amt + r.extra)) + '</span>' : '')
            : 'This doesn’t match any owed days, so it’s just added as money in.';
      } else if ((f.src || '').indexOf('exp:') === 0) cov.innerHTML = '✓ Marks this expected payment as arrived.';
      else cov.innerHTML = 'Added as money in.';
    }
    function fill(force) {
      if (touched && !force) return update();
      var f = formData(), amt = num(f.amount) || 0, expId = (f.src || '').indexOf('exp:') === 0 ? f.src.slice(4) : null;
      var sug = amt > 0 ? suggestSplit(amt, { job: f.src === 'Job', inId: expId }) : {};
      document.querySelectorAll('#splits input[name^="sp_"]').forEach(function (i) { var v = sug[i.name.slice(3)]; i.value = v ? r2(v) : ''; });
      touched = false; update();
    }
    root.oninput = function (e) { var n = e.target.name || ''; if (n.indexOf('sp_') === 0) touched = true; if (n === 'amount') fill(false); else update(); };
    root.onchange = function (e) {
      if (e.target.name === 'src') {
        var v = e.target.value, a = document.querySelector('#sheet-form [name=amount]');
        if (v.indexOf('exp:') === 0) { var m = find('moneyIn', v.slice(4)); if (m) a.value = m.amount; }
        else if (v === 'Job' && !a.value) a.value = calc(S).unpaid || '';
        fill(false);
      } else update();
    };
    fill(true);
  }

  // ---------- I spent money / pay a bill ----------
  function spentSheet(pre) {
    pre = pre || {};
    var c = calc(S);
    var cats = ['Food', 'Transport', 'Phone', 'Bills', 'Shopping', 'Other'];
    var goalOpts = activeGoals().filter(function (g) { return g.type === 'payoff' || c.goals[g.id].held > 0.004 || g.id === pre.goalId; });
    var body = field('How much?', moneyInput('amount', pre.amount != null ? pre.amount : '', { big: true, autofocus: true })) +
      '<span class="' + lbl + '">What for?</span>' + chips('cat', cats.map(function (x) { return [x, x]; }).concat(goalOpts.map(function (g) { return ['goal:' + g.id, esc(g.emoji + ' ' + g.name)]; })), pre.goalId ? 'goal:' + pre.goalId : 'Food') +
      '<p id="spend-hint" class="text-xs ' + muted + ' -mt-2 mb-4"></p>' +
      more('Date or note', dateField('date', today()) + field('Note', '<input name="note" class="' + inp + '" maxlength="80" placeholder="Optional">')) +
      '<button type="submit" class="' + btnP + ' h-14 w-full text-base">Save</button>';
    openSheet(pre.title || 'I spent money', body, function (a, f) {
      var amt = num(f.amount);
      if (!amountOk(amt)) return toast('Enter how much', { warn: true });
      if (!validDate(f.date)) return toast('Pick a date', { warn: true });
      var gid = (f.cat || '').indexOf('goal:') === 0 ? f.cat.slice(5) : null, g = gid ? goalById(gid) : null;
      var held = g ? Math.max(0, calc(S).goals[g.id].held) : 0;
      var o = { id: uid(), date: f.date, category: g ? g.name : (clean(f.cat, 40) || 'Other'), amount: amt, goalId: g ? g.id : null, note: clean(f.note) };
      S.moneyOut.push(o);
      // Money set aside for the goal is used first; the rest comes from spare money.
      if (g && amt > held + 0.004) S.allocations.push({ id: uid(), date: o.date, goalId: g.id, amount: r2(amt - held), outId: o.id, kind: 'auto' });
      closeSheet(); commit(g && g.type === 'payoff' ? 'Paid ' + money(amt) + ' to ' + g.name : 'Spent ' + money(amt) + ' on ' + o.category);
    });
    var root = document.getElementById('sheet-root');
    function hint() {
      var f = formData(), el = document.getElementById('spend-hint'), gid = (f.cat || '').indexOf('goal:') === 0 ? f.cat.slice(5) : null;
      if (!el) return;
      if (!gid) { el.textContent = 'Comes out of your spare money (' + money(calc(S).spare) + ').'; return; }
      var x = calc(S).goals[gid], held = Math.max(0, x.held), amt = num(f.amount) || 0;
      el.textContent = held > 0.004 ? 'Uses the ' + money(held) + ' set aside first' + (amt > held ? ', then ' + money(r2(amt - held)) + ' from spare money.' : '.') : 'Comes out of your spare money (' + money(calc(S).spare) + ').';
    }
    root.oninput = hint; root.onchange = hint; hint();
  }

  // ---------- Edit an entry ----------
  function inSheet(id) {
    var x = find('moneyIn', id); if (!x) return;
    var splits = S.allocations.filter(function (a) { return a.inId === x.id; });
    var paid = S.moneyOut.filter(function (o) { return o.inId === x.id; });
    var body = field('Amount', moneyInput('amount', x.amount, { big: true })) +
      field('From', '<input name="source" class="' + inp + '" maxlength="40" value="' + esc(x.source) + '">') +
      seg('status', [['received', 'Arrived'], ['expected', 'Expected']], x.status) + dateField('date', x.date) +
      (splits.length ? '<div class="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 mb-4 text-sm"><div class="font-semibold mb-1">This money went to</div>' + splits.map(function (a) { var g = goalById(a.goalId); return '<div class="flex justify-between"><span>' + (g ? esc(g.emoji + ' ' + g.name) : 'Deleted goal') + (paid.some(function (o) { return o.goalId === a.goalId; }) ? ' · paid' : '') + '</span><span class="tnum">' + money(a.amount) + '</span></div>'; }).join('') +
        '<button type="button" data-sa="unsplit" class="' + btnLink + ' mt-2">Undo the split (back to spare money)</button></div>' : '') +
      '<div class="grid grid-cols-2 gap-3"><button type="button" data-sa="delete" class="' + btnD + ' h-12">Delete</button><button type="submit" class="' + btnP + ' h-12">Save</button></div>';
    openSheet('Money in', body, function (a, f) {
      if (a === 'delete') return askConfirm({ title: 'Delete this?', text: 'Removes ' + money(x.amount) + ' from ' + esc(x.source) + (splits.length ? ', its split' + (paid.length ? ' and the bill payments made from it' : '') : '') + '. You can undo straight after.', ok: 'Delete', danger: true, then: function () {
        S.allocations = S.allocations.filter(function (al) { return al.inId !== x.id; });
        S.moneyOut = S.moneyOut.filter(function (o) { return o.inId !== x.id; });
        S.moneyIn = S.moneyIn.filter(function (y) { return y.id !== x.id; }); closeSheet(); commit('Deleted');
      } });
      if (a === 'unsplit') {
        S.allocations = S.allocations.filter(function (al) { return al.inId !== x.id; });
        S.moneyOut = S.moneyOut.filter(function (o) { return o.inId !== x.id; });
        closeSheet(); return commit('Split undone · ' + money(sum(splits, function (s2) { return s2.amount; })) + ' back to spare');
      }
      var amt = num(f.amount);
      if (!amountOk(amt)) return toast('Enter an amount', { warn: true });
      var used = sum(splits, function (s2) { return s2.amount; });
      if (amt < used - 0.004) return toast(money(used) + ' of this went to goals. Undo the split first.', { warn: true });
      if (f.status === 'expected' && splits.length) return toast('Undo the split before marking it expected', { warn: true });
      if (!validDate(f.date)) return toast('Pick a date', { warn: true });
      x.amount = amt; x.source = clean(f.source, 40) || 'Other'; x.status = f.status === 'expected' ? 'expected' : 'received'; x.date = f.date;
      closeSheet(); commit('Saved');
    }, { noFocus: true });
  }
  function outSheet(id) {
    var x = find('moneyOut', id); if (!x) return;
    var g = x.goalId ? goalById(x.goalId) : null;
    var body = field('Amount', moneyInput('amount', x.amount, { big: true })) +
      field('What for', '<input name="category" class="' + inp + '" maxlength="40" value="' + esc(x.category) + '">') + dateField('date', x.date) +
      (g ? '<p class="text-sm ' + muted + ' mb-4">Linked to ' + esc(g.emoji + ' ' + g.name) + '.</p>' : '') +
      field('Note', '<input name="note" class="' + inp + '" maxlength="80" value="' + esc(x.note) + '" placeholder="Optional">') +
      '<div class="grid grid-cols-2 gap-3"><button type="button" data-sa="delete" class="' + btnD + ' h-12">Delete</button><button type="submit" class="' + btnP + ' h-12">Save</button></div>';
    openSheet('Money out', body, function (a, f) {
      if (a === 'delete') return askConfirm({ title: 'Delete this?', text: 'Removes ' + money(x.amount) + ' ' + esc(x.category) + '. You can undo straight after.', ok: 'Delete', danger: true, then: function () {
        S.allocations = S.allocations.filter(function (al) { return al.outId !== x.id; });
        S.moneyOut = S.moneyOut.filter(function (y) { return y.id !== x.id; }); closeSheet(); commit('Deleted');
      } });
      var amt = num(f.amount);
      if (!amountOk(amt)) return toast('Enter an amount', { warn: true });
      if (!validDate(f.date)) return toast('Pick a date', { warn: true });
      x.amount = amt; x.category = clean(f.category, 40) || 'Other'; x.date = f.date; x.note = clean(f.note);
      if (x.goalId) {
        // Re-balance: any part not covered by money set aside comes from spare money.
        S.allocations = S.allocations.filter(function (al) { return al.outId !== x.id; });
        var cc = calc(S).goals[x.goalId];
        if (cc && cc.held < -0.004) S.allocations.push({ id: uid(), date: x.date, goalId: x.goalId, amount: Math.min(r2(-cc.held), amt), outId: x.id, kind: 'auto' });
      }
      closeSheet(); commit('Saved');
    }, { noFocus: true });
  }

  // ---------- Move money ----------
  function moveSheet(pre) {
    pre = pre || {};
    var c = calc(S);
    var gl = sortGoals(S.goals.filter(function (g) { return g.status === 'active' || g.status === 'paused'; }));
    function opts(sel) {
      return '<option value="u"' + (sel === 'u' ? ' selected' : '') + '>💷 Spare money (' + money(c.spare) + ')</option>' + gl.map(function (g) {
        return '<option value="' + g.id + '"' + (sel === g.id ? ' selected' : '') + '>' + esc(g.emoji + ' ' + g.name) + ' (' + money(Math.max(0, c.goals[g.id].held)) + ' set aside)</option>';
      }).join('');
    }
    var from = pre.from || 'u', to = pre.to || (from === 'u' ? (gl[0] || {}).id : 'u') || 'u', sug = '';
    if (from === 'u' && to !== 'u' && c.goals[to]) { var tx = c.goals[to]; sug = Math.max(0, Math.min(tx.left == null ? c.spare : tx.left, c.spare)); }
    var body = field('From', '<select name="from" class="' + inp + '">' + opts(from) + '</select>') +
      field('To', '<select name="to" class="' + inp + '">' + opts(to) + '</select>') +
      field('Amount', moneyInput('amount', sug ? r2(sug) : '', { big: true, autofocus: true })) +
      '<button type="submit" class="' + btnP + ' h-14 w-full text-base">Move</button>';
    openSheet(pre.title || 'Move money', body, function (a, f) {
      var amt = num(f.amount);
      if (!amountOk(amt)) return toast('Enter an amount', { warn: true });
      if (f.from === f.to) return toast('Pick two different places', { warn: true });
      var cc = calc(S), avail = f.from === 'u' ? cc.spare : Math.max(0, cc.goals[f.from].held);
      if (amt > avail + 0.004) return toast('Only ' + money(Math.max(0, avail)) + ' available there', { warn: true });
      var mid = uid(), dt = today();
      if (f.from !== 'u') S.allocations.push({ id: uid(), date: dt, goalId: f.from, amount: -amt, moveId: mid, kind: 'move' });
      if (f.to !== 'u') S.allocations.push({ id: uid(), date: dt, goalId: f.to, amount: amt, moveId: mid, kind: 'move' });
      var nm = function (k) { return k === 'u' ? 'spare money' : goalById(k).name; };
      closeSheet(); commit('Moved ' + money(amt) + ' to ' + nm(f.to));
    });
  }

  // ---------- Goals ----------
  function normaliseOrder() { sortGoals(S.goals).forEach(function (g, i) { g.order = i; }); }
  function moveGoal(id, dir) {
    var arr = activeGoals(), i = arr.findIndex(function (g) { return g.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    var g = arr[i], o = arr[j], changed = g.priority !== o.priority;
    arr[i] = o; arr[j] = g; if (changed) g.priority = o.priority;
    arr.forEach(function (x, k) { x.order = k; }); normaliseOrder();
    commit(g.name + ' moved ' + (dir < 0 ? 'up' : 'down') + (changed ? ' · now ' + PRI_LABEL[g.priority] + ' priority' : ''));
  }
  function payGoal(g) { var x = calc(S).goals[g.id]; spentSheet({ title: 'Pay ' + g.name, goalId: g.id, amount: x.left || '' }); }
  function releaseHeld(g) {
    var held = calc(S).goals[g.id].held;
    if (held > 0.004) S.allocations.push({ id: uid(), date: today(), goalId: g.id, amount: -held, kind: 'release' });
    return held;
  }
  function completeGoal(g) {
    var x = calc(S).goals[g.id];
    function finish(extra) { g.status = 'done'; g.completedAt = today(); g.autoDone = false; closeSheet(); commit(g.name + ' done 🎉' + (extra || '')); }
    function step2() {
      if (x.held > 0.004) {
        openSheet('Finish ' + g.name, '<p class="text-sm mb-5"><b class="tnum">' + money(x.held) + '</b> is still set aside for this goal. What happened to it?</p>' +
          '<button type="button" data-sa="spent" class="' + btnP + ' h-14 w-full mb-3">I spent it</button>' +
          '<button type="button" data-sa="release" class="' + btnS + ' h-14 w-full">Put it back in spare money</button>', function (a) {
          if (a === 'spent') { var o = { id: uid(), date: today(), category: g.name, amount: r2(x.held), goalId: g.id, note: 'Goal done' }; S.moneyOut.push(o); finish(' · ' + money(o.amount) + ' logged as spent'); }
          else if (a === 'release') { releaseHeld(g); finish(' · ' + money(x.held) + ' back to spare'); }
        }, { noFocus: true });
      } else finish();
    }
    if (x.left) askConfirm({ title: 'Mark ' + esc(g.name) + ' done?', text: money(x.left) + ' is still ' + (g.type === 'payoff' ? 'left to pay' : 'short of the target') + '.', ok: 'Mark done', then: step2 });
    else step2();
  }

  function goalForm(rec, isNew) {
    return field('Name', '<input name="name" class="' + inp + '" maxlength="40" value="' + esc(rec.name) + '" placeholder="e.g. Holiday"' + (isNew ? ' autofocus' : '') + '>') +
      '<span class="' + lbl + '">Type</span>' + seg('type', [['save', 'Save up'], ['payoff', 'Bill / debt']], rec.type) +
      '<div class="grid grid-cols-2 gap-3">' + field('Target', moneyInput('target', rec.target == null ? '' : rec.target, { placeholder: 'Not sure yet', label: 'Target' })) +
      dateField('deadline', rec.deadline, 'Deadline') + '</div>' +
      '<span class="' + lbl + '">Priority</span>' + seg('priority', [['high', 'High'], ['med', 'Medium'], ['low', 'Low']], rec.priority) +
      more('Look & notes', '<div class="grid grid-cols-[5rem_1fr] gap-3">' + field('Emoji', '<input name="emoji" class="' + inp + ' text-center text-2xl" maxlength="4" value="' + esc(rec.emoji) + '">') +
        '<div><span class="' + lbl + '">Colour</span><div class="flex flex-wrap gap-2 mb-4">' + COLORS.map(function (cl) {
          return '<label class="cursor-pointer"><input type="radio" name="color" value="' + cl[0] + '" class="peer sr-only"' + (cl[0] === rec.color ? ' checked' : '') + '><span class="block h-9 w-9 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-slate-900 peer-checked:ring-2 peer-checked:ring-slate-900 dark:peer-checked:ring-white peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500" style="background:' + cl[1] + '" title="' + cl[0] + '"></span></label>';
        }).join('') + '</div></div></div>' +
        toggle('legalRisk', 'Legal risk (e.g. CCJ)', rec.legalRisk, 'Shows a HIGH PRIORITY flag until it’s paid.') +
        field('Notes', '<textarea name="notes" rows="2" maxlength="200" class="' + inp + '" placeholder="Optional">' + esc(rec.notes) + '</textarea>'));
  }
  function goalSheet(id) {
    var g = id ? goalById(id) : null;
    if (!g) {
      var rec = { name: '', type: 'save', target: null, deadline: null, priority: 'med', emoji: '🎯', color: COLORS[S.goals.length % COLORS.length][0], notes: '', legalRisk: false };
      return openSheet('New goal', goalForm(rec, true) + '<button type="submit" class="' + btnP + ' h-14 w-full text-base">Add goal</button>', function (a, f) { if (a === 'save') saveGoal(null, f); });
    }
    var x = calc(S).goals[g.id], st = g.status, pay = g.type === 'payoff', live = st === 'active' || st === 'paused';
    var head = '<div class="flex items-center gap-3 -mt-1 mb-3"><span class="text-4xl" aria-hidden="true">' + esc(g.emoji) + '</span><div class="flex-1 min-w-0"><div class="tnum text-2xl font-bold">' + money(x.progress) + ' <span class="text-base font-medium ' + muted + '">of ' + money(x.target) + '</span></div><div class="flex flex-wrap gap-1.5 mt-1">' + urgentPill(g, x) + statusPill(x) + '</div></div></div>' +
      '<div class="mb-3">' + bar(x.pct, colorOf(g.color), g.name) + '</div>' +
      '<dl class="grid grid-cols-3 gap-2 text-center mb-5">' +
      '<div class="rounded-2xl bg-slate-50 dark:bg-slate-800/60 py-2"><dt class="text-[11px] ' + muted + '">' + (pay ? 'Left to pay' : 'To go') + '</dt><dd class="font-bold tnum">' + money(x.left) + '</dd></div>' +
      '<div class="rounded-2xl bg-slate-50 dark:bg-slate-800/60 py-2"><dt class="text-[11px] ' + muted + '">' + (pay ? 'Paid' : 'Set aside') + '</dt><dd class="font-bold tnum">' + money(pay ? x.spent : Math.max(0, x.held)) + '</dd></div>' +
      '<div class="rounded-2xl bg-slate-50 dark:bg-slate-800/60 py-2"><dt class="text-[11px] ' + muted + '">' + (pay ? 'Due' : 'Deadline') + '</dt><dd class="font-bold">' + (g.deadline ? fDate(g.deadline) : '—') + '</dd></div></dl>' +
      (g.completedAt ? '<p class="text-sm ' + muted + ' -mt-2 mb-4">✓ Completed ' + fDate(g.completedAt) + '</p>' : '') +
      (g.notes ? '<p class="text-sm ' + muted + ' -mt-2 mb-4">' + esc(g.notes) + '</p>' : '');
    var acts = live
      ? '<div class="grid grid-cols-2 gap-3 mb-4">' + (pay ? '<button type="button" data-sa="pay" class="' + btnP + ' h-14">Pay</button>' : '<button type="button" data-sa="add" class="' + btnP + ' h-14">＋ Add money</button>') +
        (x.held > 0.004 ? '<button type="button" data-sa="take" class="' + btnS + ' h-14">Take money out</button>' : '<button type="button" data-sa="done" class="' + btnS + ' h-14">✓ Mark done</button>') + '</div>'
      : '<button type="button" data-sa="reopen" class="' + btnS + ' h-14 w-full mb-4">' + (st === 'archived' ? 'Bring it back' : 'Reopen goal') + '</button>';
    var opts = '<div class="grid grid-cols-2 gap-3">' +
      (st === 'active' ? '<button type="button" data-sa="pause" class="' + btnS + ' h-11 text-sm">Pause</button>' : st === 'paused' ? '<button type="button" data-sa="resume" class="' + btnS + ' h-11 text-sm">Resume</button>' : '') +
      (live ? '<button type="button" data-sa="archive" class="' + btnS + ' h-11 text-sm">Archive</button>' : '') +
      (live && x.held > 0.004 ? '<button type="button" data-sa="done" class="' + btnS + ' h-11 text-sm">✓ Mark done</button>' : '') +
      '<button type="button" data-sa="delete" class="' + btnD + ' h-11 text-sm">Delete goal</button></div>';
    var body = head + acts + more('Edit details', goalForm(g, false) + '<button type="submit" class="' + btnP + ' h-12 w-full mb-2">Save changes</button>') + more('More options', opts);
    openSheet(g.name, body, function (a, f) {
      if (a === 'save') return saveGoal(g, f);
      if (a === 'pay') { closeSheet(); return payGoal(g); }
      if (a === 'add') { closeSheet(); return moveSheet({ from: 'u', to: g.id, title: 'Add money to ' + g.name }); }
      if (a === 'take') { closeSheet(); return moveSheet({ from: g.id, to: 'u', title: 'Take money out of ' + g.name }); }
      if (a === 'done') return completeGoal(g);
      if (a === 'pause' || a === 'resume') { g.status = a === 'pause' ? 'paused' : 'active'; normaliseOrder(); closeSheet(); return commit(g.name + (a === 'pause' ? ' paused' : ' resumed')); }
      if (a === 'reopen') { g.status = 'active'; g.completedAt = null; g.autoDone = false; normaliseOrder(); closeSheet(); return commit(g.name + ' is active again'); }
      if (a === 'archive') return askConfirm({ title: 'Archive ' + esc(g.name) + '?', text: 'It’s hidden from your lists' + (x.held > 0.004 ? ', and the ' + money(x.held) + ' set aside goes back to spare money' : '') + '.', ok: 'Archive', then: function () {
        var rel = releaseHeld(g); g.status = 'archived'; closeSheet(); commit(g.name + ' archived' + (rel > 0.004 ? ' · ' + money(rel) + ' back to spare' : ''));
      } });
      if (a === 'delete') return askConfirm({ title: 'Delete ' + esc(g.name) + '?', text: (x.held > 0.004 ? 'The ' + money(x.held) + ' set aside goes back to spare money. ' : '') + 'Payments you made stay in your history. You can undo straight after.', ok: 'Delete', danger: true, then: function () {
        S.allocations = S.allocations.filter(function (al) { return al.goalId !== g.id; });
        S.moneyOut.forEach(function (o) { if (o.goalId === g.id) o.goalId = null; });
        S.goals = S.goals.filter(function (y) { return y.id !== g.id; }); closeSheet(); commit('Deleted ' + g.name);
      } });
    }, { noFocus: true });
  }
  function saveGoal(g, f) {
    var name = clean(f.name, 40);
    if (!name) return toast('Give the goal a name', { warn: true });
    var target = num(f.target);
    if (f.target && (target == null || target <= 0 || target > MAX_AMOUNT)) return toast('Target must be a positive amount (or leave it empty)', { warn: true });
    if (f.deadline && !validDate(f.deadline)) return toast('Check the deadline', { warn: true });
    var o = g || newGoal({}), priChanged = !g || g.priority !== f.priority;
    o.name = name; o.type = f.type === 'payoff' ? 'payoff' : 'save'; o.target = target; o.deadline = f.deadline || null;
    o.priority = PRI[f.priority] != null ? f.priority : 'med';
    o.emoji = clean(f.emoji, 4) || '🎯'; o.color = COLORS.some(function (cl) { return cl[0] === f.color; }) ? f.color : o.color;
    o.notes = clean(f.notes, 200); o.legalRisk = !!f.legalRisk;
    if (priChanged) {
      var peers = sortGoals(S.goals.filter(function (y) { return y.priority === o.priority && y.id !== o.id; }));
      var before = peers.find(function (y) { return o.deadline && (!y.deadline || y.deadline > o.deadline); });
      o.order = before ? before.order - 0.5 : (peers.length ? peers[peers.length - 1].order + 0.5 : S.goals.length);
    }
    if (!g) S.goals.push(o);
    normaliseOrder(); closeSheet(); commit(g ? 'Saved' : 'Added ' + name);
  }

  // ---------- Settings ----------
  function settingsSheet() {
    var st = S.settings, theme = sGet(K.theme) || 'system';
    var body = '<h3 class="font-bold mb-2">Appearance</h3>' + seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], theme) +
      '<h3 class="font-bold mb-2 mt-2">Work</h3><div class="grid grid-cols-2 gap-3">' + field('Usual day rate', moneyInput('defaultRate', st.defaultRate)) + dateField('workUntil', st.workUntil, 'Plan shifts until') + '</div>' +
      '<h3 class="font-bold mb-2 mt-2">Security</h3>' +
      toggle('remember', 'Keep me signed in on this device', rememberMe(), 'Turn this off on a shared device — you’ll enter your PIN each time.') +
      '<button type="submit" class="' + btnP + ' h-12 w-full mb-3">Save settings</button>' +
      '<button type="button" data-sa="lock" class="' + btnS + ' h-12 w-full mb-6">🔒 Lock now</button>' +
      more('Backup', '<div class="grid grid-cols-2 gap-3"><button type="button" data-sa="export" class="' + btnS + ' h-12 text-sm">Download backup</button><button type="button" data-sa="import" class="' + btnS + ' h-12 text-sm">Restore backup</button></div><input id="import-file" type="file" accept="application/json,.json" class="hidden">') +
      more('Advanced', field('Savings correction', moneyInput('adjust', st.adjust || 0), 'Only use this if your real balance differs from the app. It’s added to “Total saved”.') + '<button type="button" data-sa="adjust" class="' + btnS + ' h-11 w-full text-sm">Save correction</button>');
    openSheet('Settings', body, function (a, f) {
      if (a === 'lock') { closeSheet(); return lock('Locked. Enter your PIN to open.'); }
      if (a === 'export') {
        var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), el = document.createElement('a');
        el.href = URL.createObjectURL(blob); el.download = 'money-tracker-' + today() + '.json'; document.body.appendChild(el); el.click(); el.remove();
        setTimeout(function () { URL.revokeObjectURL(el.href); }, 1000); return toast('Backup downloaded');
      }
      if (a === 'import') {
        var fi = document.getElementById('import-file');
        fi.onchange = function () {
          var file = fi.files && fi.files[0]; if (!file) return;
          if (file.size > 2e6) return toast('That file is too big', { warn: true });
          file.text().then(function (txt) {
            var data; try { data = migrate(JSON.parse(txt)); } catch (e) { data = null; }
            if (!data) return toast('That isn’t a valid backup file', { warn: true });
            askConfirm({ title: 'Restore this backup?', text: 'It replaces everything in the app. You can undo straight after.', ok: 'Restore', danger: true, then: function () { S = data; closeSheet(); commit('Backup restored'); } });
          });
        };
        return fi.click();
      }
      if (a === 'adjust') { var adj = num(f.adjust); if (adj == null || Math.abs(adj) > MAX_AMOUNT) return toast('Check the amount', { warn: true }); S.settings.adjust = adj; closeSheet(); return commit('Correction saved'); }
      var rate = num(f.defaultRate);
      if (rate == null || rate < 0 || rate > 2000) return toast('Check the day rate', { warn: true });
      if (!validDate(f.workUntil)) return toast('Pick a date', { warn: true });
      setRemember(!!f.remember); setTheme(f.theme || 'system');
      S.settings.defaultRate = rate; S.settings.workUntil = f.workUntil;
      closeSheet(); commit('Settings saved', { noUndo: true });
    }, { noFocus: true });
  }
  function setRemember(on) {
    var p = pin, cch = sGet(K.cache);
    sDel(K.pin); sDel(K.cache);
    try { localStorage.setItem(K.remember, on ? '1' : '0'); } catch (e) {}
    if (p) sSet(K.pin, p); if (cch) sSet(K.cache, cch);
  }
  function setTheme(t) {
    try { localStorage.setItem(K.theme, t); } catch (e) {}
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }

  // ================= Toast =================
  function toast(msg, o) {
    o = o || {};
    var root = document.getElementById('toast-root'), el = document.createElement('div');
    el.className = 'toast-enter pointer-events-auto max-w-md w-full rounded-2xl pl-4 pr-2 py-2 min-h-12 text-sm shadow-lg flex items-center gap-3 ' + (o.warn ? 'bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-50' : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900');
    el.setAttribute('role', o.warn ? 'alert' : 'status');
    var span = document.createElement('span'); span.className = 'flex-1 py-1'; span.textContent = msg; el.appendChild(span);
    if (o.undo) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'shrink-0 rounded-xl px-3 h-9 font-bold text-emerald-300 dark:text-emerald-700'; b.textContent = 'Undo';
      b.onclick = function () { el.remove(); undo(o.undo); }; el.appendChild(b);
    }
    while (root.firstChild) root.firstChild.remove();
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, o.ms || (o.undo ? 6000 : 3000));
  }

  // ================= Actions =================
  function workedToday() {
    var t = today(), x = S.days.find(function (y) { return y.date === t; });
    if (x && (x.status === 'unpaid' || x.status === 'paid')) return toast('Today is already logged ✓');
    if (x) { if (x.status === 'off') x.rate = Number(S.settings.defaultRate); x.status = 'unpaid'; }
    else { x = { id: uid(), date: t, rate: Number(S.settings.defaultRate), status: 'unpaid', note: '' }; S.days.push(x); }
    commit('Logged today · ' + money(x.rate) + ' owed to you');
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || !S || el.closest('#sheet-root')) return;
    var a = el.getAttribute('data-action'), id = el.getAttribute('data-id'), v = el.getAttribute('data-v');
    snap = JSON.stringify(S);
    switch (a) {
      case 'worked-today': return workedToday();
      case 'got-paid': return gotPaidSheet();
      case 'got-paid-expected': return gotPaidSheet({ inId: id });
      case 'spent': return spentSheet();
      case 'day': return daySheet(id);
      case 'day-set': { var dd = find('days', id); if (dd && dayInfo[v]) { dd.status = v; commit(fDay(dd.date) + (v === 'off' ? ' → day off' : ' → worked')); } return; }
      case 'in': return inSheet(id);
      case 'out': return outSheet(id);
      case 'move': { var to = el.getAttribute('data-to'), tg = to ? goalById(to) : null; return moveSheet({ to: to || undefined, title: tg ? 'Add money to ' + tg.name : null }); }
      case 'goal': return goalSheet(id);
      case 'goal-up': case 'goal-down': return moveGoal(id, a === 'goal-up' ? -1 : 1);
      case 'goal-pay': { var gp = goalById(id); if (gp) payGoal(gp); return; }
      case 'goal-complete': { var gc = goalById(id); if (gc) completeGoal(gc); return; }
      case 'goto': location.hash = '#' + id; return;
      case 'toggle': { var k = el.getAttribute('data-k'); if (k in ui) ui[k] = !ui[k]; return render(); }
      case 'filter': if (['all', 'in', 'out'].indexOf(v) >= 0) ui.filter = v; return render();
      case 'settings': return settingsSheet();
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && pin && S) loadFromServer({ notify: true, background: true }); });
  window.addEventListener('online', function () { if (pin) { if (dirty) pushSave(); else loadFromServer(); } });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { setTheme(sGet(K.theme) || 'system'); if (S) render(); });

  // ================= Lock screen =================
  function renderLock(msg) {
    closeSheet();
    var entered = '', busy = false, err = msg || '', keepIn = rememberMe();
    function draw() {
      var dots = ''; for (var i = 0; i < 6; i++) dots += '<span class="h-3.5 w-3.5 rounded-full transition ' + (i < entered.length ? 'bg-slate-900 dark:bg-white' : 'ring-2 ring-inset ring-slate-300 dark:ring-slate-600') + '"></span>';
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
      document.getElementById('app').innerHTML =
        '<main class="min-h-[100dvh] flex flex-col items-center justify-center px-6 -mb-16"><div class="h-16 w-16 rounded-3xl bg-emerald-600 flex items-center justify-center text-3xl shadow-lg" aria-hidden="true">💷</div>' +
        '<h1 class="text-2xl font-bold mt-4">Money Tracker</h1><p class="text-sm ' + muted + ' mt-1">Enter your 6-digit PIN</p>' +
        '<div class="flex gap-3 my-7" role="img" aria-label="' + entered.length + ' of 6 digits entered">' + dots + '</div>' +
        '<p class="min-h-10 text-sm text-center max-w-xs ' + (err ? 'text-red-600 dark:text-red-400' : muted) + '" role="alert">' + esc(busy ? 'Checking…' : err) + '</p>' +
        '<div class="grid grid-cols-3 gap-4 mt-2 w-full max-w-[300px]">' + keys.map(function (k) {
          if (!k) return '<span></span>';
          return '<button data-key="' + k + '" class="' + btnS + ' h-[68px] rounded-full text-2xl font-semibold" ' + (busy ? 'disabled' : '') + ' aria-label="' + (k === '⌫' ? 'Delete' : k) + '">' + k + '</button>';
        }).join('') + '</div>' +
        '<label class="mt-8 flex items-center gap-2 text-sm ' + muted + '"><input id="remember" type="checkbox" class="h-4 w-4 accent-emerald-600"' + (keepIn ? ' checked' : '') + '> Keep me signed in on this device</label></main>';
    }
    draw();
    function submit() {
      var remember = keepIn, tryPin = entered;
      busy = true; draw();
      rpc('mt_load', { p_pin: tryPin }).then(function (r) {
        busy = false;
        if (!r.ok) { entered = ''; err = 'That PIN isn’t right. Try again.'; draw(); return; }
        try { localStorage.setItem(K.remember, remember ? '1' : '0'); } catch (e) {}
        pin = tryPin; sSet(K.pin, pin);
        var old = r.data && (r.data.schema || 1) < 3;
        if (r.data == null) { S = seed(); version = r.version; dirty = true; } else { S = migrate(r.data); version = r.version; dirty = !!old; }
        cache(); syncState = 'saved'; detach(); render();
        if (dirty) pushSave();
      }).catch(function (e) {
        busy = false; entered = '';
        err = e.locked ? 'Too many wrong PINs. Wait 15 minutes, then try again.' : 'Can’t reach the server. Check your connection.'; draw();
      });
    }
    function press(k) {
      if (busy) return;
      if (k === '⌫') entered = entered.slice(0, -1); else if (entered.length < 6) entered += k;
      err = ''; draw();
      if (entered.length === 6) submit();
    }
    function onClick(e) { var b = e.target.closest('[data-key]'); if (b && !b.disabled) press(b.getAttribute('data-key')); }
    function onKey(e) { if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); }
    function onChange(e) { if (e.target && e.target.id === 'remember') keepIn = e.target.checked; }
    function detach() { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); document.removeEventListener('change', onChange); }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('change', onChange);
  }

  // ================= Boot =================
  window.__mtSetToday = function (x) { __today = x; if (S) render(); };
  window.__mtState = function () { return { S: S, version: version, dirty: dirty, calc: S ? calc(S) : null }; };

  if (pin) {
    var cached = readCache();
    if (cached && cached.data) { S = migrate(cached.data); version = cached.version || 0; dirty = !!cached.dirty; render(); }
    loadFromServer();
  } else renderLock();
})();
