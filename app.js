/* 1915 South Smart Scheduler: app logic. Loaded by index.html after sign-in. */

const DATA = window.SS_DATA;
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DAYFULL = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const SHAPES = {
  morning:{t:"Heavier mornings", d:"Load up your Openers. Get consultants in at 9:30 and on the floor from open. Run leaner into the evening.", pill:"Heavier mornings"},
  both:{t:"Solid both ways", d:"Run a good mix of Openers and Closers so you're fullest from 12 to 5, when they overlap.", pill:"Solid both ways"},
  evening:{t:"Heavier evenings", d:"Run leaner on Openers and load up your Mid and Closer shifts so you stay heavy to close.", pill:"Heavier evenings"}
};
const KEY = "smart-scheduler-v3";
const ROLES = {C:"Consultant", PT:"Part-time Consultant", GM:"General Manager", L:"Assistant General Manager", LSL:"Lead Selling Leader", ASL:"Assistant Selling Leader", KH:"Key Holder", CSR:"CSR"};
const LEAD_ORDER = ["GM","L","LSL","ASL","KH"];
const isLead = r => r !== "C" && r !== "PT" && r !== "CSR";   // counts toward leader on the floor
const fte = r => r === "PT" ? 0.5 : 1;          // two part-timers equal one full-time consultant
/* New hires in training show on the schedule but never count toward coverage or staffing. */
/* A new hire is in training from the week they're marked until the training weeks in the staffing standard run out. */
const nhEnd = p => p.nhStart ? addDays(p.nhStart, 7 * (S.nhWeeks || 4)) : null;
const nhActive = (p, week) => !!p.nh && (!p.nhStart || (week || CTXW || S.week) < nhEnd(p));
/* After training, a new hire stays tagged for a few more weeks so leaders pair them with a High or Middle performer. */
const nhTagEnd = p => p.nhStart ? addDays(nhEnd(p), 7 * (S.nhTagWeeks || 4)) : null;
const nhPhase = (p, week) => { if (!p.nh) return null; const w = week || CTXW || S.week; if (nhActive(p, w)) return "training"; return p.nhStart && w < nhTagEnd(p) ? "tagged" : null; };
/* Performance tiers: High, Middle, Low per person, kept per store (perf/<store>). */
const PERF = {};
const TIERS = {H:"High", M:"Middle", L:"Low"};
const tierOf = (store, p) => (PERF[store] && PERF[store][p.name]) || "";
const isCounted = p => sells(p.role) && !nhActive(p);
const leadCounted = p => isLead(p.role) && !nhActive(p);
const sells = r => r !== "L" && r !== "GM" && r !== "CSR";            // counts toward consultants on the floor
const hourly = r => r !== "L" && r !== "GM";
const wkndReq = r => r !== "CSR";   // weekends are mandatory workdays for sales and leadership, unless on PTO           // held to the weekly hours target
let S = {store:"Baton Rouge", view:"guests", gpc:1, gpcLight:1, minc:2, target:40, lunch:0.5, pto:8, ptTarget:20, nhWeeks:4, nhTagWeeks:4};
/* The staffing standard is one company-wide setting (db doc settings/standard). Only the artifact owner can change it. */
const STD_KEYS = ["gpc","minc","target","lunch","pto","ptTarget","nhWeeks","nhTagWeeks"];
let IS_OWNER = false, STD_META = null;
try { const raw = localStorage.getItem(KEY); if (raw) { const o = JSON.parse(raw); ["store","view"].forEach(k => { if (o[k] != null) S[k] = o[k]; }); } } catch(e) {}
function save(){ try { localStorage.setItem(KEY, JSON.stringify({store:S.store, view:S.view})); } catch(e) {} }
function applyStd(d){
  let changed = false;
  STD_KEYS.forEach(k => { const v = d && d[k]; if (typeof v === "number" && isFinite(v) && v !== S[k]){ S[k] = v; changed = true; } });
  STD_META = d ? {updatedAt:d.updatedAt, updatedBy:d.updatedBy} : null;
  if (changed){ _recCache = {}; Object.keys(DRAFTS).forEach(k => delete DRAFTS[k]); }
  return changed;
}
async function saveStd(){
  if (!DB) return;
  const body = {}; STD_KEYS.forEach(k => body[k] = S[k]); body.updatedAt = new Date().toISOString(); body.updatedBy = MYID || "";
  try { await DB.doc("settings/standard").set(body); toast("Staffing standard saved for every store"); }
  catch(e){ toast("Only the owner can change the staffing standard"); IS_OWNER = false; renderAll(); }
}

/* ---------- time and weeks (store-local) ---------- */
const CENTRAL = new Set(["Baton Rouge","Harahan","Lafayette","Lake Charles","Ponchatoula","Houma","Gonzales","Opelousas","Harvey","Flowood","Hattiesburg","D'Iberville","Dothan","Enterprise","Opelika","Mobile","Spanish Fort","Pensacola","Pensacola Outlet","Crestview","Fort Walton Beach","Panama City"]);
const tzOf = st => CENTRAL.has(st) ? "America/Chicago" : "America/New_York";
const tzLabel = st => CENTRAL.has(st) ? "Central" : "Eastern";
function storeNow(st){
  const p = {}; new Intl.DateTimeFormat("en-US", {timeZone:tzOf(st), year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23", weekday:"short"}).formatToParts(new Date()).forEach(x => p[x.type] = x.value);
  const di = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(p.weekday);
  const iso = `${p.year}-${p.month}-${p.day}`;
  return {iso, di, t: (+p.hour) + (+p.minute)/60, h:+p.hour, m:+p.minute, week: addDays(iso, -di)};
}
function addDays(iso, n){ const [y,m,d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m-1, d + n)); return dt.toISOString().slice(0,10); }
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const shortDate = iso => { const [y,m,d] = iso.split("-").map(Number); return MON[m-1] + " " + d; };
const weekLabel = w => shortDate(w) + " to " + shortDate(addDays(w, 6));
const clockNow = t => { const h = Math.floor(t), m = Math.round((t - h) * 60); return (((h+11)%12)+1) + ":" + String(m).padStart(2,"0") + (h < 12 ? " AM" : " PM"); };
S.week = storeNow(S.store).week;

/* ---------- shared store (db capability) with a local fallback ---------- */
let DB = null, USER = null, MYID = "", canWrite = true, LIVE = false;
const SAVED = {}, DRAFTS = {}, META = {}, TEAMS = {}, NAMES = {};
const pending = {}, writing = {};
const rk = (st, w) => st + "|" + w;
const slug = st => st.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const docPath = (st, w) => "rosters/" + slug(st) + "__" + w;
const clone = o => JSON.parse(JSON.stringify(o));

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = h => { const x = ((h+11)%12)+1; return x + (h<12 ? " AM" : " PM"); };
const clock = t => { const h = Math.floor(t), mm = Math.round((t - h) * 60); return (((h+11)%12)+1) + (mm ? ":" + String(mm).padStart(2,"0") : ""); };
const clockAP = t => clock(t) + (t < 12 ? " AM" : " PM");

/* LA/MS stores run their current hours until the switch date, then the new hours. */
let CTXW = null;
const FUTURE = "2030-01-07";
function withWeek(w, fn){ const o = CTXW; CTXW = w; try { return fn(); } finally { CTXW = o; } }
const _days = {};
function daysOf(store, week){
  const w = week || CTXW || S.week, D = DATA[store];
  const k = store + "|" + w;
  return _days[k] || (_days[k] = D.days.map((d,di) => { const iso = addDays(w, di); const base = D.cur && iso < D.switchOn ? Object.assign({cur:true}, D.cur[di]) : d; return special(base, iso, store); }));
}
function resetDays(){ Object.keys(_days).forEach(k => delete _days[k]); _recCache = {}; Object.keys(DRAFTS).forEach(k => delete DRAFTS[k]); }
/* Company calendar. Fixed closures every year; tentpole extended hours are set by the owner in settings/calendar. */
let CAL = {events:[]}, CAL_META = null;
function easter(y){ const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1; return `${y}-${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}`; }
function thanksgiving(y){ const dow = new Date(Date.UTC(y,10,1)).getUTCDay(); const first = 1 + ((4 - dow + 7) % 7); return `${y}-11-${String(first+21).padStart(2,"0")}`; }
function closedOn(iso){
  const y = +iso.slice(0,4);
  if (iso === thanksgiving(y)) return "Thanksgiving";
  if (iso.slice(5) === "12-24") return "Christmas Eve";
  if (iso.slice(5) === "12-25") return "Christmas Day";
  if (iso === easter(y)) return "Easter";
  return null;
}
/* A tentpole can set fixed hours, open earlier / close later than each store's normal hours, and store exceptions. */
const tpActive = e => e && (e.open != null || e.close != null || +e.earlier > 0 || +e.later > 0 || (e.stores && Object.keys(e.stores).length));
/* Recurring tentpoles, every year: Presidents Day, Memorial Day and Labor Day weekends (Sat to Mon) and Black Friday (Fri to Mon).
   Pattern: open 1 hour early Fri/Sat/Mon, Sunday 11 to 7 (Harahan 11 to 8). An explicit calendar entry on a date replaces the default. */
const nthMonday = (y, m, n) => { const dow = new Date(Date.UTC(y, m-1, 1)).getUTCDay(); const d = 1 + ((1 - dow + 7) % 7) + 7*(n-1); return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; };
const lastMonday = (y, m) => { const last = new Date(Date.UTC(y, m, 0)); const d = last.getUTCDate() - ((last.getUTCDay() + 6) % 7); return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; };
const SUN_TP = {open:11, close:19, stores:{"Harahan":{open:11, close:20}}};
const _rec = {};
function recurringTentpoles(y){
  if (_rec[y]) return _rec[y];
  const out = [], wk = (mon, name) => { out.push({date:addDays(mon,-2), name:name + " Saturday", earlier:1, lift:1, stores:{}, auto:true}, {date:addDays(mon,-1), name:name + " Sunday", ...clone(SUN_TP), lift:1, auto:true}, {date:mon, name:name, earlier:1, lift:1, stores:{}, auto:true}); };
  wk(nthMonday(y, 2, 3), "Presidents Day"); wk(lastMonday(y, 5), "Memorial Day"); wk(nthMonday(y, 9, 1), "Labor Day");
  const bf = addDays(thanksgiving(y), 1);
  out.push({date:bf, name:"Black Friday", earlier:1, lift:1, stores:{}, auto:true}, {date:addDays(bf,1), name:"Black Friday Saturday", earlier:1, lift:1, stores:{}, auto:true},
    {date:addDays(bf,2), name:"Black Friday Sunday", ...clone(SUN_TP), lift:1, auto:true}, {date:addDays(bf,3), name:"Black Friday Monday", earlier:1, lift:1, stores:{}, auto:true});
  return (_rec[y] = out);
}
const explicitOn = iso => (CAL.events || []).find(e => e.date === iso);
const tentpoleOn = iso => { const x = explicitOn(iso); if (x) return tpActive(x) ? x : null; return recurringTentpoles(+iso.slice(0,4)).find(e => e.date === iso) || null; };
function tpHours(e, base, store){
  const x = (e.stores && e.stores[store]) || {};
  const o = x.open != null ? +x.open : e.open != null ? +e.open : base.open - (+e.earlier || 0);
  const c = x.close != null ? +x.close : e.close != null ? +e.close : base.close + (+e.later || 0);
  return {o, c};
}
const tentpoleNamed = iso => explicitOn(iso) || recurringTentpoles(+iso.slice(0,4)).find(e => e.date === iso);
function special(base, iso, store){
  const cl = closedOn(iso);
  if (cl) return {open:0, close:0, g:{}, closed:true, name:cl, base, iso};
  const tp = tentpoleOn(iso);
  const hh = tp && tpHours(tp, base, store);
  if (tp && hh.c > hh.o){
    const lift = +tp.lift > 0 ? +tp.lift : 1, g = {};
    const bo = base.open || hh.o, bc = base.close || hh.c;
    for (let h=hh.o; h<hh.c; h++){ const src = h < bo ? bo : h >= bc ? bc - 1 : h; const v = base.g && base.g[src]; g[h] = (v == null ? 0 : v) * lift; }
    return {open:hh.o, close:hh.c, g, special:true, name:tp.name || "Tentpole", lift, base, iso, cur:base.cur};
  }
  return base;
}
const onCurrent = (store, week) => daysOf(store, week).some(d => d.cur);
const openDays = store => daysOf(store).filter(d => !d.closed);
function dayInfo(store, di){ return daysOf(store)[di]; }
/* Actual traffic uploads (actuals/<store>__<week>). While ACTX is set, guests() returns what really walked in. */
const ACTUALS = {}; let ACTX = null;
function withActual(store, week, fn){ const a = ACTUALS[rk(store, week)]; if (!a) return null; const o = ACTX; ACTX = {store, week, g:a.g}; try { return withWeek(week, fn); } finally { ACTX = o; } }
function guests(store, di, h){
  const d = dayInfo(store, di);
  if (h < d.open || h >= d.close) return undefined;
  if (ACTX && ACTX.store === store){ const v = ACTX.g[di] && ACTX.g[di][h]; return v == null ? 0 : v; }
  if (di === 6 && h === 11 && DATA[store].newSun && !d.cur) return null;
  const v = d.g[h]; return v == null ? 0 : v;
}
/* Hot zones staff at the hot-zone ratio; every other open hour uses the lighter-hours ratio. */
const need = (g, store, di, h) => { if (g == null) return S.minc; const r = store != null && tier(store, di, h) !== "hot" ? S.gpcLight : S.gpc; return Math.max(S.minc, Math.ceil(g / r - 1e-9)); };
const _peak = new WeakMap();
function peak(store, di){ const d = dayInfo(store, di); if (!ACTX && _peak.has(d)) return _peak.get(d); let p = 0; for (let h=d.open; h<d.close; h++){ const g = guests(store,di,h); if (g != null && g > p) p = g; } if (!ACTX) _peak.set(d, p || 1); return p || 1; }
function tier(store, di, h){ const g = guests(store,di,h); if (g === undefined) return "closed"; if (g === null) return "new"; const p = peak(store,di); return g >= .75*p ? "hot" : g >= .5*p ? "warm" : "base"; }

/* Standard shift menu. in/out are clock times; floor time starts 30 minutes after arrival (huddle). */
function tpls(store, di){
  const d0 = dayInfo(store, di);
  if (d0.closed) return [];
  if (d0.special){
    /* Tentpole shifts: arrive 15 minutes before open for the huddle.
       Sunday: one all-day shift. Other days: Opener 8:45 to 7 (15 min before open), plus a Closer from 10:45 to close when the store closes after 7. */
    const o = d0.open, c = d0.close;
    if (di === 6) return [{k:"O", name:"All day", in:o-0.25, out:c, hud:0.25}];
    const T = [{k:"O", name:"Opener", in:o-0.25, out:Math.min(19, c), hud:0.25}];
    if (c > 19) T.push({k:"C", name:"Closer", in:o+1.75, out:c, hud:0.25});
    return T;
  }
  const c = d0.close;
  if (di === 6){
    const o = dayInfo(store, di).open;
    if (c <= 19) return [{k:"S", name:"Sunday", in:o-0.5, out:c}];
    return [{k:"S", name:"Sun Open", in:o-0.5, out:19}, {k:"S2", name:"Sun Close", in:c-8.5, out:c}];
  }
  const O = {k:"O", name:"Opener", in:9.5, out:18};
  if (c <= 19) return [O, {k:"C", name:"Closer", in:10.5, out:19}, {k:"F", name:"Full day", in:9.5, out:19, manual:true}];
  if (c === 20) return [O, {k:"C", name:"Closer", in:11.5, out:20}];
  return [O, {k:"M", name:"Mid", in:11.5, out:20}, {k:"C", name:"Closer", in:12.5, out:21}];
}
const PT_T = {k:"P", name:"Part-time", in:11.5, out:16.5};   // 5 paid hours, covers the midday peak
/* Custom shift: a template adjusted by the leader, stored as "X:<in>-<out>" (clock hours, quarter steps). */
const isX = k => typeof k === "string" && k.startsWith("X:");
const mkX = (a, b) => "X:" + (Math.round(a*4)/4) + "-" + (Math.round(b*4)/4);
function xShift(store, di, k){ const d = dayInfo(store, di); if (d.closed) return undefined; const m = /^X:([\d.]+)-([\d.]+)$/.exec(k); if (!m) return undefined;
  const a = +m[1], b = +m[2]; if (!(b > a)) return undefined; return {k, name:"Custom", in:a, out:b, hud: d.special ? 0.25 : 0.5, custom:true}; }
const tplOf = (store, di, k) => k === "P" ? (dayInfo(store, di).closed ? undefined : PT_T) : isX(k) ? xShift(store, di, k) : tpls(store, di).find(t => t.k === k);
/* Shifts the planner hands out on its own. Manual ones (like the 9:30 to 7 full day) are there for leaders to pick. */
const autoT = (store, di) => tpls(store, di).filter(t => !t.manual);
/* When a shift is copied into a week whose hours differ, move it to the closest shift that exists that day. */
function remapShift(store, fromWeek, toWeek, di, k){
  if (!k || k === "PTO") return {k, note:null};
  const to = withWeek(toWeek, () => dayInfo(store, di));
  if (to.closed) return {k:"", note:`${DAYS[di]}: store closed for ${to.name}, shift removed`};
  if (isX(k)) return {k, note:null};
  const src = withWeek(fromWeek, () => tplOf(store, di, k));
  const T = withWeek(toWeek, () => k === "P" ? [PT_T] : tpls(store, di));
  const same = T.find(t => t.k === k);
  if (src && same && same.in === src.in && same.out === src.out) return {k, note:null};
  if (!src) return same ? {k, note:null} : {k:"", note:`${DAYS[di]}: shift didn't exist, left Off`};
  let best = null; T.forEach(t => { const dd = Math.abs(t.in - src.in) + Math.abs(t.out - src.out); if (!best || dd < best.dd) best = {dd, t}; });
  if (!best) return {k:"", note:`${DAYS[di]}: no shift fits, left Off`};
  return {k:best.t.k, note:`${DAYS[di]}: ${clock(src.in)}-${clock(src.out)} became ${clock(best.t.in)}-${clock(best.t.out)}`};
}
const COPY_NOTES = {};
const paid = t => { const len = t.out - t.in; return len - (len >= 6 ? S.lunch : 0); };
const HUD = t => t.hud != null ? t.hud : 0.5;   // huddle before floor time (15 minutes on tentpole shifts)
const onFloor = (t, h) => h >= t.in + HUD(t) - 1e-9 && h < t.out;
/* Lunch: a 30-minute block (or whatever the lunch setting is) that takes that person off the floor. */
const hasLunch = t => t && S.lunch > 0 && (t.out - t.in) >= 6;
function lunchOpts(t){ const a = []; for (let x = t.in + 2; x + S.lunch <= t.out - 2 + 1e-9; x += 0.5) a.push(x); return a; }
function floorShare(t, lunch, h){
  if (!onFloor(t, h)) return 0;
  if (!hasLunch(t) || lunch == null) return 1;
  const ov = Math.max(0, Math.min(h + 1, lunch + S.lunch) - Math.max(h, lunch));
  return 1 - ov;
}
const atLunch = (t, lunch, now) => hasLunch(t) && lunch != null && now >= lunch && now < lunch + S.lunch;
/* Give every shift that has a lunch a lunch time, staggered into the lightest hours. Keeps times leaders picked. */
function fillLunches(store, people){
  for (let di=0; di<7; di++){
    const d = dayInfo(store, di);
    people.forEach(p => { if (!Array.isArray(p.lunch)) p.lunch = Array(7).fill(null); const t = p.days[di] && p.days[di] !== "PTO" && tplOf(store, di, p.days[di]);
      if (!hasLunch(t)) p.lunch[di] = null; else if (p.lunch[di] != null && !lunchOpts(t).some(x => Math.abs(x - p.lunch[di]) < 1e-9)) p.lunch[di] = null; });
    const todo = people.filter(p => { const t = p.days[di] && p.days[di] !== "PTO" && tplOf(store, di, p.days[di]); return hasLunch(t) && p.lunch[di] == null; })
      .sort((a,b) => tplOf(store,di,a.days[di]).in - tplOf(store,di,b.days[di]).in);
    todo.forEach(p => {
      const t = tplOf(store, di, p.days[di]); let best = null;
      lunchOpts(t).forEach(x => {
        let sc = 0;
        for (let h = Math.floor(x); h < x + S.lunch; h++){
          if (h < d.open || h >= d.close) continue;
          let c = 0; people.forEach(q => { const tq = q.days[di] && q.days[di] !== "PTO" && tplOf(store, di, q.days[di]); if (tq && isCounted(q)) c += floorShare(tq, q === p ? null : q.lunch[di], h); });
          sc += (c - need(guests(store, di, h), store, di, h)) * 10 - (guests(store, di, h) || 0);
        }
        sc -= Math.abs(x - (t.in + t.out) / 2) * 0.01;
        if (!best || sc > best.sc) best = {sc, x};
      });
      p.lunch[di] = best ? best.x : null;
    });
  }
  return people;
}

function roster(store, week){
  week = week || S.week; const k = rk(store, week);
  if (SAVED[k]) return SAVED[k];
  if (!DRAFTS[k]) DRAFTS[k] = {example:true, posted:false, saved:false, people:withWeek(week, () => suggest(store, week))};
  return DRAFTS[k];
}
/* Every edit saves. A week stays a draft until a leader posts it; a posted week stays posted. */
function commit(store, week, r, post){
  const k = rk(store, week);
  if (post){ r.posted = true; if (!r.postedAt) r.postedAt = new Date().toISOString(); }
  r.example = false; r.saved = true; SAVED[k] = r; delete DRAFTS[k];
  r.people.forEach(p => { if (p.nh && !p.nhStart) p.nhStart = week; });
  META[k] = {updatedAt:new Date().toISOString(), updatedBy:MYID};
  clearTimeout(pending[k]); pending[k] = setTimeout(() => flush(k), 700);
}
async function flush(k){
  delete pending[k];
  const [st, w] = k.split("|"), r = SAVED[k];
  const body = {store:st, week:w, posted:!!r.posted, postedAt:r.postedAt || null, people:clone(r.people), updatedAt:new Date().toISOString(), updatedBy:MYID || ""};
  if (!DB){ try { localStorage.setItem("ss-roster:" + k, JSON.stringify(body)); } catch(e) {} return; }
  if (writing[k]){ pending[k] = setTimeout(() => flush(k), 700); return; }
  writing[k] = true;
  try { await DB.doc(docPath(st, w)).set(body); }
  catch(e){
    if (e && e.code === "invalid_argument"){ canWrite = false; toast("View only: you can see schedules but not change them"); renderAll(); }
    else toast("Couldn't save that change. Check your connection and try again.");
  }
  writing[k] = false;
}
/* The most recent saved week before this one, for carrying names forward. */
function lastWeekOf(store, week){
  let best = null;
  Object.keys(SAVED).forEach(k => { const [st, w] = k.split("|"); if (st === store && w < week && SAVED[k].people.length && (!best || w > best)) best = w; });
  return best;
}
function setTier(st, name, v){
  const m = PERF[st] || (PERF[st] = {});
  if (v) m[name] = v; else delete m[name];
  if (!DB){ try { localStorage.setItem("ss-perf:" + st, JSON.stringify(m)); } catch(e) {} return; }
  DB.doc("perf/" + slug(st)).set({store:st, tiers:clone(m), updatedAt:new Date().toISOString(), updatedBy:MYID || ""}).catch(e => { if (e && e.code === "invalid_argument"){ toast("Only leaders can rate performance"); } });
}
async function saveTeam(st){
  if (!DB){ try { localStorage.setItem("ss-team:" + st, JSON.stringify(TEAMS[st] || {})); } catch(e) {} return; }
  try { await DB.doc("teams/" + slug(st)).set(clone(TEAMS[st] || {})); } catch(e){ if (e && e.code === "invalid_argument"){ canWrite = false; renderAll(); } }
}
let unsubs = [];
function loadDoc(k, d){
  if (pending[k] || writing[k]) return;
  const w = k.split("|")[1];
  SAVED[k] = {posted: d.posted !== false, postedAt: d.postedAt || null, example:false, saved:true, people:withWeek(w, () => fillLunches(k.split("|")[0], clone(d.people || [])))};
  delete DRAFTS[k];
  META[k] = {updatedAt:d.updatedAt, updatedBy:d.updatedBy};
}
function subscribe(){
  unsubs.forEach(u => { try { u(); } catch(e) {} }); unsubs = [];
  const st = S.store;
  if (!DB){
    try { for (let i=0; i<localStorage.length; i++){ const key = localStorage.key(i); if (key && key.startsWith("ss-roster:" + st + "|")){ const k = key.slice(10); if (!SAVED[k]) loadDoc(k, JSON.parse(localStorage.getItem(key))); } } } catch(e) {}
    try { const raw = localStorage.getItem("ss-team:" + st); if (raw && !TEAMS[st]) TEAMS[st] = JSON.parse(raw); } catch(e) {}
    return;
  }
  /* One live query brings every saved week for this store: posted weeks, drafts, and the week dropdown status. */
  unsubs.push(DB.collection("rosters").where("store", "==", st).onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      const d = ch.doc.data() || {}, k = rk(st, d.week || ch.doc.id.split("__")[1]);
      if (ch.type === "removed"){ if (!pending[k] && !writing[k]){ delete SAVED[k]; delete META[k]; } return; }
      if (ch.doc.metadata && ch.doc.metadata.hasPendingWrites) return;
      loadDoc(k, d);
    });
    renderAll();
  }, () => {}));
  unsubs.push(DB.doc("teams/" + slug(st)).onSnapshot(snap => {
    if (snap.exists){ const nd = clone(snap.data()); if (JSON.stringify(nd) !== JSON.stringify(TEAMS[st] || {})){ TEAMS[st] = nd; Object.keys(DRAFTS).forEach(k => { if (k.startsWith(st + "|")) delete DRAFTS[k]; }); } }
    renderAll(); }, () => {}));
}
async function nameOf(id){
  if (!id) return "";
  if (NAMES[id] != null) return NAMES[id];
  NAMES[id] = "";
  try { if (USER && USER.profiles){ const ps = await USER.profiles([id]); NAMES[id] = (ps && ps[id] && ps[id].name) || ""; if (NAMES[id]) renderStatus(); } } catch(e) {}
  return NAMES[id];
}
function workedOf(store, p){ let s = 0; p.days.forEach((k,di) => { if (k && k !== "PTO"){ const t = tplOf(store, di, k); if (t) s += paid(t); } }); return s; }
const ptoOf = p => p.days.filter(k => k === "PTO").length * S.pto;
const hoursOf = (store, p) => workedOf(store, p) + ptoOf(p);
const targetOf = p => p.role === "PT" ? S.ptTarget : S.target;
/* Approved overtime: the extra paid hours from tentpole shifts (anything past 8 paid on a tentpole day) are allowed. */
function tentpoleExtra(store, p){ let x = 0; p.days.forEach((k, di) => { const d = dayInfo(store, di); if (!d.special || !k || k === "PTO") return; const t = tplOf(store, di, k); if (t) x += Math.max(0, paid(t) - 8); }); return x; }
const approvedOT = (store, p) => { if (p.role === "PT" || !hourly(p.role)) return 0; const h = hoursOf(store, p), ex = tentpoleExtra(store, p); return h > S.target && ex > 0 && h <= S.target + ex + 1e-9 ? h - S.target : 0; };
const statusOf = (store, p) => approvedOT(store, p) ? "ok" : hrsStatus(hoursOf(store, p), p.role);
function hrsLabel(store, p){ const tot = hoursOf(store,p), wk = workedOf(store,p), s = statusOf(store, p), tg = targetOf(p);
  if (p.role === "PT") return {over:"over part-time", ok:"part-time", near:"part-time", under:"under part-time"}[s];
  const ot = approvedOT(store, p); if (ot) return `${Math.round(ot*100)/100} approved OT`;
  if (s === "over") return wk > tg ? "overtime" : "over " + tg;
  return {ok:"on target", near:"near " + tg, under:"under"}[s]; }

/* Fewest shifts per day that meet the need every open hour, least overage as tiebreak. */
function bestCounts(store, di, needFn){
  const T = autoT(store, di), d = dayInfo(store, di), hrs = [];
  for (let h=d.open; h<d.close; h++) hrs.push(h);
  const mx = Math.max(...hrs.map(needFn)) + 1;
  let best = null;
  const rec = (i, xs) => {
    if (i === T.length){
      let ok = true, over = 0; const tot = xs.reduce((a,b)=>a+b,0);
      for (const h of hrs){ const c = T.reduce((a,t,j) => a + (onFloor(t,h) ? xs[j] : 0), 0); const n = needFn(h); if (c < n){ ok = false; break; } over += c - n; }
      if (ok && (!best || tot < best.tot || (tot === best.tot && over < best.over))) best = {tot, over, xs:xs.slice()};
      return;
    }
    for (let x=0; x<=mx; x++){ xs.push(x); rec(i+1, xs); xs.pop(); }
  };
  rec(0, []);
  return best ? best.xs : T.map(() => mx);
}
/* Recommended headcount: fewest shifts that meet the need, then enough people for 5 shifts each. */
function autoSlots(store, needFn, weightFn, noWeekend){
  const slots = [];
  for (let di=0; di<7; di++){ const T = autoT(store, di), xs = bestCounts(store, di, needFn(di)); const arr = []; T.forEach((t,j) => { for (let x=0; x<xs[j]; x++) arr.push(t.k); }); slots.push(arr); }
  const total = slots.reduce((a,s) => a + s.length, 0);
  /* Everyone works Saturday and Sunday, so the weekday need has to fit in the other workdays. */
  const WE = noWeekend ? [] : [5,6].filter(di => !dayInfo(store, di).closed);
  const wkday = slots.reduce((a,s,di) => a + (WE.includes(di) ? 0 : s.length), 0);
  const N = Math.max(Math.ceil(total / 5), ...slots.map(s => s.length), WE.length ? Math.ceil(wkday / (5 - WE.length)) : 0);
  WE.forEach(di => fillDay(store, di, slots, N, weightFn));
  let extra = 5*N - slots.reduce((a,s) => a + s.length, 0);
  while (extra-- > 0){
    let best = null;
    for (let di=0; di<7; di++){
      if (slots[di].length >= N) continue;
      autoT(store, di).forEach(t => {
        let sc = 0; const d = dayInfo(store, di);
        for (let h=d.open; h<d.close; h++){ if (!onFloor(t,h)) continue; const cov = slots[di].filter(k => onFloor(tplOf(store,di,k), h)).length; sc += weightFn(di,h) / (cov + 1); }
        if (!best || sc > best.sc) best = {sc, di, k:t.k};
      });
    }
    if (!best) break;
    slots[best.di].push(best.k);
  }
  return {N, slots};
}
/* Top a day up to n shifts, each one where it adds the most coverage for the traffic. */
function fillDay(store, di, slots, n, weightFn, needFn){
  const d = dayInfo(store, di), nf = needFn ? needFn(di) : () => 0;
  while (slots[di].length < n){ let best = null;
    autoT(store, di).forEach(t => { let sc = 0;
      for (let h=d.open; h<d.close; h++){ if (!onFloor(t,h)) continue; const cov = slots[di].filter(k => onFloor(tplOf(store,di,k), h)).length, w = weightFn(di,h); sc += cov < nf(h) ? 100 + 10*w : w / (cov + 1); }
      if (!best || sc > best.sc) best = {sc, k:t.k}; });
    if (!best) break; slots[di].push(best.k); }
}
/* Fixed headcount: hand out 5 shifts per person, filling the busiest short hours first. Weekends first: everyone works them. */
function fixedSlots(store, N, needFn, weightFn, noWeekend){
  const slots = [[],[],[],[],[],[],[]];
  if (!noWeekend) [5,6].filter(di => !dayInfo(store, di).closed).forEach(di => fillDay(store, di, slots, N, weightFn, needFn));
  for (let n=slots.reduce((a,s) => a + s.length, 0); n<5*N; n++){
    let best = null;
    for (let di=0; di<7; di++){
      if (slots[di].length >= N) continue;
      const d = dayInfo(store, di), nf = needFn(di);
      autoT(store, di).forEach(t => {
        let sc = 0;
        for (let h=d.open; h<d.close; h++){
          if (!onFloor(t,h)) continue;
          const cov = slots[di].filter(k => onFloor(tplOf(store,di,k), h)).length, w = weightFn(di,h);
          sc += cov < nf(h) ? 100 + 10*w : w / (cov + 1);
        }
        if (!best || sc > best.sc) best = {sc, di, k:t.k};
      });
    }
    if (!best) break;
    slots[best.di].push(best.k);
  }
  return {N, slots};
}
function assignSlots(store, plan, roles, names, presets, cap){
  cap = cap || 5;
  const {N} = plan, slots = plan.slots.map(a => a.slice());
  const people = Array.from({length:N}, (_,i) => ({name:names[i], role:roles[i], days:(presets && presets[i]) ? presets[i].slice() : Array(7).fill(""), pref:{}}));
  /* Weekends are mandatory: make sure Saturday and Sunday have a shift for every sales person who isn't on PTO. */
  const WE = [5,6].filter(di => !dayInfo(store, di).closed);
  const used = [...new Set(plan.slots.flat())];
  WE.forEach(di => {
    const want = people.filter(p => wkndReq(p.role) && !p.days[di]).length;
    const keys = used.filter(k => tplOf(store, di, k)); if (!keys.length) autoT(store, di).forEach(t => keys.push(t.k));
    while (slots[di].length < want && keys.length){ const k = keys.slice().sort((a,b) => slots[di].filter(x => x===a).length - slots[di].filter(x => x===b).length)[0]; slots[di].push(k); }
  });
  const order = [0,1,2,3,4,5,6].sort((a,b) => (WE.includes(b) - WE.includes(a)) || (slots[b].length - slots[a].length));
  order.forEach(di => {
    slots[di].slice().sort().forEach(k => {
      const cand = people.filter(p => !p.days[di] && p.days.filter(Boolean).length < cap)
        .sort((a,b) => (WE.includes(di) ? (wkndReq(b.role) - wkndReq(a.role)) : 0) || (a.days.filter(Boolean).length - b.days.filter(Boolean).length) || ((b.pref[k]||0) - (a.pref[k]||0)));
      if (!cand.length){
        /* Nobody free that day: hand one of B's other shifts to someone with room (A), so B can take this one. Coverage stays the same. */
        const cnt = p => p.days.filter(Boolean).length;
        for (const A of people.filter(p => cnt(p) < cap)){
          for (let d2=0; d2<7; d2++){ if (A.days[d2]) continue;
            const B = people.find(q => q !== A && q.days[d2] && q.days[d2] !== "PTO" && !q.days[di] && !(WE.includes(d2) && wkndReq(q.role)));
            if (B){ A.days[d2] = B.days[d2]; B.days[d2] = ""; B.days[di] = k; return; } }
        }
        return;
      }
      const p = cand[0]; p.days[di] = k; p.pref[k] = (p.pref[k]||0) + 1;
    });
  });
  people.forEach(p => delete p.pref);
  return people;
}
/* Leaders: fixed days off. GMs are off Wednesday and Thursday. Other leaders take Mon/Tue, Tue/Wed or Thu/Fri,
   whichever keeps a leader in the store most. Everyone works the weekend. Then each day's leaders get the shifts that
   keep someone in the building every open hour (a lone leader at a 7 PM store works 9:30 to 7). */
const LEAD_OFF = [[0,1],[1,2],[3,4]];
function coverSet(store, di, n){
  const d = dayInfo(store, di), hrs = []; for (let h=d.open; h<d.close; h++) hrs.push(h);
  const T = autoT(store, di), F = tpls(store, di).find(t => t.manual);
  if (n === 1 && F) return [F.k];
  let best = null;
  const pick = (i, cur) => { if (cur.length === n || i === T.length){ if (!cur.length) return; const hit = hrs.filter(h => cur.some(t => inStore(t, h))).length;
      if (!best || hit > best.hit || (hit === best.hit && cur.length < best.set.length)) best = {hit, set:cur.slice()}; return; }
    pick(i+1, cur.concat([T[i]])); pick(i+1, cur); };
  pick(0, []);
  return best ? best.set.map(t => t.k) : [];
}
function leaderPlan(store, roles, names, presets, w){
  const people = roles.map((r,i) => ({name:names[i], role:r, days:(presets && presets[i]) ? presets[i].slice() : Array(7).fill("")}));
  const open = [0,1,2,3,4,5,6].map(di => !dayInfo(store, di).closed);
  const need = [0,1,2,3,4,5,6].map(di => { if (!open[di]) return 0; const d = dayInfo(store, di), hrs = []; for (let h=d.open; h<d.close; h++) hrs.push(h);
    const one = coverSet(store, di, 1).map(k => tplOf(store, di, k)); return hrs.every(h => one.some(t => inStore(t, h))) ? 1 : 2; });
  const offOf = people.map(() => null), here = [0,1,2,3,4,5,6].map(() => 0);
  people.forEach((p,i) => { if (p.role === "GM") offOf[i] = [2,3]; });
  const count = () => { here.fill(0); people.forEach((p,i) => { for (let di=0; di<7; di++) if (open[di] && p.days[di] !== "PTO" && offOf[i] && !offOf[i].includes(di)) here[di]++; }); };
  /* Try every combination of day-off pairs (small teams) and keep the one with the fewest short leader days, then the most even spread. */
  const free = people.map((p,i) => i).filter(i => !offOf[i]);
  const score = () => { count(); let sc = 0; for (let di=0; di<5; di++) if (open[di]) sc += 1000 * Math.max(0, need[di] - here[di]) + here[di] * here[di]; return sc; };
  if (free.length && free.length <= 7){
    let best = null; const combo = Array(free.length).fill(0);
    for (let n=0; n < Math.pow(3, free.length); n++){ let x = n; free.forEach((i,j) => { combo[j] = x % 3; x = Math.floor(x / 3); offOf[i] = LEAD_OFF[combo[j]]; });
      const sc = score(); if (!best || sc < best.sc) best = {sc, c:combo.slice()}; }
    free.forEach((i,j) => offOf[i] = LEAD_OFF[best.c[j]]);
  } else free.forEach(i => { let best = null; LEAD_OFF.forEach(o => { offOf[i] = o; const sc = score(); if (!best || sc < best.sc) best = {sc, o}; }); offOf[i] = best.o; });
  for (let di=0; di<7; di++){ if (!open[di]) continue;
    const P = people.filter((p,i) => p.days[di] !== "PTO" && !offOf[i].includes(di));
    if (!P.length) continue;
    const keys = coverSet(store, di, Math.min(P.length, autoT(store, di).length));
    while (keys.length < P.length){ const d = dayInfo(store, di); let bk = null;
      autoT(store, di).forEach(t => { let sc = 0; for (let h=d.open; h<d.close; h++) if (onFloor(t,h)) sc += w(di,h) / (1 + keys.filter(k => onFloor(tplOf(store,di,k), h)).length); if (!bk || sc > bk.sc) bk = {sc, k:t.k}; });
      keys.push(bk.k); }
    P.forEach((p,x) => p.days[di] = keys[x]);
  }
  return people;
}
const TEAM_FIELDS = [["C","Full-time consultants"],["pt","Part-time (each counts ½)"],["GM","General Managers"],["L","Asst General Managers"],["LSL","Lead Selling Leaders"],["ASL","Asst Selling Leaders"],["KH","Key Holders"],["CSR","CSRs (not counted in coverage)"]];
function teamOf(store){ return TEAMS[store] || (TEAMS[store] = {}); }
const blank = v => v === "" || v == null || isNaN(v);
function recommended(store){ return withWeek(FUTURE, () => recommended0(store)); }
function recommended0(store){
  const w = (di,h) => (guests(store,di,h) || 0);
  const tm = TEAMS[store] || {};
  const slotted = ["goalGM","goalL","goalLSL","goalASL"].some(k => tm[k] != null && tm[k] !== "");
  let lroles, leads;
  if (slotted){
    // Leadership slots come from the staffing report (Goal column): that's what the store is slotted for.
    lroles = []; [["GM","goalGM"],["L","goalL"],["LSL","goalLSL"],["ASL","goalASL"],["KH","goalKH"]].forEach(([r,k]) => { for (let i=0; i<(+tm[k]||0); i++) lroles.push(r); });
    leads = lroles.length ? leaderPlan(store, lroles, lroles.map(r => ROLES[r]), null, w) : [];
  } else {
    const lp = autoSlots(store, di => h => 1, w, true);
    let wkG = 0; for (let di=0; di<7; di++){ const d = dayInfo(store,di); for (let h=d.open; h<d.close; h++) wkG += guests(store,di,h) || 0; }
    const order = wkG >= 230 ? ["L","ASL","LSL","KH"] : ["ASL","LSL","KH","KH"]; // AGM only where traffic supports it
    lroles = Array.from({length:lp.N}, (_,i) => order[Math.min(i,3)]);
    leads = leaderPlan(store, lroles, lroles.map(r => ROLES[r]), null, w);
  }
  const sellCov = (di,h) => leads.filter(p => isCounted(p) && p.days[di] && onFloor(tplOf(store,di,p.days[di]), h)).length;
  const cp = autoSlots(store, di => h => Math.max(0, need(guests(store,di,h), store, di, h) - sellCov(di,h)), w);
  const counts = {C:cp.N, pt:0, nh:0, GM:0, L:0, LSL:0, ASL:0, KH:0, CSR:0}; lroles.forEach(r => counts[r]++);
  return {counts, leads, cp, slotted};
}
function suggest(store, week, raw){
  const team = teamOf(store), rec = recFor(store), w = (di,h) => (guests(store,di,h) || 0);
  const k0 = rk(store, week || S.week);
  const cur = ((SAVED[k0] || DRAFTS[k0] || {}).people) || [];
  /* Names carry forward: this week's names first, then the last saved week's team. */
  const lw = lastWeekOf(store, week || S.week), last = lw ? SAVED[rk(store, lw)].people : [];
  const sameRole = (list, role, nh) => list.filter(p => p.role === role && nhActive(p, week || S.week) === !!nh);
  const nameFor = (role, i, fallback, nh) => { const a = sameRole(cur, role, nh), b = sameRole(last, role, nh); return a[i] ? a[i].name : b[i] ? b[i].name : fallback; };
  const ptoFor = (role, i, nh) => { const same = sameRole(cur, role, nh); return same[i] ? same[i].days.map(k => k === "PTO" ? "PTO" : "") : null; };
  const leadGiven = ["GM","L","LSL","ASL","KH"].some(k => !blank(team[k]));
  const roles = []; ["GM","L","LSL","ASL","KH"].forEach(k => { const n = leadGiven ? (blank(team[k]) ? rec.counts[k] : (+team[k]||0)) : rec.counts[k]; for (let x=0; x<n; x++) roles.push(k); });
  const rc = {}; const lidx = roles.map(r => (rc[r] = (rc[r]||0) + 1) - 1);
  const leads = roles.length ? leaderPlan(store, roles,
    roles.map((r,x) => nameFor(r, lidx[x], ROLES[r] + (lidx[x] > 0 ? " " + (lidx[x]+1) : ""))), roles.map((r,x) => ptoFor(r, lidx[x])), w) : [];
  const on = (list, di, h) => list.reduce((a,p) => a + (isCounted(p) && p.days[di] && p.days[di] !== "PTO" && onFloor(tplOf(store,di,p.days[di]), h) ? 1 : 0), 0);
  const nf = di => h => Math.max(0, need(guests(store,di,h), store, di, h) - on(leads, di, h));
  const cplan = blank(team.C) ? autoSlots(store, nf, w) : fixedSlots(store, +team.C, nf, w);
  const cons = assignSlots(store, cplan, Array(cplan.N).fill("C"), Array.from({length:cplan.N}, (_,x) => nameFor("C", x, "Consultant " + (x+1))), Array.from({length:cplan.N}, (_,x) => ptoFor("C", x)));
  /* Part-timers take Part-time peak shifts where the floor is still thinnest. */
  const ptN = blank(team.pt) ? 0 : Math.max(0, +team.pt);
  let pts = [];
  if (ptN){
    const per = Math.max(1, Math.round(S.ptTarget / paid(PT_T))), slots = [[],[],[],[],[],[],[]];
    for (let n=0; n<ptN*per; n++){
      let best = null;
      for (let di=0; di<7; di++){
        if (slots[di].length >= ptN) continue;
        const d = dayInfo(store, di); if (d.closed) continue; let sc = 0;
        for (let h=Math.max(d.open, 12); h<d.close; h++){ if (!onFloor(PT_T, h)) continue;
          const cov = on(leads, di, h) + on(cons, di, h) + slots[di].length, nd = need(guests(store,di,h), store, di, h), wt = w(di,h);
          sc += cov < nd ? 100 + 10*wt : wt / (cov + 1); }
        if (!best || sc > best.sc) best = {sc, di};
      }
      if (!best) break;
      slots[best.di].push("P");
    }
    pts = assignSlots(store, {N:ptN, slots}, Array(ptN).fill("PT"), Array.from({length:ptN}, (_,x) => nameFor("PT", x, "Part-timer " + (x+1))), Array.from({length:ptN}, (_,x) => ptoFor("PT", x)), per);
  }
  /* New hires in training: scheduled on the busiest shifts to learn, never counted toward coverage. */
  /* New hires come from the schedule itself: anyone still inside their training weeks carries into this week. */
  const wk = week || S.week, srcNH = (cur.some(p => p.nh) ? cur : last).filter(p => p.nh && nhActive(p, wk));
  const nhN = srcNH.length;
  let nhs = [];
  if (nhN){
    const plan = fixedSlots(store, nhN, di => h => 0, w);
    nhs = assignSlots(store, plan, srcNH.map(p => p.role), srcNH.map(p => p.name), srcNH.map(p => { const same = cur.find(q => q.nh && q.name === p.name); return same ? same.days.map(k => k === "PTO" ? "PTO" : "") : null; }));
    nhs.forEach((p, x) => { p.nh = true; p.nhStart = srcNH[x].nhStart || wk; });
  }
  /* CSRs: scheduled 5 days on the busiest days, never counted toward sales coverage, no weekend requirement. */
  const csrN = blank(team.CSR) ? 0 : Math.max(0, +team.CSR);
  const csrs = csrN ? assignSlots(store, fixedSlots(store, csrN, di => h => 0, w, true), Array(csrN).fill("CSR"), Array.from({length:csrN}, (_,x) => nameFor("CSR", x, "CSR " + (x+1))), Array.from({length:csrN}, (_,x) => ptoFor("CSR", x))) : [];
  const all = cons.concat(pts, nhs, leads, csrs);
  if (raw) return all;
  return fillLunches(store, optimizeWeek(store, all).people);
}
/* A leader is in the store for an hour only if they're in the building the whole hour (lunch still counts as in the store). */
const inStore = (t, h) => t.in <= h + 1e-9 && t.out >= h + 1 - 1e-9;
/* Fewest leader shifts that keep a leader in the store every open hour this week. */
function minLeaderShifts(store){
  let tot = 0;
  for (let di=0; di<7; di++){
    const d = dayInfo(store, di); if (d.closed) continue;
    const T = autoT(store, di), hrs = []; for (let h=d.open; h<d.close; h++) hrs.push(h);
    let best = T.length + 1;
    for (let m=1; m < (1 << T.length); m++){ const pick = T.filter((_,j) => m & (1<<j)); if (pick.length < best && hrs.every(h => pick.some(t => inStore(t, h)))) best = pick.length; }
    tot += best > T.length ? T.length : best;
  }
  return tot;
}
function leaderGaps(store, cov){
  const out = [];
  cov.forEach((rows, di) => { let cur = null; rows.forEach(x => { if (x.l === 0){ if (!cur) cur = {di, a:x.h, b:x.h+1}; else cur.b = x.h+1; } else if (cur){ out.push(cur); cur = null; } }); if (cur) out.push(cur); });
  return out;
}
/* Talent mix for each open hour: who's on the floor by tier, and the three checks leaders see. */
function mixDay(store, di, r){
  const d = dayInfo(store, di), rows = [];
  if (d.closed) return rows;
  for (let h=d.open; h<d.close; h++){
    const x = {h, H:0, M:0, L:0, U:0, nh:[], hot: tier(store, di, h) === "hot"};
    r.people.forEach(p => { const k = p.days[di]; if (!k || k === "PTO" || !sells(p.role)) return; const t = tplOf(store, di, k); if (!t || !onFloor(t, h)) return;
      const ph = nhPhase(p); if (ph) x.nh.push(p.name);
      if (ph === "training") return; const tr = tierOf(store, p); if (tr) x[tr]++; else x.U++; });
    x.noHigh = x.hot && x.H === 0;
    x.weak = x.L > 0 && x.L > x.H + x.M;
    x.nhAlone = x.nh.length > 0 && x.H + x.M === 0;
    rows.push(x);
  }
  return rows;
}
function mixCost(store, di, r){ return mixDay(store, di, r).reduce((a,x) => a + (x.noHigh ? 10 : 0) + (x.weak ? 4 : 0) + (x.nhAlone ? 8 : 0), 0); }
/* Work-life balance per person: days off together, and no closing one night then opening the next morning. */
function wlbCost(store, p){
  const off = p.days.map(k => !k || k === "PTO");
  let blocks = 0; for (let d=0; d<7; d++) if (off[d] && (d === 0 || !off[d-1])) blocks++;
  let c = off.filter(Boolean).length >= 2 ? 6 * Math.max(0, blocks - 1) : 0;
  for (let d=0; d<6; d++){ const t1 = !off[d] && tplOf(store, d, p.days[d]), t2 = !off[d+1] && tplOf(store, d+1, p.days[d+1]); if (t1 && t2 && t1.out >= 20 && t2.in <= 9.5) c += 3; }
  return c;
}
function wlbSummary(store, r){
  const ppl = r.people.filter(p => p.days.filter(k => k && k !== "PTO").length >= 3);
  const split = [], clopen = [];
  ppl.forEach(p => { const off = p.days.map(k => !k || k === "PTO"); let blocks = 0; for (let d=0; d<7; d++) if (off[d] && (d === 0 || !off[d-1])) blocks++;
    if (off.filter(Boolean).length >= 2 && blocks > 1) split.push(p.name);
    for (let d=0; d<6; d++){ const t1 = !off[d] && tplOf(store, d, p.days[d]), t2 = !off[d+1] && tplOf(store, d+1, p.days[d+1]); if (t1 && t2 && t1.out >= 20 && t2.in <= 9.5){ clopen.push(p.name + " " + DAYS[d] + "-" + DAYS[d+1]); } } });
  return {n:ppl.length, together:ppl.length - split.length, split, clopen};
}
/* Improve the week without touching coverage: trade shifts between people in the same group on the same day,
   or trade a day for a day when the paid hours match. Every hour's floor and leader counts stay exactly the same.
   Goals: talent mix (High in hot zones, new hires paired) and work-life balance (days off together, no close-then-open). */
function optimizeWeek(store, people){
  const r = {people};
  const grp = p => p.role === "C" ? "C" + (nhActive(p) ? "t" : "") : p.role === "PT" ? "PT" : p.role === "CSR" ? "CSR" : ["LSL","ASL","KH"].includes(p.role) ? "SL" : "NL";
  const pay = (di, k) => { const t = k && k !== "PTO" && tplOf(store, di, k); return t ? paid(t) : null; };
  const groups = {}; people.forEach(p => (groups[grp(p)] = groups[grp(p)] || []).push(p));
  const clearL = (p, ...ds) => { if (p.lunch) ds.forEach(d => p.lunch[d] = null); };
  let moved = 0;
  for (let pass=0; pass<8; pass++){
    let improved = false;
    Object.values(groups).forEach(mov => {
      for (let di=0; di<7; di++){
        for (let a=0; a<mov.length; a++) for (let b=a+1; b<mov.length; b++){
          const A = mov[a], B = mov[b], ka = A.days[di], kb = B.days[di];
          if (!ka || !kb || ka === "PTO" || kb === "PTO" || ka === kb || pay(di,ka) !== pay(di,kb)) continue;
          const before = mixCost(store, di, r) + wlbCost(store, A) + wlbCost(store, B); A.days[di] = kb; B.days[di] = ka;
          if (mixCost(store, di, r) + wlbCost(store, A) + wlbCost(store, B) < before){ improved = true; moved++; clearL(A, di); clearL(B, di); } else { A.days[di] = ka; B.days[di] = kb; }
        }
        for (let d2=0; d2<7; d2++){ if (d2 === di) continue;
          for (const A of mov) for (const B of mov){ if (A === B) continue;
            const ka = A.days[di], kb = B.days[d2];
            if (!ka || ka === "PTO" || A.days[d2] || !kb || kb === "PTO" || B.days[di]) continue;
            if ((di >= 5 && wkndReq(A.role)) || (d2 >= 5 && wkndReq(B.role))) continue;   // weekends stay covered
            if (isLead(A.role)) continue;   // leaders keep their set days off
            if (pay(di, ka) !== pay(d2, kb)) continue;
            const before = mixCost(store, di, r) + mixCost(store, d2, r) + wlbCost(store, A) + wlbCost(store, B);
            A.days[di] = ""; A.days[d2] = kb; B.days[d2] = ""; B.days[di] = ka;
            if (mixCost(store, di, r) + mixCost(store, d2, r) + wlbCost(store, A) + wlbCost(store, B) < before){ improved = true; moved++; clearL(A, di, d2); clearL(B, di, d2); }
            else { A.days[di] = ka; A.days[d2] = ""; B.days[d2] = kb; B.days[di] = ""; }
          }
        }
      }
    });
    if (!improved) break;
  }
  return {people, moved};
}
function mixSummary(store, r){
  const sellers = r.people.filter(p => sells(p.role) && nhPhase(p) !== "training");
  const rated = sellers.filter(p => tierOf(store, p)).length;
  let hot = 0, noHigh = 0, open = 0, weak = 0, nhH = 0, nhAlone = 0; const issues = [];
  for (let di=0; di<7; di++){ const rows = mixDay(store, di, r);
    rows.forEach(x => { open++; if (x.hot) hot++; if (x.noHigh) noHigh++; if (x.weak) weak++; if (x.nh.length){ nhH++; if (x.nhAlone) nhAlone++; } });
    const blocks = (key, label) => { let cur = null; rows.forEach(x => { if (x[key]){ if (!cur) cur = {a:x.h, b:x.h+1, who:x.nh.slice()}; else { cur.b = x.h+1; x.nh.forEach(n => { if (!cur.who.includes(n)) cur.who.push(n); }); } } else if (cur){ issues.push({di, key, label, ...cur}); cur = null; } }); if (cur) issues.push({di, key, label, ...cur}); };
    blocks("noHigh"); blocks("weak"); blocks("nhAlone");
  }
  return {sellers:sellers.length, rated, hot, noHigh, open, weak, nhH, nhAlone, issues};
}
function coverageDay(store, di, rr){
  const r = rr || roster(store), d = dayInfo(store, di), rows = [];
  for (let h=d.open; h<d.close; h++){
    const g = guests(store,di,h), nd = need(g, store, di, h);
    let c = 0, l = 0;
    r.people.forEach(p => { const k = p.days[di]; if (!k || k === "PTO") return; const t = tplOf(store,di,k); const sh = t ? floorShare(t, p.lunch && p.lunch[di], h) : 0; if (t && leadCounted(p) && inStore(t, h)) l++; if (sh > 0 && isCounted(p)) c += sh; });
    c = Math.round(c * 100) / 100;
    rows.push({h, g, nd, c, l, st: c < nd - 1e-9 ? "short" : c <= nd+1 ? "ok" : "heavy"});
  }
  return rows;
}
function hrsStatus(h, role){
  if (role === "PT"){ const t = S.ptTarget; return h > t + 4 ? "over" : h < t - 4 ? "under" : "ok"; }
  if (h > S.target) return "over"; if (h === S.target) return "ok"; if (h >= S.target - 2) return "near"; return "under"; }

function hoursText(store){
  const ds = daysOf(store).map(d => d.base || d); const t = d => fmt(d.open) + " to " + fmt(d.close);
  const mt = t(ds[0]), f = t(ds[4]), sa = t(ds[5]), su = t(ds[6]); const parts = [];
  if (mt===f && f===sa) parts.push(["Mon to Sat", mt]); else if (f===sa){ parts.push(["Mon to Thu", mt]); parts.push(["Fri and Sat", f]); }
  else { parts.push(["Mon to Thu", mt]); parts.push(["Friday", f]); parts.push(["Saturday", sa]); }
  parts.push(["Sunday", su]); return parts;
}

function dayHead(st, di){
  const d = dayInfo(st, di), dt = shortDate(addDays(S.week, di));
  const tag = d.closed ? `<small class="dh closed">Closed · ${esc(d.name)}</small>` : d.special ? `<small class="dh tp">${esc(d.name)} · ${fmt(d.open)} to ${fmt(d.close)}</small>` : "";
  return `<th class="day">${DAYS[di]}<small class="dt">${dt}</small>${tag}</th>`;
}
function renderOverview(){
  const st = S.store, sh = DATA[st].shape;
  const groups = {}; Object.keys(DATA).forEach(s => (groups[DATA[s].region] = groups[DATA[s].region] || []).push(s));
  $("store").innerHTML = Object.entries(groups).map(([g, ss]) => `<optgroup label="${esc(g)}">${ss.map(s => `<option value="${esc(s)}" ${s===st?"selected":""}>${esc(s)}</option>`).join("")}</optgroup>`).join("");
  $("srcNote").textContent = `Numbers are average guests walking in during that hour. Source: ${DATA[st].src}.`;
  $("storeRegion").textContent = DATA[st].region;
  $("shapePill").className = "pill shape-" + sh; $("shapePill").textContent = SHAPES[sh].pill;
  const est = DATA[st].est;
  $("wkNote").dataset.est = est || "";
  let wkG=0, we=0; for (let di=0; di<7; di++){ const d = dayInfo(st,di); for (let h=d.open; h<d.close; h++){ const g = guests(st,di,h)||0; wkG += g; if (di>=5) we += g; } }
  $("wkNote").innerHTML = (DATA[st].est ? `<b style="color:var(--orange)">New store: no traffic history yet. Hours use ${esc(DATA[st].est)}'s traffic as the estimate until ShopperTrak data comes in.</b> ` : "") + `About ${Math.round(wkG)} guests a week. Saturday and Sunday bring ${Math.round(100*we/wkG)}% of them.`;
  const ds = daysOf(st), nCur = ds.filter(d => d.cur && !d.closed).length;
  const spec = ds.map((d,di) => d.closed ? `<span class="hnote closed">${DAYS[di]} ${shortDate(d.iso)}: Closed for ${esc(d.name)}</span>` : d.special ? `<span class="hnote tp">${DAYS[di]} ${shortDate(d.iso)}: ${esc(d.name)} ${fmt(d.open)} to ${fmt(d.close)}</span>` : "").join("");
  $("hoursLine").innerHTML = hoursText(st).map(([a,b]) => `<span><b>${a}</b>${b}</span>`).join("")
    + spec + (nCur && ds.every(d => d.cur || d.closed) ? `<span class="hnote">Current hours this week. New hours start Sunday, Oct 4.</span>` : nCur ? `<span class="hnote">Mon to Sat on current hours. Sunday, Oct 4 is the first day of the new hours.</span>` : DATA[st].cur ? `<span class="hnote">New hours (started Oct 4)</span>` : "");
  let hmin=24, hmax=0; openDays(st).forEach(d => { hmin = Math.min(hmin,d.open); hmax = Math.max(hmax,d.close); });
  let html = `<thead><tr><th></th>${DAYS.map((d,di) => dayHead(st, di)).join("")}</tr></thead><tbody>`;
  for (let h=hmin; h<hmax; h++){
    html += `<tr><td class="hr">${fmt(h)}</td>`;
    for (let di=0; di<7; di++){ const t = tier(st,di,h), g = guests(st,di,h); let txt = "";
      if (t==="new") txt = S.view==="need" ? need(null) : "New"; else if (t!=="closed") txt = S.view==="need" ? need(g, st, di, h) : Math.round(g*10)/10;
      html += `<td class="t-${t}">${txt}</td>`; }
    html += `</tr>`;
  }
  html += `<tr class="tot"><td class="hr">${S.view==="need"?"Consultant hrs":"Day total"}</td>`;
  for (let di=0; di<7; di++){ const d = dayInfo(st,di); let s = 0; for (let h=d.open; h<d.close; h++){ const g = guests(st,di,h); s += S.view==="need" ? need(g, st, di, h) : (g||0); } html += `<td>${Math.round(s)}</td>`; }
  $("wkGrid").innerHTML = html + `</tr></tbody>`;
  $("vGuests").setAttribute("aria-pressed", S.view==="guests"); $("vNeed").setAttribute("aria-pressed", S.view==="need");
}
function renderShapes(){
  const st = S.store, by = {morning:[], both:[], evening:[]}; Object.keys(DATA).forEach(s => by[DATA[s].shape].push(s));
  $("shapes").innerHTML = ["morning","both","evening"].map(k => {
    const me = DATA[st].shape === k; let bars = "";
    if (me){ const d = dayInfo(st,0), vals = []; for (let h=10; h<d.close; h++) vals.push([0,1,2,3,4].reduce((a,di) => a + (guests(st,di,h)||0), 0));
      const mx = Math.max(...vals) || 1;
      bars = `<div class="bars" aria-label="${esc(st)} weekday guests by hour">${vals.map(v => `<i style="height:${Math.max(6,100*v/mx)}%"></i>`).join("")}</div><div class="note">${esc(st)} weekdays, ${fmt(10)} to ${fmt(d.close)}</div>`; }
    return `<div class="shape ${me?"me":""}"><h3>${SHAPES[k].t}${me?" · your store":""}</h3><p>${SHAPES[k].d}</p>${bars}<div class="who">${by[k].join(", ")}</div></div>`;
  }).join("");
}
function renderMenu(){
  const st = S.store, groups = {};
  for (let di=0; di<7; di++){ const d = dayInfo(st, di); if (d.closed) continue; const key = JSON.stringify(tpls(st,di)) + (d.special ? d.name : ""); (groups[key] = groups[key] || {days:[], T:tpls(st,di), name:d.special ? d.name : ""}).days.push(di); }
  const dayLabel = ds => ds.length === 1 ? DAYFULL[ds[0]] : (ds[ds.length-1]-ds[0] === ds.length-1 ? DAYS[ds[0]] + " to " + DAYS[ds[ds.length-1]] : ds.map(d => DAYS[d]).join(", "));
  $("menu").innerHTML = Object.values(groups).map(g => `<div class="mcard ${g.name ? "tpcard" : ""}"><h3>${dayLabel(g.days)}${g.name ? " · " + esc(g.name) : ""}</h3>${g.T.map(t => `<div class="mrow"><span><span class="tag ${t.k[0]}">${t.name}</span> ${clockAP(t.in)} to ${clock(t.out)} PM</span><small>floor ${clock(t.in+HUD(t))} to ${clock(t.out)} · ${paid(t)} paid hrs</small></div>`).join("")}</div>`).join("")
    + `<div class="mcard"><h3>Part-timers, any day</h3><div class="mrow"><span><span class="tag P">Part-time</span> ${clockAP(PT_T.in)} to ${clock(PT_T.out)} PM</span><small>floor ${clock(PT_T.in+0.5)} to ${clock(PT_T.out)} · ${paid(PT_T)} paid hrs · covers the midday peak</small></div><div class="note" style="margin-top:6px">Four of these is ${4*paid(PT_T)} hours. Two part-timers count as one full-time consultant.</div></div>`;
}
function renderRoster(){
  const st = S.store, r = roster(st);
  $("exampleTag").hidden = !r.example;
  $("rosterWrap").classList.toggle("is-draft", !r.posted);
  const bad = (di, k) => k && k !== "PTO" && !tplOf(st, di, k);
  const tierSel = (p, i) => !sells(p.role) ? "" : `<select class="tsel t-${tierOf(st, p) || "none"}" data-ti="${i}" aria-label="${esc(p.name)} performance">${[["","Rate: not rated"],["H","High performer"],["M","Middle performer"],["L","Low performer"]].map(([v,l]) => `<option value="${v}" ${tierOf(st,p)===v?"selected":""}>${l}</option>`).join("")}</select>`;
  const opt = (di, k) => { const x = isX(k) && tplOf(st, di, k);
    return (bad(di,k) ? `<option value="${esc(k)}" selected>Pick a shift</option>` : "") + `<option value="" ${!k?"selected":""}>Off</option>`
    + (x ? `<option value="${esc(k)}" selected>${clock(x.in)}-${clock(x.out)}*</option>` : "")
    + tpls(st,di).map(t => `<option value="${t.k}" ${t.k===k?"selected":""}>${clock(t.in)}-${clock(t.out)}</option>`).join("")
    + `<option value="P" ${k==="P"?"selected":""}>${clock(PT_T.in)}-${clock(PT_T.out)}</option><option value="PTO" ${k==="PTO"?"selected":""}>PTO</option>`
    + (k && k !== "PTO" && !bad(di,k) ? `<option value="__adj">Adjust hours…</option>` : ""); };
  const kc = k => isX(k) ? "X" : k;
  /* Adjust hours: start and end pickers in 15-minute steps, starting from the shift the leader picked. */
  const adjSel = (p, i, di) => { const k = p.days[di]; if (!isX(k)) return ""; const t = tplOf(st, di, k); if (!t) return ""; const d = dayInfo(st, di);
    const ins = [], outs = []; for (let v = d.open - 1.5; v <= d.close - 2 + 1e-9; v += 0.25) ins.push(v); for (let v = t.in + 2; v <= d.close + 1 + 1e-9; v += 0.25) outs.push(v);
    const o = (arr, cur) => arr.map(v => `<option value="${v}" ${Math.abs(v-cur) < 1e-9 ? "selected" : ""}>${clock(v)}</option>`).join("");
    return `<div class="adj"><select data-ai="${i}" data-ad="${di}" data-ae="in" aria-label="${esc(p.name)} ${DAYFULL[di]} start">${ins.map(v => `<option value="${v}" ${Math.abs(v-t.in) < 1e-9 ? "selected" : ""}>In ${clock(v)}</option>`).join("")}</select><select data-ai="${i}" data-ad="${di}" data-ae="out" aria-label="${esc(p.name)} ${DAYFULL[di]} end">${outs.map(v => `<option value="${v}" ${Math.abs(v-t.out) < 1e-9 ? "selected" : ""}>Out ${clock(v)}</option>`).join("")}</select></div>`; };
  const lunchSel = (p, i, di) => { const k = p.days[di], t = k && k !== "PTO" && tplOf(st, di, k); if (!hasLunch(t)) return "";
    const cur = p.lunch && p.lunch[di];
    return `<select class="lsel" data-li="${i}" data-ld="${di}" aria-label="${esc(p.name)} ${DAYFULL[di]} lunch" title="Lunch time">${lunchOpts(t).map(x => `<option value="${x}" ${cur != null && Math.abs(cur-x) < 1e-9 ? "selected" : ""}>Lunch ${clock(x)}</option>`).join("")}</select>`; };
  const row = (p, i) => { const hrs = hoursOf(st, p), hs = hourly(p.role) ? statusOf(st, p) : "na";
    const pt = ptoOf(p); const lab = (hs === "na" ? "leader" : hrsLabel(st, p)) + (pt ? " · " + pt + " PTO" : "");
    const ph = nhPhase(p), act = ph === "training";
    const nhLab = p.nh && !ph ? `<span class="nhchk done">New hire period done ${shortDate(nhTagEnd(p))}</span>`
      : ph === "tagged" ? `<label class="nhchk tagged"><input type="checkbox" data-nh="${i}" checked> New hire until ${shortDate(nhTagEnd(p))} · pair with High or Middle</label>`
      : `<label class="nhchk"><input type="checkbox" data-nh="${i}" ${act ? "checked" : ""}> New hire${act ? `, in training until ${p.nhStart ? shortDate(nhEnd(p)) : "unchecked"} · not counted` : ""}</label>`;
    return `<tr class="${act ? "nhrow" : ph === "tagged" ? "nhtag" : ""}"><td class="nm"><input id="nm${i}" data-i="${i}" value="${esc(p.name)}" placeholder="Type a name" aria-label="Name" title="Click to type this person's name">${nhLab}</td>
      <td class="rl"><select id="rl${i}" data-i="${i}" aria-label="Role">${Object.entries(ROLES).map(([k,v]) => `<option value="${k}" ${p.role===k?"selected":""}>${v}</option>`).join("")}</select>${tierSel(p, i)}</td>
      ${p.days.map((k,di) => dayInfo(st, di).closed ? `<td class="dy"><div class="mshift k-closed">Closed</div></td>`
        : `<td class="dy"><select id="d${i}_${di}" data-i="${i}" data-d="${di}" class="k-${bad(di,k) ? "bad" : kc(k)}" aria-label="${esc(p.name)} ${DAYFULL[di]}">${opt(di,k)}</select>${adjSel(p, i, di)}${lunchSel(p, i, di)}</td>`).join("")}
      <td class="hrs h-${hs}">${hrs}<small>${lab}</small></td>
      <td><button class="icon-btn" data-del="${i}" aria-label="Remove ${esc(p.name)}" style="width:32px">✕</button></td></tr>`; };
  const idx = r.people.map((p,i) => ({p,i}));
  let html = `<thead><tr><th style="text-align:left">Name</th><th>Role</th>${DAYS.map((d,di) => `<th>${d}<small class="dt">${shortDate(addDays(S.week, di))}</small></th>`).join("")}<th>Hours</th><th></th></tr></thead><tbody>`;
  const ld = idx.filter(x => isLead(x.p.role)).sort((a,b) => LEAD_ORDER.indexOf(a.p.role) - LEAD_ORDER.indexOf(b.p.role));
  const mirror = p => { const hrs = hoursOf(st, p), hs = statusOf(st, p);
    return `<tr class="mirror"><td class="nm"><div class="mname">${esc(p.name)}</div></td><td class="rl"><span class="mrole">${ROLES[p.role]}<small>selling + leading${tierOf(st,p) ? ` · <b class="tchip t-${tierOf(st,p)}">${TIERS[tierOf(st,p)]}</b>` : " · not rated"}</small></span></td>
      ${p.days.map((k,di) => { const t = k && k !== "PTO" && tplOf(st,di,k); return `<td class="dy"><div class="mshift k-${dayInfo(st,di).closed ? "closed" : kc(k)}">${dayInfo(st,di).closed ? "Closed" : t ? clock(t.in)+"-"+clock(t.out) : (k==="PTO" ? "PTO" : k ? "Pick a shift" : "Off")}${t && hasLunch(t) && p.lunch && p.lunch[di] != null ? `<small>lunch ${clock(p.lunch[di])}</small>` : ""}</div></td>`; }).join("")}
      <td class="hrs h-${hs}">${hrs}<small>${hrsLabel(st, p)}${ptoOf(p) ? " · " + ptoOf(p) + " PTO" : ""}</small></td><td></td></tr>`; };
  html += `<tr class="grp"><td colspan="11">Selling team · full-time target ${S.target} hrs · part-time about ${S.ptTarget} hrs · everyone who sells on the floor</td></tr>`
    + idx.filter(x => x.p.role==="C").map(x => row(x.p, x.i)).join("") + idx.filter(x => x.p.role==="PT").map(x => row(x.p, x.i)).join("") + ld.filter(x => sells(x.p.role)).map(x => mirror(x.p)).join("");
  html += `<tr class="grp"><td colspan="11">Leadership · leaders on the floor · edit selling leaders and key holders here</td></tr>` + ld.map(x => row(x.p, x.i)).join("");
  const csr = idx.filter(x => x.p.role === "CSR");
  if (csr.length) html += `<tr class="grp"><td colspan="11">CSR · scheduled but not counted toward sales coverage or leader in store</td></tr>` + csr.map(x => row(x.p, x.i)).join("");
  html += `</tbody><tfoot><tr><td style="text-align:left;background:transparent">Selling on the floor</td><td style="background:transparent"></td>${DAYS.map((_,di) => `<td>${r.people.filter(p => isCounted(p) && p.days[di] && p.days[di] !== "PTO").length}</td>`).join("")}<td></td><td style="background:transparent"></td></tr></tfoot>`;
  $("roster").innerHTML = html;
  if (!canWrite) $("roster").querySelectorAll("input,select,button").forEach(el => el.disabled = true);
  const redo = di => { fillLunches(st, r.people); };
  $("roster").querySelectorAll("input[data-i]:not([type=checkbox])").forEach(el => el.addEventListener("change", () => { const pp = r.people[+el.dataset.i], old = pp.name, tr = tierOf(st, pp); pp.name = el.value; if (tr && old !== el.value){ const m = PERF[st] || (PERF[st] = {}); delete m[old]; setTier(st, el.value, tr); } commit(st, S.week, r); renderAll(); }));
  $("roster").querySelectorAll("select[data-d]").forEach(el => el.addEventListener("change", () => { const p = r.people[+el.dataset.i], di = +el.dataset.d;
    if (el.value === "__adj"){ const t = tplOf(st, di, p.days[di]); if (!t){ renderAll(); return; } p.days[di] = mkX(t.in, t.out); toast("Pick the start and end times under the shift"); }
    else p.days[di] = el.value;
    if (p.lunch) p.lunch[di] = null; redo(di); commit(st, S.week, r); renderAll(); }));
  $("roster").querySelectorAll("select[data-ai]").forEach(el => el.addEventListener("change", () => { const p = r.people[+el.dataset.ai], di = +el.dataset.ad, t = tplOf(st, di, p.days[di]); if (!t) return;
    let a = t.in, b = t.out; if (el.dataset.ae === "in") a = parseFloat(el.value); else b = parseFloat(el.value);
    if (b < a + 2) b = a + 2;
    p.days[di] = mkX(a, b); if (p.lunch) p.lunch[di] = null; redo(di); commit(st, S.week, r); renderAll(); }));
  $("roster").querySelectorAll("select[data-li]").forEach(el => el.addEventListener("change", () => { const p = r.people[+el.dataset.li]; if (!p.lunch) p.lunch = Array(7).fill(null); p.lunch[+el.dataset.ld] = parseFloat(el.value); commit(st, S.week, r); renderAll(); }));
  $("roster").querySelectorAll("input[data-nh]").forEach(el => el.addEventListener("change", () => { const p = r.people[+el.dataset.nh]; if (el.checked){ p.nh = true; p.nhStart = S.week; } else { delete p.nh; delete p.nhStart; } commit(st, S.week, r); renderAll(); toast(el.checked ? p.name + " marked as a new hire. Not counted toward coverage or staffing." : p.name + " now counts toward coverage and staffing."); }));
  $("roster").querySelectorAll("select[data-ti]").forEach(el => el.addEventListener("change", () => { const p = r.people[+el.dataset.ti]; setTier(st, p.name, el.value); renderAll(); }));
  $("roster").querySelectorAll("select[id^=rl]").forEach(el => el.addEventListener("change", () => { r.people[+el.dataset.i].role = el.value; commit(st, S.week, r); renderAll(); }));
  $("roster").querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { r.people.splice(+b.dataset.del, 1); commit(st, S.week, r); renderAll(); }));
}
function renderCoverage(){
  const st = S.store, r = roster(st);
  let hmin=24, hmax=0; openDays(st).forEach(d => { hmin = Math.min(hmin,d.open); hmax = Math.max(hmax,d.close); });
  const cov = [0,1,2,3,4,5,6].map(di => coverageDay(st, di));
  const mixes = [0,1,2,3,4,5,6].map(di => mixDay(st, di, r));
  const mixCell = x => { const cls = x.noHigh ? "mx-bad" : x.nhAlone ? "mx-nh" : x.weak ? "mx-weak" : (x.H || x.M || x.L) ? "mx-ok" : "";
    const why = [x.noHigh ? "Hot zone with no High performer" : "", x.weak ? "Lows outnumber Highs and Middles" : "", x.nhAlone ? "New hire with no High or Middle: " + x.nh.join(", ") : ""].filter(Boolean).join(". ");
    return `<td class="mx ${cls}${x.hot ? " mx-hot" : ""}" title="${esc(why)}"><span class="mh">${x.H}</span><span class="mm">${x.M}</span><span class="ml">${x.L}</span>${x.U ? `<span class="mu">${x.U}</span>` : ""}${x.nh.length ? `<i class="mnh">NH</i>` : ""}</td>`; };
  $("cvCount").setAttribute("aria-pressed", S.cview !== "mix"); $("cvMix").setAttribute("aria-pressed", S.cview === "mix");
  $("covLegend").hidden = S.cview === "mix"; $("mixLegend").hidden = S.cview !== "mix";
  let html = `<thead><tr><th></th>${DAYS.map((d,di) => dayHead(st, di)).join("")}</tr></thead><tbody>`;
  for (let h=hmin; h<hmax; h++){
    html += `<tr><td class="hr">${fmt(h)}</td>`;
    if (S.cview === "mix"){ for (let di=0; di<7; di++){ const x = mixes[di].find(z => z.h === h); html += x ? mixCell(x) : `<td class="t-closed"></td>`; } html += `</tr>`; continue; }
    for (let di=0; di<7; di++){ const x = cov[di].find(z => z.h === h); html += x ? `<td class="c-${x.st}${x.l === 0 ? " nolead" : ""}" ${x.l === 0 ? 'title="No leader in the store this hour"' : ""}>${x.c}<small>/${x.nd}</small></td>` : `<td class="t-closed"></td>`; }
    html += `</tr>`;
  }
  html += `<tr class="leadrow"><td class="hr">Leader in store</td>${cov.map((rows, di) => { if (dayInfo(st, di).closed) return `<td class="t-closed">Closed</td>`; const gapN = rows.filter(x => x.l === 0).length, gap = gapN > 0; return `<td class="${gap?"c-short":"c-ok"}">${gap ? gapN + (gapN===1 ? " hr" : " hrs") + " none" : "✓"}</td>`; }).join("")}</tr></tbody>`;
  $("cov").innerHTML = html;

  const cons = r.people.filter(p => hourly(p.role)), hrs = cons.map(p => hoursOf(st,p));
  const sellers = r.people.filter(isCounted).reduce((a,p) => a + fte(p.role), 0), leaders = r.people.filter(leadCounted).length;
  const all = cov.flat(), onT = all.filter(x => x.st==="ok").length;
  const isRec = !TEAM_FIELDS.some(([k]) => !blank(teamOf(st)[k]));
  $("chips").innerHTML = `<div class="chip"><b>${sellers}</b><small>${isRec ? "recommended selling team" : "on the selling team"}</small></div>
    <div class="chip"><b>${leaders}</b><small>${isRec ? "recommended leadership roles" : "in leadership roles"}</small></div>
    <div class="chip"><b>${cons.filter(p => ["ok","near"].includes(statusOf(st,p))).length}/${cons.length}</b><small>at their hours target</small></div>
    <div class="chip"><b>${hrs.reduce((a,b)=>a+b,0)}</b><small>hourly team hrs this week</small></div>
    <div class="chip"><b>${onT}/${all.length}</b><small>open hours on target</small></div>
    ${(() => { const n = r.people.filter(p => nhActive(p)).length; return n ? `<div class="chip nhchip"><b>${n}</b><small>new ${n===1?"hire":"hires"} in training, not counted</small></div>` : ""; })()}
    ${(() => { const n = r.people.reduce((a,p) => a + p.days.filter(k => k==="PTO").length, 0); return `<div class="chip"><b>${n}</b><small>PTO ${n===1?"day":"days"} this week</small></div>`; })()}`;

  const tips = [];
  const offWE = []; r.people.forEach(p => { if (!wkndReq(p.role)) return; [5,6].forEach(di => { if (!dayInfo(st, di).closed && !p.days[di]) offWE.push(p.name + " " + DAYS[di]); }); });
  if (offWE.length) tips.push({c:"short", h:`Weekend: ${offWE.length} ${offWE.length===1?"day":"days"} off without PTO`, t:`${offWE.slice(0,8).join(", ")}${offWE.length>8?" and more":""}. Weekends are workdays for the whole sales team and leadership unless they're on PTO.`});
  cons.forEach(p => { const h = hoursOf(st,p), s = statusOf(st, p);
    if (p.role === "PT"){ if (s !== "ok") tips.push({c:"short", h:`${p.name} is at ${h} hours`, t:`Part-timers should land near ${S.ptTarget} (${S.ptTarget-4} to ${S.ptTarget+4}). ${s === "over" ? "Take away a shift." : "Add a Part-time shift on a busy day."}`}); return; }
    if (s === "under"){ const off = p.days.map((k,di) => k ? null : di).filter(x => x !== null);
      const pick = off.sort((a,b) => cov[b].filter(x=>x.st==="short").length - cov[a].filter(x=>x.st==="short").length)[0];
      tips.push({c:"short", h:`${p.name} is at ${h} hours`, t:`Needs ${S.target - h} more to hit ${S.target}.${pick!=null?` Add a ${DAYFULL[pick]} shift, where it helps coverage most.`:""}`}); }
    if (s === "over"){ const wk = workedOf(st,p); tips.push({c:"short", h:`${p.name} is at ${h} hours`, t: wk > S.target ? `That's ${wk - S.target} hours of overtime. Take away a shift, starting with the lightest day.` : `Over ${S.target} with PTO included. Take away a shift so worked hours plus PTO land at ${S.target}.`}); }
  });
  cov.forEach((rows, di) => {
    let cur = null; const blocks = [];
    rows.forEach(x => { if (x.st==="short"){ if (!cur) cur = {a:x.h, b:x.h+1, down:x.nd-x.c}; else { cur.b = x.h+1; cur.down = Math.max(cur.down, x.nd-x.c); } } else if (cur){ blocks.push(cur); cur = null; } });
    if (cur) blocks.push(cur);
    blocks.forEach(b => tips.push({c:"short", h:`${DAYFULL[di]} short ${fmt(b.a)} to ${fmt(b.b)}`, t:`Down as many as ${b.down}. Move someone off a lighter day, or switch an Opener to a later shift if the short hours are in the evening.`}));
  });
  const mxs = mixSummary(st, r);
  if (!mxs.rated) tips.unshift({c:"short", h:"Rate your selling team", t:`Mark each consultant High, Middle or Low under their role. The tool uses it to put a High performer in every hot zone and pair new hires with a High or Middle. It's also 15 points of the schedule grade.`});
  else if (mxs.rated < mxs.sellers) tips.push({c:"heavy", h:`${mxs.sellers - mxs.rated} on the selling team not rated`, t:"Rate them so the mix check is complete."});
  const mi = mxs.issues;
  const lbl = {noHigh:"hot zone with no High performer", weak:"Lows outnumber Highs and Middles", nhAlone:"new hire with no High or Middle on the floor"};
  ["nhAlone","noHigh","weak"].forEach(key => { const list = mi.filter(x => x.key === key); if (!list.length) return;
    tips.unshift({c: key === "weak" ? "heavy" : "short", h:`Talent mix: ${list.length} ${list.length===1?"stretch":"stretches"} with ${lbl[key]}`, t:`${list.slice(0,5).map(x => `${DAYS[x.di]} ${fmt(x.a)} to ${fmt(x.b)}${key === "nhAlone" ? " (" + x.who.join(", ") + ")" : ""}`).join(", ")}${list.length>5?" and more":""}. Swap shifts so a ${key === "weak" ? "High or Middle" : key === "noHigh" ? "High" : "High or Middle"} performer is on the floor, or click Balance the mix.`}); });
  const wl = wlbSummary(st, r);
  if (wl.split.length || wl.clopen.length) tips.push({c:"heavy", h:`Work-life balance: ${wl.split.length ? wl.split.length + " with split days off" : ""}${wl.split.length && wl.clopen.length ? ", " : ""}${wl.clopen.length ? wl.clopen.length + " close-then-open" : ""}`, t:`Give people their days off back to back when you can, and don't close someone then open them the next morning. ${wl.split.length ? "Split: " + wl.split.slice(0,5).join(", ") + ". " : ""}${wl.clopen.length ? "Close then open: " + wl.clopen.slice(0,4).join(", ") + ". " : ""}Balance the week can fix most of this without changing coverage.`});
  const lg = leaderGaps(st, cov);
  if (lg.length){
    const need = minLeaderShifts(st), have = r.people.filter(leadCounted).reduce((a,p) => a + p.days.filter(k => k && k !== "PTO").length, 0), cap = r.people.filter(leadCounted).length * 5;
    tips.unshift({c:"short", h:`No leader in the store: ${lg.length} ${lg.length===1?"stretch":"stretches"} this week`, t:`A leader in the store every open hour is a must. Fix: ${lg.slice(0,6).map(g => `${DAYS[g.di]} ${fmt(g.a)} to ${fmt(g.b)}`).join(", ")}${lg.length>6?" and more":""}. ${cap < need ? `This week needs at least ${need} leader shifts and your leaders can work ${cap} (5 each), so you can't close every gap without another leader or key holder.` : `It takes at least ${need} leader shifts to cover every hour. You have ${have} scheduled.`}`});
  }
  const badShifts = [];
  r.people.forEach(p => p.days.forEach((k,di) => { if (k && k !== "PTO" && !tplOf(st, di, k)) badShifts.push(`${p.name} ${DAYS[di]}`); }));
  if (badShifts.length) tips.push({c:"short", h:`${badShifts.length} ${badShifts.length===1?"shift needs":"shifts need"} a new pick`, t:`The store's hours changed that day, so the old shift doesn't exist. Pick a shift for: ${badShifts.slice(0,6).join(", ")}${badShifts.length>6?" and more":""}.`});
  const cn = COPY_NOTES[rk(st, S.week)];
  if (cn && cn.length) tips.push({c:"heavy", h:`Copied from last week: ${cn.length} ${cn.length===1?"shift":"shifts"} adjusted`, t:`Hours were different, so these moved to the closest shift: ${cn.slice(0,5).join("; ")}${cn.length>5?"; and more":""}.`});
  const lunchHot = [];
  r.people.forEach(p => p.days.forEach((k,di) => { const t = k && k !== "PTO" && tplOf(st,di,k); if (hasLunch(t) && p.lunch && p.lunch[di] != null && isCounted(p) && (cov[di].find(x => x.h === Math.floor(p.lunch[di])) || {}).st === "short") lunchHot.push(`${p.name} ${DAYS[di]} ${clock(p.lunch[di])}`); }));
  if (lunchHot.length) tips.push({c:"short", h:`${lunchHot.length} ${lunchHot.length===1?"lunch lands":"lunches land"} in a short hour`, t:`Move ${lunchHot.length===1?"it":"them"} to a lighter hour so the floor stays covered: ${lunchHot.slice(0,4).join(", ")}${lunchHot.length>4?" and more":""}.`});
  const heavyDays = cov.map((rows,di) => ({di, n:rows.filter(x => x.st==="heavy").length})).filter(x => x.n >= 3);
  if (heavyDays.length){
    const satPeak = Math.max(...cov[5].map(x => x.c));
    tips.push({c:"heavy", h:`Heavy on ${heavyDays.map(x => DAYS[x.di]).join(", ")}`, t:`Your weekend peak needs about ${satPeak} consultants on the floor at once. Giving all of them 40 hours puts extra people on the lighter weekdays. Use those hours for appointments, follow-ups, be-backs and training, and never pull anyone from a red hour to fix a blue one.`});
  }
  tips.push({c:"info", h:SHAPES[DATA[st].shape].t, t:SHAPES[DATA[st].shape].d});
  if (!tips.some(t => t.c==="short" || t.c==="heavy")) tips.unshift({c:"ok", h:"This week works", t:`Everyone is at their hours target and the floor matches the traffic. Post it.`});
  const sun = tpls(st,6);
  if (sun.length === 1 && paid(sun[0]) < 8) tips.push({c:"info", h:"About the Sunday shift", t:`Your Sunday shift pays ${paid(sun[0])} hours, so a consultant working Sunday plus four 8-hour days lands at ${32 + paid(sun[0])}. That shows as near ${S.target}.`});
  $("tips").innerHTML = tips.map(t => `<div class="tip ${t.c}">${esc(t.h)}<span>${esc(t.t)}</span></div>`).join("");
  renderText(cov);
}
function renderText(cov){
  const st = S.store, r = roster(st);
  const lines = [`${st} · Week plan · Hours: ${hoursText(st).map(([a,b]) => a + " " + b).join(", ")}`, ""];
  const line = p => (`${p.name}${p.name === ROLES[p.role] ? "" : " (" + ROLES[p.role] + ")"}${nhActive(p) ? " NEW HIRE" : ""}`.padEnd(40) + " ") + p.days.map((k,di) => { const t = k && k !== "PTO" && tplOf(st,di,k); return (DAYS[di] + " " + (dayInfo(st,di).closed ? "Closed" : t ? clock(t.in)+"-"+clock(t.out) + (hasLunch(t) && p.lunch && p.lunch[di] != null ? " L" + clock(p.lunch[di]) : "") : (k==="PTO" ? "PTO" : "Off"))).padEnd(20); }).join("") + ` ${hoursOf(st,p)} hrs`;
  lines[0] = `${st} · Week of ${weekLabel(S.week)} · ${r.posted ? "POSTED" : "DRAFT, NOT POSTED"} · Hours: ${hoursText(st).map(([a,b]) => a + " " + b).join(", ")}`;
  const spc = daysOf(st).map((d,di) => d.closed ? `${DAYS[di]} ${shortDate(d.iso)} closed (${d.name})` : d.special ? `${DAYS[di]} ${shortDate(d.iso)} ${d.name} ${fmt(d.open)} to ${fmt(d.close)}` : "").filter(Boolean);
  if (spc.length) lines.splice(1, 0, "Special hours: " + spc.join(", "));
  r.people.filter(p => p.role==="C").forEach(p => lines.push(line(p)));
  r.people.filter(p => p.role==="PT").forEach(p => lines.push(line(p)));
  r.people.filter(p => isLead(p.role)).sort((a,b) => LEAD_ORDER.indexOf(a.role) - LEAD_ORDER.indexOf(b.role)).forEach(p => lines.push(line(p)));
  r.people.filter(p => p.role === "CSR").forEach(p => lines.push(line(p)));
  const shorts = cov.flatMap((rows,di) => rows.filter(x => x.st==="short").map(x => `${DAYS[di]} ${fmt(x.h)}`));
  lines.push("", shorts.length ? "Short hours: " + shorts.join(", ") : "No short hours.");
  $("planText").value = lines.join("\n");
}

let _recCache = {};
function recFor(store){ const tm = TEAMS[store] || {}; const k = store + "|" + S.gpc + "|" + S.gpcLight + "|" + S.minc + "|" + S.lunch + "|" + [tm.goalGM, tm.goalL, tm.goalLSL, tm.goalASL, tm.goalKH].join(","); return _recCache[k] || (_recCache[k] = recommended(store)); }
function renderTeam(){
  const st = S.store, team = teamOf(st), rec = recFor(st), r = roster(st);
  /* Only show GM and AGM boxes where the store is slotted for one (or already has one). */
  const FIELDS = TEAM_FIELDS.filter(([k]) => !(k === "GM" || k === "L") || rec.counts[k] > 0 || (+team[k] || 0) > 0);
  $("teamInputs").innerHTML = FIELDS.map(([k,lab]) => `<label for="tm_${k}">${lab}<input id="tm_${k}" type="number" min="0" max="40" step="1" value="${blank(team[k]) ? rec.counts[k] : team[k]}" ${canWrite ? "" : "disabled"}></label>`).join("");
  FIELDS.forEach(([k]) => $("tm_"+k).addEventListener("change", e => {
    const v = e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10));
    team[k] = v; saveTeam(st);
    const kk = rk(st, S.week);
    if (!SAVED[kk]){ DRAFTS[kk] = {example:true, posted:false, saved:false, people:suggest(st, S.week)}; toast("Suggested roster rebuilt for your team"); }
    else toast("Team saved. Click Suggest a roster to rebuild this week around it.");
    renderAll();
  }));
  const recSell = rec.counts.C + rec.counts.LSL + rec.counts.ASL + rec.counts.KH;
  const have = r.people.filter(isCounted).reduce((a,p) => a + fte(p.role), 0), nNH = r.people.filter(p => nhActive(p)).length;
  const nPT = r.people.filter(p => p.role === "PT").length;
  const shortHrs = [0,1,2,3,4,5,6].reduce((a,di) => a + coverageDay(st,di).filter(x => x.st==="short").length, 0);
  const leadGap = [0,1,2,3,4,5,6].reduce((a,di) => a + coverageDay(st,di).filter(x => x.l===0).length, 0);
  const needLS = minLeaderShifts(st), capLS = r.people.filter(leadCounted).length * 5;
  const msg = $("staffMsg");
  const openLead = [["GM","goalGM"],["L","goalL"],["LSL","goalLSL"],["ASL","goalASL"],["KH","goalKH"]].map(([r,k]) => ({r, n:(+team[k]||0) - (+team[r]||0)})).filter(x => team[x.r] !== "" && x.n > 0);
  const leadNote = rec.slotted ? `<span class="goalnote">Leadership slotted on the staffing report: ${[["GM","goalGM"],["L","goalL"],["LSL","goalLSL"],["ASL","goalASL"]].filter(([r,k]) => +team[k]).map(([r,k]) => `${team[k]} ${ROLES[r]}${+team[k] > 1 ? "s" : ""}`).join(", ") || "none"}.${openLead.length ? ` <b style="color:var(--short)">Open: ${openLead.map(x => x.n + " " + ROLES[x.r] + (x.n > 1 ? "s" : "")).join(", ")}.</b>` : " All leadership slots filled."}</span>` : "";
  const goalNote = leadNote + (team.goalC != null && team.goalC !== "" ? `<span class="goalnote">Staffing report ${esc(team.asOf || "")}: company goal is <b>${team.goalC}</b> full-time sales${team.openC ? `, <b>${team.openC}</b> open` : ""}${team.pt ? `, plus ${team.pt} part-time (${team.pt/2} full-time equivalent)` : ""}. 1-to-1 coverage with 40-hour weeks calls for about <b>${recSell}</b> on the selling team, leaders who sell included.</span>` : "");
  const entered = TEAM_FIELDS.some(([k]) => !blank(team[k]));
  $("teamSrc").innerHTML = entered
    ? (team.asOf ? `Showing <b>actual headcount</b> from the staffing report dated ${esc(team.asOf)}. Leadership shows only the roles each store has. Recommended leadership is what the report says the store is slotted for.` : `Showing <b>actual headcount</b> entered for this store.`)
    : `Showing <b>recommended headcount</b>. No actual team has been entered for this store yet. Enter who you have to see your staffing gap.`;
  const recLeadN = rec.counts.GM + rec.counts.L + rec.counts.LSL + rec.counts.ASL + rec.counts.KH;
  const haveLead = r.people.filter(leadCounted).length;
  const gapCell = (n, label) => { const cls = n < 0 ? "short" : n > 0 ? "over" : "ok"; const txt = n < 0 ? Math.abs(n) : n > 0 ? "+" + n : "✓"; const lab = n < 0 ? "short" : n > 0 ? "over" : "on target"; return `<div class="bgap ${cls}"><div class="bnum">${txt}</div><div class="blab">${lab}</div></div>`; };
  const card = (title, recN, actN, sub) => `<div class="bcard"><h4>${title}</h4><div class="brow">
      <div><div class="bnum">${recN}</div><div class="blab">Recommended</div></div>
      <div><div class="bnum">${entered ? actN : "?"}</div><div class="blab">Actual</div></div>
      ${entered ? gapCell(actN - recN) : `<div class="bgap"><div class="blab">Enter your team</div></div>`}</div>${sub ? `<div class="bsub">${sub}</div>` : ""}</div>`;
  const openLeadTxt = (() => { const o = [["GM","goalGM"],["L","goalL"],["LSL","goalLSL"],["ASL","goalASL"]].map(([rr,k]) => ({rr, n:(+team[k]||0) - (+team[rr]||0)})).filter(x => team[x.rr] !== "" && x.n > 0); return o.length ? "Open: " + o.map(x => x.n + " " + ROLES[x.rr] + (x.n > 1 ? "s" : "")).join(", ") : ""; })();
  $("staffBoard").innerHTML = card("Selling team (1-to-1, 40-hour weeks)" + (nPT ? ` · ${nPT} part-time count as ${nPT/2}` : ""), recSell, have, [team.goalC != null && team.goalC !== "" ? `Company goal ${team.goalC} full-time sales${team.openC ? " · " + team.openC + " open on the report" : ""}` : "", nNH ? `<b class="nhtxt">+ ${nNH} new ${nNH===1?"hire":"hires"} in training, not counted</b>` : ""].filter(Boolean).join(" · "))
    + card(rec.slotted ? "Leadership (slotted on the report)" : "Leadership", recLeadN, haveLead, [openLeadTxt, capLS < needLS ? `<b style="color:var(--short)">Leader in store every hour takes ${needLS} leader shifts a week. Your ${haveLead} ${haveLead===1?"leader":"leaders"} can work ${capLS}.</b>` : `Leader in store every hour takes ${needLS} leader shifts a week. Your leaders can work ${capLS}.`].filter(Boolean).join(" · "));
  if (!entered){
    const recLead = rec.counts.GM + rec.counts.L + rec.counts.LSL + rec.counts.ASL + rec.counts.KH;
    msg.className = "tip info";
    msg.innerHTML = `Recommended headcount: <b>${recSell}</b> on the selling team (${rec.counts.C} consultants plus ${recSell - rec.counts.C} selling leaders) and <b>${recLead}</b> in leadership roles.<span>That's what 1-to-1 coverage with 40-hour weeks takes at this store. The roster below is built on it. Enter your actual team above to see whether you're staffed right.</span>`;
    return;
  }
  if (have < recSell){
    msg.className = "tip shortmsg";
    msg.innerHTML = `You have <b>${have}</b> on the selling team. Full 1-to-1 coverage with 40-hour weeks takes about <b>${recSell}</b>, so you're <b>${recSell - have} short</b>.<span>The roster gives everyone their 40 hours and puts them in the busiest hours first. ${shortHrs} open ${shortHrs===1?"hour is":"hours are"} still short (red in the coverage check).${leadGap ? ` ${leadGap} ${leadGap===1?"hour has":"hours have"} no leader in the store.` : ""} That's your hiring gap.</span>${goalNote}`;
  } else if (have > recSell){
    msg.className = "tip okmsg";
    msg.innerHTML = `You have <b>${have}</b> on the selling team, <b>${have - recSell} more</b> than 1-to-1 coverage needs.<span>Everyone still gets 40 hours. The extra shifts go to your busiest hours.${leadGap ? ` ${leadGap} ${leadGap===1?"hour has":"hours have"} no leader in the store.` : ""}</span>${goalNote}`;
  } else {
    msg.className = "tip okmsg";
    msg.innerHTML = `You have <b>${have}</b> on the selling team, right at what 1-to-1 coverage needs with 40-hour weeks.<span>${shortHrs ? shortHrs + (shortHrs===1 ? " open hour is" : " open hours are") + " still short." : "Every open hour can be covered."}${leadGap ? ` ${leadGap} ${leadGap===1?"hour has":"hours have"} no leader in the store.` : ""}</span>${goalNote}`;
  }
}
function weekState(st, w){ const r = SAVED[rk(st, w)]; return !r ? "none" : r.posted ? "posted" : "draft"; }
function renderStatus(){
  const st = S.store, k = rk(st, S.week), r = roster(st), m = META[k], thisW = storeNow(st).week;
  /* Week dropdown: 8 weeks back to 8 weeks ahead, plus any other saved week, each marked Posted, Draft or Not started. */
  const ws = new Set(); for (let i=-8; i<=8; i++) ws.add(addDays(thisW, 7*i)); ws.add(S.week);
  Object.keys(SAVED).forEach(kk => { const [s2, w] = kk.split("|"); if (s2 === st) ws.add(w); });
  const mark = {posted:"✓ Posted", draft:"✎ Draft, not posted", none:"Not started"};
  $("weekSel").innerHTML = [...ws].sort().map(w => { const stt = weekState(st, w); const tag = w === thisW ? " (this week)" : ""; const sw = (DATA[st].cur && addDays(w,6) === DATA[st].switchOn ? " · new hours start Sun" : "") + [0,1,2,3,4,5,6].map(di => { const iso = addDays(w, di), c = closedOn(iso), t = tentpoleNamed(iso); return c ? " · closed " + c : t ? " · " + t.name : ""; }).join("");
    return `<option value="${w}" ${w===S.week?"selected":""}>${weekLabel(w)}${tag} · ${mark[stt]}${sw}</option>`; }).join("");
  $("weekSel").className = "weeksel ws-" + weekState(st, S.week);
  const bar = $("draftBar"), el = $("postStatus");
  let when = "";
  if (m && m.updatedAt){ const d = new Date(m.updatedAt); when = "Last change " + d.toLocaleString("en-US", {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}); }
  const who = m && m.updatedBy ? (NAMES[m.updatedBy] != null ? NAMES[m.updatedBy] : (nameOf(m.updatedBy), "")) : "";
  const whenWho = when ? when + (who ? " by " + who : "") : "";
  if (r.posted){
    bar.className = "pbar posted";
    $("pbarTitle").textContent = "Posted · live for your team";
    $("pbarText").textContent = (whenWho ? whenWho + ". " : "") + "Changes save and show for everyone right away." + (LIVE ? "" : " Saved on this device only.");
    el.className = "status posted"; el.textContent = "✓ Posted";
    $("postBtn").hidden = true; $("postBtn2").hidden = true; $("unpost").hidden = !canWrite;
  } else {
    bar.className = "pbar draft";
    $("pbarTitle").textContent = "Draft · not posted";
    $("pbarText").textContent = (r.saved ? "Saved as a draft. " + (whenWho ? whenWho + ". " : "") : "This is a suggestion and hasn't been saved. ") + "Your team can't see this schedule, and it won't show in Who's working right now until you post it.";
    el.className = "status draft"; el.textContent = "✎ Draft";
    $("postBtn").hidden = true; $("postBtn2").hidden = !canWrite; $("unpost").hidden = true;
  }
  $("weekHint").textContent = S.week === thisW ? "" : (S.week < thisW ? "Past week" : "Future week");
  $("copyLast").title = lastWeekOf(st, S.week) ? "Copy names, shifts and lunches from the week of " + weekLabel(lastWeekOf(st, S.week)) : "No earlier week saved yet";
  $("viewOnly").hidden = canWrite;
  ["suggest","balance","clear","addC","addPT","addNH","addL","addCSR","copyLast"].forEach(id => { if ($(id)) $(id).disabled = !canWrite; });
}
function renderNow(){ const n = storeNow(S.store); withWeek(n.week, () => renderNow0(n)); }
function renderNow0(n){
  const st = S.store, d = dayInfo(st, n.di), k = rk(st, n.week), saved = SAVED[k], r = saved && saved.posted ? saved : null;
  const open = !d.closed && n.t >= d.open && n.t < d.close;
  if (d.closed){ $("nowHead").innerHTML = `<b>${esc(st)}</b> · ${DAYFULL[n.di]}, ${shortDate(n.iso)} · <span class="pill">Closed for ${esc(d.name)}</span>`; $("nowBody").innerHTML = `<div class="tip info">The store is closed today for ${esc(d.name)}.</div>`; return; }
  $("nowHead").innerHTML = `<b>${esc(st)}</b> · ${DAYFULL[n.di]}, ${shortDate(n.iso)} · ${clockNow(n.t)} ${tzLabel(st)} · ` + (open ? `<span class="pill shape-both">Open until ${fmt(d.close)}</span>` : (n.t < d.open ? `<span class="pill">Opens at ${fmt(d.open)}</span>` : `<span class="pill">Closed for the day</span>`))
    + (d.cur ? ` <span class="note">Current hours until Oct 4</span>` : "") + (d.special ? ` <span class="pill tp">${esc(d.name)} hours</span>` : "");
  if (!r){ $("nowBody").innerHTML = saved
      ? `<div class="pbar draft" style="margin:0"><div><b>This week's schedule is still a draft</b><span>A leader has started the week of ${weekLabel(n.week)} but hasn't posted it. Post it in Build the week and this panel shows who's in the building.</span></div></div>`
      : `<div class="pbar draft" style="margin:0"><div><b>No schedule posted for this week</b><span>Nothing has been posted for the week of ${weekLabel(n.week)}. Once a leader posts it, this panel shows who's in the building right now.</span></div></div>`; return; }
  const groups = {floor:[], lunch:[], huddle:[], later:[], done:[], pto:[]};
  r.people.forEach(p => { const kk = p.days[n.di]; if (!kk) return; if (kk === "PTO"){ groups.pto.push({p}); return; }
    const t = tplOf(st, n.di, kk); if (!t) return;
    const lu = p.lunch && p.lunch[n.di];
    const g = n.t < t.in ? "later" : n.t < t.in + HUD(t) ? "huddle" : n.t < t.out ? (atLunch(t, lu, n.t) ? "lunch" : "floor") : "done"; groups[g].push({p, t, lu: hasLunch(t) ? lu : null}); });
  const hr = coverageDay(st, n.di, r).find(x => x.h === n.h);
  const card = (x) => `<div class="who-card ${isLead(x.p.role)?"lead":""}"><b>${esc(x.p.name || "Unnamed")}${nhPhase(x.p) === "training" ? ` <span class="nhbadge">In training</span>` : nhPhase(x.p) === "tagged" ? ` <span class="nhbadge tag">New hire</span>` : ""}${tierOf(st, x.p) ? ` <span class="tchip t-${tierOf(st, x.p)}">${tierOf(st, x.p)}</span>` : ""}</b><small>${ROLES[x.p.role]}${x.t ? " · " + clock(x.t.in) + " to " + clock(x.t.out) : ""}${x.lu != null ? " · lunch " + clock(x.lu) : ""}</small></div>`;
  const block = (title, arr, cls) => `<div class="now-group ${cls}"><h3>${title} <span>${arr.length}</span></h3>${arr.length ? `<div class="who-grid">${arr.map(card).join("")}</div>` : `<p class="note">Nobody</p>`}</div>`;
  let stats = "";
  if (open && hr){
    const tr = tier(st, n.di, n.h);
    stats = `<div class="chips" style="margin-bottom:12px">
      <div class="chip ${hr.st==="short"?"bad":hr.st==="ok"?"good":"heavy"}"><b>${hr.c}<small style="font-size:13px"> / ${hr.nd}</small></b><small>selling on the floor vs. needed, lunches counted</small></div>
      <div class="chip ${hr.l ? "good" : "bad"}"><b>${hr.l ? "Yes" : "No"}</b><small>leader in the store</small></div>
      <div class="chip"><b>${hr.g == null ? "New" : Math.round(hr.g)}</b><small>guests expected this hour${tr==="hot" ? " · hot zone" : ""}</small></div></div>`;
  }
  $("nowBody").innerHTML = stats + `<div class="now-grid">${block("On the floor now", groups.floor, "floor")}${block("At lunch", groups.lunch, "lunch")}${block("In huddle", groups.huddle, "huddle")}${block("Coming in later", groups.later, "later")}${block("Done for the day", groups.done, "done")}${block("PTO today", groups.pto, "pto")}</div>`;
}
function renderStd(){
  const locked = !!DB && !IS_OWNER;
  ["gpc","minc","target","lunch","ptoh","pttarget","nhweeks","nhtag"].forEach(id => { $(id).disabled = locked; });
  $("stdSec").classList.toggle("locked", locked);
  let when = ""; if (STD_META && STD_META.updatedAt){ when = " Last changed " + new Date(STD_META.updatedAt).toLocaleString("en-US", {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}) + "."; }
  $("stdNote").innerHTML = !DB ? "Preview mode: changes here stay on this device."
    : IS_OWNER ? `<b>You own this standard.</b> Changes apply to every store and every leader as soon as you make them.${when}`
    : `<b>Locked.</b> The staffing standard is set company-wide by Frank Pina and applies to every store.${when}`;
}
let CAL_EDIT = null;
const hourOpts = (sel, from, to) => { let o = `<option value="">Set</option>`; for (let h=from; h<=to; h++) o += `<option value="${h}" ${sel===h?"selected":""}>${h===24 ? "12 AM" : fmt(h)}</option>`; return o; };
const longDate = iso => { const [y,m,d] = iso.split("-").map(Number); const dw = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(Date.UTC(y,m-1,d)).getUTCDay()]; return dw + " " + MON[m-1] + " " + d + ", " + y; };
function tpSummary(e){
  const parts = [];
  parts.push(e.open != null ? "Open " + fmt(+e.open) : +e.earlier ? `Open ${e.earlier} ${+e.earlier===1?"hr":"hrs"} early` : "Normal open");
  parts.push(e.close != null ? "close " + (+e.close===24 ? "12 AM" : fmt(+e.close)) : +e.later ? `close ${e.later} ${+e.later===1?"hr":"hrs"} late` : "normal close");
  return parts.join(", ");
}
function renderCal(){
  const edit = !DB || IS_OWNER;
  const today = storeNow(S.store).iso, y = +today.slice(0,4), list = [];
  [y, y+1].forEach(yy => [[thanksgiving(yy),"Thanksgiving"],[yy+"-12-24","Christmas Eve"],[yy+"-12-25","Christmas Day"],[easter(yy),"Easter"]].forEach(([d,n]) => { if (d >= today && d <= addDays(today, 400)) list.push([d,n]); }));
  list.sort();
  $("calClosed").innerHTML = list.map(([d,n]) => `<div class="calrow"><b>${esc(n)}</b><span>${longDate(d)}</span></div>`).join("");
  const recs = [y, y+1].flatMap(recurringTentpoles).filter(e => e.date >= today && e.date <= addDays(today, 400)).sort((a,b) => a.date < b.date ? -1 : 1);
  $("calAuto").innerHTML = recs.map(e => { const x = explicitOn(e.date); return `<div class="calrow"><b>${esc(e.name)}</b><span>${longDate(e.date)} · ${x ? "<i>custom hours below</i>" : tpSummary(e) + (Object.keys(e.stores || {}).length ? " · Harahan 11 to 8" : "")}${!x && edit ? ` <button class="btn ghost" data-cust="${e.date}" style="padding:2px 8px;font-size:12px">Change</button>` : ""}</span></div>`; }).join("");
  const ev = CAL_EDIT || (CAL.events || []);
  const hrSel = (i, f, v, from, to) => `<select data-ce="${i}" data-f="${f}"><option value="">Normal</option>${Array.from({length:to-from+1}, (_,x) => from + x).map(h => `<option value="${h}" ${v != null && +v===h ? "selected" : ""}>${h===24 ? "12 AM" : fmt(h)}</option>`).join("")}</select>`;
  const stores = Object.keys(DATA);
  const exList = (e, i) => Object.entries(e.stores || {}).map(([st, x]) => `<span class="exc">${esc(st)}: ${x.open != null ? fmt(+x.open) : "normal"} to ${x.close != null ? (+x.close===24 ? "12 AM" : fmt(+x.close)) : "normal"}${edit ? ` <button class="icon-btn" data-exdel="${i}" data-st="${esc(st)}" aria-label="Remove ${esc(st)}">✕</button>` : ""}</span>`).join("");
  $("calTable").innerHTML = `<thead><tr><th>Date</th><th>Name</th><th>Open</th><th>Or open early</th><th>Close</th><th>Traffic lift</th>${edit ? "<th></th>" : ""}</tr></thead><tbody>` + (ev.length ? ev.map((e,i) => edit
    ? `<tr><td><input type="date" data-ce="${i}" data-f="date" value="${esc(e.date||"")}"></td><td><input data-ce="${i}" data-f="name" value="${esc(e.name||"")}" placeholder="Black Friday"></td>
       <td>${hrSel(i, "open", e.open, 6, 12)}</td><td><select data-ce="${i}" data-f="earlier">${[0,1,2,3].map(n => `<option value="${n}" ${(+e.earlier||0)===n?"selected":""}>${n ? n + (n===1?" hr":" hrs") + " early" : "No"}</option>`).join("")}</select></td>
       <td>${hrSel(i, "close", e.close, 17, 24)}</td><td><input type="number" min="0.5" max="5" step="0.25" data-ce="${i}" data-f="lift" value="${e.lift || 1}"></td><td><button class="icon-btn" data-cdel="${i}" aria-label="Remove">✕</button></td></tr>
       <tr class="exrow"><td></td><td colspan="6"><span class="note">Store exceptions:</span> ${exList(e, i) || `<span class="note">none</span>`}
         <span class="exadd"><select data-exst="${i}"><option value="">+ Store</option>${stores.map(st => `<option>${esc(st)}</option>`).join("")}</select><select data-exo="${i}">${[["","normal open"]].concat(Array.from({length:7}, (_,x) => [6+x, fmt(6+x)])).map(([v,l]) => `<option value="${v}">${l}</option>`).join("")}</select><select data-exc="${i}">${[["","normal close"]].concat(Array.from({length:8}, (_,x) => [17+x, 17+x===24 ? "12 AM" : fmt(17+x)])).map(([v,l]) => `<option value="${v}">${l}</option>`).join("")}</select><button class="btn ghost" data-exadd="${i}" style="padding:4px 10px">Add</button></span></td></tr>`
    : `<tr><td>${e.date ? longDate(e.date) : ""}</td><td><b>${esc(e.name||"")}</b></td><td colspan="3">${tpSummary(e)}${Object.keys(e.stores || {}).length ? `<br>${exList(e, i)}` : ""}</td><td>${e.lift || 1}x</td></tr>`).join("")
    : `<tr><td colspan="7" class="note">No tentpoles set.</td></tr>`) + `</tbody>`;
  $("calAdd").hidden = !edit; $("calSave").hidden = !edit;
  const unset = (CAL.events || []).filter(e => !tpActive(e));
  $("calNote").innerHTML = (edit ? `<b>You own the calendar.</b> Changes apply to every store. Leave Open and Close on Normal to use each store's own hours.` : `<b>Set company-wide by Frank Pina.</b>`) + (unset.length ? ` <b style="color:var(--short)">${unset.map(e => esc(e.name || "A tentpole")).join(", ")} ${unset.length===1?"needs":"need"} hours set. Until then ${unset.length===1?"it runs":"they run"} as a normal day.</b>` : "") + (CAL_EDIT ? ` <b style="color:var(--orange)">Unsaved changes. Click Save tentpoles.</b>` : "");
  if (!edit) return;
  const ed = () => (CAL_EDIT = CAL_EDIT || clone(CAL.events || []));
  $("calAuto").querySelectorAll("[data-cust]").forEach(b => b.addEventListener("click", () => { const d = b.dataset.cust, e = clone(recurringTentpoles(+d.slice(0,4)).find(x => x.date === d)); delete e.auto; ed().push(e); ed().sort((a,b2) => (a.date||"") < (b2.date||"") ? -1 : 1); renderCal(); toast("Added below. Change the hours, then Save tentpoles."); }));
  $("calTable").querySelectorAll("[data-ce]").forEach(el => el.addEventListener("change", () => {
    const e = ed()[+el.dataset.ce], f = el.dataset.f;
    e[f] = f === "open" || f === "close" ? (el.value === "" ? null : +el.value) : f === "lift" ? (parseFloat(el.value) || 1) : f === "earlier" ? +el.value : el.value;
    if (f === "open" && e.open != null) e.earlier = 0; if (f === "earlier" && e.earlier) e.open = null;
    renderCal(); }));
  $("calTable").querySelectorAll("[data-cdel]").forEach(b => b.addEventListener("click", () => { ed().splice(+b.dataset.cdel, 1); renderCal(); }));
  $("calTable").querySelectorAll("[data-exdel]").forEach(b => b.addEventListener("click", () => { const e = ed()[+b.dataset.exdel]; delete e.stores[b.dataset.st]; renderCal(); }));
  $("calTable").querySelectorAll("[data-exadd]").forEach(b => b.addEventListener("click", () => { const i = b.dataset.exadd, st = $("calTable").querySelector(`[data-exst="${i}"]`).value; if (!st){ toast("Pick a store"); return; }
    const o = $("calTable").querySelector(`[data-exo="${i}"]`).value, c = $("calTable").querySelector(`[data-exc="${i}"]`).value;
    const e = ed()[+i]; e.stores = e.stores || {}; e.stores[st] = {open:o === "" ? null : +o, close:c === "" ? null : +c}; renderCal(); }));
}
async function saveCal(){
  if (!CAL_EDIT) { toast("No changes to save"); return; }
  const events = CAL_EDIT.filter(e => e.date).map(e => ({date:e.date, name:e.name || "Tentpole", open:e.open == null ? null : +e.open, close:e.close == null ? null : +e.close, earlier:+e.earlier || 0, later:+e.later || 0, lift:+e.lift || 1, stores:e.stores || {}}));
  const bad = events.find(e => e.open != null && e.close != null && e.close <= e.open); if (bad){ toast("Close has to be after open for " + bad.name); return; }
  CAL = {events}; CAL_EDIT = null; resetDays();
  if (DB){ try { await DB.doc("settings/calendar").set({events, updatedAt:new Date().toISOString(), updatedBy:MYID || ""}); toast("Tentpoles saved for every store"); } catch(e){ toast("Only the owner can change the calendar"); } }
  else { try { localStorage.setItem("ss-cal", JSON.stringify(CAL)); } catch(e) {} toast("Saved on this device (preview)"); }
  renderAll();
}
/* ---------- schedule grade ----------
   Guest coverage 40 (hot-zone hours count double) · Leader in store 25 · Hours targets 15 · Posted on time 10 · Not overstaffed 10.
   A leader in the store every hour is a must: any gap caps the grade at a C. */
const LETTER = sc => sc >= 90 ? "A" : sc >= 80 ? "B" : sc >= 70 ? "C" : sc >= 60 ? "D" : "F";
function gradeOf(store, week, r){
  return withWeek(week, () => {
    if (!r || !r.people || !r.people.some(p => p.days.some(Boolean))) return {none:true, score:0, letter:"–"};
    const cov = [0,1,2,3,4,5,6].map(di => coverageDay(store, di, r)), all = [];
    cov.forEach((rows, di) => rows.forEach(x => all.push({...x, di, hot: tier(store, di, x.h) === "hot"})));
    if (!all.length) return {none:true, score:0, letter:"–"};
    let wt = 0, ok = 0; all.forEach(x => { const w = x.hot ? 2 : 1; wt += w; if (x.st !== "short") ok += w; });
    const covPts = 35 * ok / wt;
    const gapHrs = all.filter(x => x.l === 0).length, leadPts = 20 * (1 - gapHrs / all.length);
    const hp = r.people.filter(p => hourly(p.role)), atT = hp.filter(p => ["ok","near"].includes(statusOf(store, p))).length, hrsPts = hp.length ? 10 * atT / hp.length : 10;
    const mx = mixSummary(store, r), ratedAll = mx.sellers && mx.rated === mx.sellers;
    const mixPts = !mx.rated ? 0 : (mx.rated / mx.sellers) * (7 * (mx.hot ? 1 - mx.noHigh / mx.hot : 1) + 4 * (mx.open ? 1 - mx.weak / mx.open : 1) + 4 * (mx.nhH ? 1 - mx.nhAlone / mx.nhH : 1));
    const onTime = r.posted ? (!r.postedAt || r.postedAt.slice(0,10) < week ? 10 : 5) : 0;
    const heavy = all.filter(x => x.st === "heavy").length, shortN = all.filter(x => x.st === "short").length;
    const effPts = shortN ? Math.max(0, 10 * (1 - Math.min(heavy, shortN) / Math.max(1, all.length * 0.1))) : 10;   // extra people in light hours only cost points while other hours are short
    let score = Math.round(covPts + leadPts + mixPts + hrsPts + onTime + effPts);
    const capped = gapHrs > 0 && score > 79; if (capped) score = 79;
    const short = all.filter(x => x.st === "short").length, hotShort = all.filter(x => x.st === "short" && x.hot).length;
    return {score, letter:LETTER(score), capped, parts:[
      {k:"Guest coverage", pts:covPts, max:35, why: short ? `${short} short ${short===1?"hour":"hours"}${hotShort ? `, ${hotShort} in hot zones` : ""}` : "Every hour covered"},
      {k:"Leader in store", pts:leadPts, max:20, why: gapHrs ? `${gapHrs} ${gapHrs===1?"hour":"hours"} with no leader. Caps the grade at C.` : "Leader in every open hour"},
      {k:"Talent mix", pts:mixPts, max:15, why: !mx.rated ? "Team not rated yet. Rate everyone High, Middle or Low." : [!ratedAll ? `${mx.sellers - mx.rated} not rated` : "", mx.noHigh ? `${mx.noHigh} hot-zone ${mx.noHigh===1?"hour":"hours"} with no High` : "", mx.weak ? `${mx.weak} ${mx.weak===1?"hour":"hours"} with Lows outnumbering Highs and Middles` : "", mx.nhAlone ? `${mx.nhAlone} new-hire ${mx.nhAlone===1?"hour":"hours"} with no High or Middle` : ""].filter(Boolean).join(" · ") || "Highs in every hot zone, new hires paired"},
      {k:"Hours targets", pts:hrsPts, max:10, why: `${atT} of ${hp.length} at their hours target`},
      {k:"Posted on time", pts:onTime, max:10, why: !r.posted ? "Not posted" : onTime === 10 ? "Posted before the week started" : "Posted after the week started"},
      {k:"Right hours", pts:effPts, max:10, why: shortN && heavy ? `${heavy} heavy ${heavy===1?"hour":"hours"} while ${shortN} ${shortN===1?"is":"are"} short. Move people to the short hours.` : "Extra people aren't taken from short hours"}], short, gapHrs, posted:!!r.posted, mix:mx};
  });
}
/* How close the posted week is to what the tool would suggest for this team: hour-by-hour floor counts. */
const _sug = {};
function floorCounts(store, people){ const out = []; for (let di=0; di<7; di++){ const d = dayInfo(store, di); if (d.closed) continue; for (let h=d.open; h<d.close; h++){ let c = 0; people.forEach(p => { const k = p.days[di]; const t = k && k !== "PTO" && tplOf(store, di, k); if (t && isCounted(p) && onFloor(t, h)) c++; }); out.push(c); } } return out; }
function matchOf(store, week, r){
  if (!r || !r.people.some(p => p.days.some(Boolean))) return null;
  return withWeek(week, () => {
    const key = store + "|" + week + "|" + JSON.stringify(TEAMS[store] || {}) + "|" + S.gpc + S.minc + S.target + "|" + JSON.stringify(CAL.events);
    const sp = _sug[key] || (_sug[key] = floorCounts(store, suggest(store, week, true)));
    const pp = floorCounts(store, r.people);
    const tot = sp.reduce((a,b) => a+b, 0) || 1, diff = sp.reduce((a,v,i) => a + Math.abs(v - (pp[i] || 0)), 0);
    return Math.max(0, Math.round(100 * (1 - diff / tot)));
  });
}
function actualOf(store, week, r){
  if (!r || !ACTUALS[rk(store, week)]) return null;
  const g = withActual(store, week, () => gradeOf(store, week, r));
  const f = withWeek(week, () => { let s = 0; for (let di=0; di<7; di++){ const d = dayInfo(store, di); for (let h=d.open; h<d.close; h++) s += guests(store, di, h) || 0; } return s; });
  const a = withActual(store, week, () => { let s = 0; for (let di=0; di<7; di++){ const d = dayInfo(store, di); for (let h=d.open; h<d.close; h++) s += guests(store, di, h) || 0; } return s; });
  return {g, forecast:Math.round(f), actual:Math.round(a), diff: f ? Math.round(100 * (a - f) / f) : 0};
}
function renderGrade(){
  const st = S.store, r = SAVED[rk(st, S.week)] || roster(st), g = gradeOf(st, S.week, r);
  if (g.none){ $("gradeCard").innerHTML = `<div class="gletter g-none">–</div><div><b>No schedule to grade yet</b><p class="note" style="margin:4px 0 0">Build and post the week to get a grade.</p></div>`; return; }
  const fix = g.parts.filter(p => p.pts < p.max - 0.5).sort((a,b) => (b.max - b.pts) - (a.max - a.pts)).slice(0,2);
  const m = matchOf(st, S.week, r), act = actualOf(st, S.week, r), wl = wlbSummary(st, r);
  const extra = `<div class="gextra">
      <div class="gx"><span>Match to suggested</span><b>${m == null ? "–" : m + "%"}</b><small>How close the floor is, hour by hour, to the roster the tool suggests for this team.</small></div>
      <div class="gx"><span>Actual grade</span><b>${act ? `<span class="gpill g-${act.g.letter}">${act.g.letter}</span> ${act.g.score}` : "Waiting"}</b><small>${act ? `Graded against real traffic: ${act.actual} guests vs ${act.forecast} forecast (${act.diff > 0 ? "+" : ""}${act.diff}%). ${act.g.short} short ${act.g.short===1?"hour":"hours"}.` : "Shows once this week's traffic is uploaded."}</small></div>
      <div class="gx"><span>Days off together</span><b>${wl.together}/${wl.n}</b><small>${wl.split.length ? "Split days off: " + esc(wl.split.slice(0,4).join(", ")) + (wl.split.length>4 ? " and more" : "") + "." : "Everyone's days off are back to back."}${wl.clopen.length ? " Close then open: " + esc(wl.clopen.slice(0,3).join(", ")) + "." : ""}</small></div></div>`;
  $("gradeCard").innerHTML = `<div class="gletter g-${g.letter}">${g.letter}</div>
    <div class="gbody"><div class="ghead"><b>Schedule grade: ${g.score} of 100</b>${!r.posted ? ` <span class="status draft">Draft · grade counts once posted</span>` : ""}${g.capped ? ` <span class="status draft" style="background:var(--short-bg);color:var(--short)">Capped at C: leader gap</span>` : ""}</div>
    <div class="gparts">${g.parts.map(p => `<div class="gpart"><div class="gtop"><span>${p.k}</span><b>${Math.round(p.pts)}/${p.max}</b></div><div class="gbar"><i style="width:${Math.max(2, 100*p.pts/p.max)}%" class="${p.pts >= p.max*0.9 ? "ok" : p.pts >= p.max*0.7 ? "mid" : "low"}"></i></div><small>${esc(p.why)}</small></div>`).join("")}</div>
    ${fix.length ? `<p class="note" style="margin:8px 0 0"><b>Biggest lift:</b> ${fix.map(p => esc(p.k.toLowerCase()) + " (" + esc(p.why) + ")").join("; ")}.</p>` : ""}${extra}</div>`;
}
/* Company scoreboard: every store's schedule for the selected week, graded the same way. */
const WEEKDOCS = {}; let GW = null, gwUnsub = null, gwUnsub2 = null;
function subscribeWeek(){
  if (!DB || GW === S.week) return;
  GW = S.week; if (gwUnsub) { try { gwUnsub(); } catch(e) {} }
  const w = GW; Object.keys(WEEKDOCS).forEach(k => delete WEEKDOCS[k]);
  if (gwUnsub2) { try { gwUnsub2(); } catch(e) {} }
  gwUnsub2 = DB.collection("actuals").where("week", "==", w).onSnapshot(snap => { if (w !== GW) return; snap.docs.forEach(doc => { const d = doc.data() || {}; if (d.store) ACTUALS[rk(d.store, w)] = {g:d.g || {}, source:d.source, uploadedAt:d.uploadedAt}; }); renderAll(); }, () => {});
  gwUnsub = DB.collection("rosters").where("week", "==", w).onSnapshot(snap => {
    if (w !== GW) return;
    snap.docs.forEach(doc => { const d = doc.data() || {}; if (d.store && DATA[d.store]) WEEKDOCS[d.store] = {posted: d.posted !== false, postedAt: d.postedAt || null, people: withWeek(w, () => fillLunches(d.store, clone(d.people || [])))}; });
    renderBoard();
  }, () => {});
}
function renderBoard(){
  subscribeWeek();
  const w = S.week, rows = Object.keys(DATA).map(st => { const r = st === S.store ? (SAVED[rk(st, w)] || null) : (WEEKDOCS[st] || SAVED[rk(st, w)] || null); const g = gradeOf(st, w, r); return {st, g, r, region: DATA[st].region}; });
  rows.sort((a,b) => (b.g.none ? -1 : b.g.score) - (a.g.none ? -1 : a.g.score) || a.st.localeCompare(b.st));
  const graded = rows.filter(x => !x.g.none), avg = graded.length ? Math.round(graded.reduce((a,x) => a + x.g.score, 0) / graded.length) : null;
  const posted = rows.filter(x => x.r && x.r.posted).length;
  $("boardHead").innerHTML = `Week of ${weekLabel(w)} · <b>${posted} of ${rows.length}</b> stores posted${avg != null ? ` · company average <b>${avg} (${LETTER(avg)})</b>` : ""}${DB ? "" : " · preview shows only this device"}`;
  $("boardTable").innerHTML = `<thead><tr><th>#</th><th style="text-align:left">Store</th><th>Grade</th><th>Score</th><th>Match to suggested</th><th>Actual grade</th><th>Status</th><th>Short hrs</th><th>No-leader hrs</th></tr></thead><tbody>` + rows.map((x,i) => `<tr class="${x.st === S.store ? "me" : ""}" data-st="${esc(x.st)}"><td>${x.g.none ? "" : i+1}</td><td style="text-align:left"><b>${esc(x.st)}</b></td>
    <td><span class="gpill g-${x.g.none ? "none" : x.g.letter}">${x.g.letter}</span></td><td>${x.g.none ? "" : x.g.score}</td>
    <td>${x.g.none ? "" : (matchOf(x.st, w, x.r) ?? "") + "%"}</td>
    <td>${(() => { const a = x.g.none ? null : actualOf(x.st, w, x.r); return a ? `<span class="gpill g-${a.g.letter}">${a.g.letter}</span> ${a.g.score}` : `<span class="note">${ACTUALS[rk(x.st, w)] ? "" : "No traffic yet"}</span>`; })()}</td>
    <td>${!x.r ? `<span class="note">Not started</span>` : x.r.posted ? `<span class="status posted">Posted</span>` : `<span class="status draft">Draft</span>`}</td>
    <td class="${x.g.short ? "bad" : ""}">${x.g.none ? "" : x.g.short}</td><td class="${x.g.gapHrs ? "bad" : ""}">${x.g.none ? "" : x.g.gapHrs}</td></tr>`).join("") + `</tbody>`;
  $("boardTable").querySelectorAll("tr[data-st]").forEach(tr => tr.addEventListener("click", () => { S.store = tr.dataset.st; save(); subscribe(); renderAll(); window.scrollTo({top:0, behavior:"smooth"}); }));
}
/* ---------- actual traffic upload ---------- */
let CAN_ADMIN = false, ACT_PENDING = null;
const normStore = x => String(x).toLowerCase().replace(/ashley|homestore|furniture|store/g, "").replace(/[^a-z]+/g, " ").trim();
function matchStore(name){
  const n = normStore(name); if (!n) return null;
  const keys = Object.keys(DATA);
  return keys.find(k => normStore(k) === n) || keys.filter(k => n.includes(normStore(k)) || normStore(k).includes(n)).sort((a,b) => b.length - a.length)[0] || null;
}
function parseDate(x){
  x = String(x).trim(); let m;
  if ((m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  if ((m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`; }
  return null;
}
function parseHour(x){
  const m = String(x).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/); if (!m) return null;
  let h = +m[1]; const ap = m[3]; if (ap && ap[0] === "p" && h < 12) h += 12; if (ap && ap[0] === "a" && h === 12) h = 0;
  return h >= 0 && h <= 23 ? h : null;
}
function splitCSV(line){ const out = []; let cur = "", q = false; for (let i=0; i<line.length; i++){ const ch = line[i]; if (q){ if (ch === '"' && line[i+1] === '"'){ cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(v => v.trim()); }
function parseTraffic(text, half){
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim()); if (lines.length < 2) return {err:"The file is empty."};
  const hdr = splitCSV(lines[0]).map(h => h.toLowerCase());
  const iS = hdr.findIndex(h => /store|location|site/.test(h)), iD = hdr.findIndex(h => /date|day/.test(h));
  if (iS < 0 || iD < 0) return {err:"The file needs a store column and a date column."};
  const iH = hdr.findIndex(h => /^hour|^time|interval/.test(h)), iC = hdr.findIndex(h => /guest|traffic|count|visitor|enter|in$|ins|total/.test(h));
  const wide = iH < 0 ? hdr.map((h,i) => ({i, h:parseHour(h)})).filter(x => x.i !== iS && x.i !== iD && x.h != null) : [];
  if (iH < 0 && !wide.length) return {err:"Couldn't find an hour column or hour columns."};
  if (iH >= 0 && iC < 0) return {err:"Couldn't find the guest count column (guests, traffic, count or visitors)."};
  const out = {}, unknown = new Set(); let rows = 0;
  const addTo = (st, iso, h, v) => {
    const [y,mo,d] = iso.split("-").map(Number), dow = new Date(Date.UTC(y, mo-1, d)).getUTCDay(), di = (dow + 6) % 7, wk = addDays(iso, -di);
    const k = rk(st, wk), o = out[k] || (out[k] = {store:st, week:wk, g:{}}); const day = o.g[di] || (o.g[di] = {});
    const val = v / (half && /ShopperTrak/i.test(DATA[st].src) ? 2 : 1); day[h] = Math.round(((day[h] || 0) + val) * 10) / 10; rows++;
  };
  lines.slice(1).forEach(l => { const c = splitCSV(l); const st = matchStore(c[iS]); const iso = parseDate(c[iD]); if (!c[iS]) return; if (!st){ unknown.add(c[iS]); return; } if (!iso) return;
    if (iH >= 0){ const h = parseHour(c[iH]), v = parseFloat(String(c[iC]).replace(/,/g, "")); if (h != null && isFinite(v)) addTo(st, iso, h, v); }
    else wide.forEach(x => { const v = parseFloat(String(c[x.i]).replace(/,/g, "")); if (isFinite(v)) addTo(st, iso, x.h, v); }); });
  return {docs:Object.values(out), rows, unknown:[...unknown]};
}
function renderActuals(){
  const k = rk(S.store, S.week), a = ACTUALS[k];
  const canUp = !DB || IS_OWNER || CAN_ADMIN;
  $("actUpload").hidden = !canUp;
  const have = Object.keys(DATA).filter(st => ACTUALS[rk(st, S.week)]).length;
  $("actStatus").innerHTML = `<b>Week of ${weekLabel(S.week)}:</b> traffic uploaded for ${have} of ${Object.keys(DATA).length} stores.` + (a ? ` ${esc(S.store)} uploaded${a.uploadedAt ? " " + new Date(a.uploadedAt).toLocaleString("en-US", {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}) : ""}.` : ` Nothing yet for ${esc(S.store)}.`) + (canUp ? "" : " Uploads are done by Frank Pina or an admin.");
  const pv = $("actPreview");
  if (!ACT_PENDING){ pv.innerHTML = ""; return; }
  if (ACT_PENDING.err){ pv.innerHTML = `<div class="tip shortmsg" style="margin-top:10px">${esc(ACT_PENDING.err)}</div>`; return; }
  const byWeek = {}; ACT_PENDING.docs.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d.store); });
  pv.innerHTML = `<div class="tip info" style="margin-top:10px"><b>Ready to save:</b> ${ACT_PENDING.rows} hourly counts, ${ACT_PENDING.docs.length} store weeks.<span>${Object.entries(byWeek).sort().map(([w, ss]) => `Week of ${weekLabel(w)}: ${ss.length} ${ss.length===1?"store":"stores"}`).join(" · ")}${ACT_PENDING.unknown.length ? `<br><b style="color:var(--short)">Not matched to a store, skipped:</b> ${esc(ACT_PENDING.unknown.slice(0,8).join(", "))}` : ""}</span>
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn" id="actSave">Save traffic</button><button class="btn ghost" id="actCancel">Cancel</button></div></div>`;
  $("actSave").addEventListener("click", saveActuals); $("actCancel").addEventListener("click", () => { ACT_PENDING = null; renderActuals(); });
}
async function saveActuals(){
  const docs = ACT_PENDING.docs; let ok = 0, fail = 0;
  for (const d of docs){
    const body = {store:d.store, week:d.week, g:d.g, source:/ShopperTrak/i.test(DATA[d.store].src) ? "ShopperTrak" : "eTrax", uploadedAt:new Date().toISOString(), uploadedBy:MYID || ""};
    ACTUALS[rk(d.store, d.week)] = {g:d.g, source:body.source, uploadedAt:body.uploadedAt};
    if (DB){ try { await DB.doc("actuals/" + slug(d.store) + "__" + d.week).set(body); ok++; } catch(e){ fail++; } }
    else { try { localStorage.setItem("ss-act:" + rk(d.store, d.week), JSON.stringify(body)); ok++; } catch(e){ fail++; } }
  }
  ACT_PENDING = null; renderAll();
  toast(fail ? `Saved ${ok}, ${fail} failed. Only Frank Pina or an admin can upload.` : `Traffic saved for ${ok} store ${ok===1?"week":"weeks"}`);
}
function renderAll(){
  renderOverview(); renderShapes(); renderMenu(); renderTeam(); renderRoster(); renderCoverage(); renderStatus(); renderNow(); renderGrade(); renderBoard(); renderActuals();
  renderStd(); $("gpc").value = S.gpc; $("minc").value = S.minc; $("target").value = S.target; $("lunch").value = S.lunch; $("ptoh").value = S.pto; $("pttarget").value = S.ptTarget; $("nhweeks").value = S.nhWeeks; $("nhtag").value = S.nhTagWeeks; renderCal();
}
function toast(m){ const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 1800); }

$("store").addEventListener("change", e => { S.store = e.target.value; S.week = storeNow(S.store).week; save(); subscribe(); renderAll(); });
$("weekPrev").addEventListener("click", () => { S.week = addDays(S.week, -7); renderAll(); });
$("weekNext").addEventListener("click", () => { S.week = addDays(S.week, 7); renderAll(); });
$("weekNow").addEventListener("click", () => { S.week = storeNow(S.store).week; renderAll(); });
function postWeek(){ const r = roster(S.store); commit(S.store, S.week, r, true); renderAll();
  const gaps = leaderGaps(S.store, [0,1,2,3,4,5,6].map(di => coverageDay(S.store, di)));
  toast(gaps.length ? `Posted, but ${gaps.length} ${gaps.length===1?"stretch has":"stretches have"} no leader in the store. Check Coach's corner.` : "Schedule posted. Your team can see it now."); }
$("postBtn").addEventListener("click", postWeek);
$("postBtn2").addEventListener("click", postWeek);
$("unpost").addEventListener("click", () => { const r = roster(S.store); r.posted = false; r.postedAt = null; commit(S.store, S.week, r); renderAll(); toast("Moved back to draft. Your team can't see it until you post again."); });
$("weekSel").addEventListener("change", e => { S.week = e.target.value; renderAll(); });
$("copyLast").addEventListener("click", () => {
  const lw = lastWeekOf(S.store, S.week); if (!lw) { toast("No earlier week saved for this store yet"); return; }
  const src = SAVED[rk(S.store, lw)], k = rk(S.store, S.week);
  if (SAVED[k] && SAVED[k].people.some(p => p.days.some(Boolean)) && !confirmCopy()) return;
  const notes = [];
  const r = {posted: SAVED[k] ? SAVED[k].posted : false, people: src.people.map(p => {
    const days = p.days.map((x, di) => { if (x === "PTO") return ""; const m = remapShift(S.store, lw, S.week, di, x); if (m.note) notes.push(p.name + " " + m.note); return m.k; });
    const lunch = (p.lunch || Array(7).fill(null)).map((l, di) => days[di] === p.days[di] ? l : null);
    const o = {name:p.name, role:p.role, days, lunch}; if (p.nh){ o.nh = true; if (p.nhStart) o.nhStart = p.nhStart; } return o; })};
  fillLunches(S.store, r.people); COPY_NOTES[k] = notes; commit(S.store, S.week, r); renderAll();
  toast("Copied the week of " + weekLabel(lw) + ". PTO was left off." + (notes.length ? " " + notes.length + " shifts moved to fit this week's hours. See Coach's corner." : ""));
});
let _copyArm = 0;
function confirmCopy(){ if (Date.now() - _copyArm < 4000) return true; _copyArm = Date.now(); toast("This week already has shifts. Click Copy last week again to replace them."); return false; }
$("vGuests").addEventListener("click", () => { S.view = "guests"; save(); renderOverview(); });
$("vNeed").addEventListener("click", () => { S.view = "need"; save(); renderOverview(); });
$("suggest").addEventListener("click", () => { const k = rk(S.store, S.week), fresh = {example:true, posted:false, people:suggest(S.store, S.week)};
  if (SAVED[k]){ fresh.posted = SAVED[k].posted; commit(S.store, S.week, fresh); toast(fresh.posted ? "Schedule rebuilt. It's still posted." : "Suggested roster saved as a draft. Post it when it looks right."); } else { DRAFTS[k] = fresh; toast("Suggested roster ready. Post it when it looks right."); }
  renderAll(); });
$("clear").addEventListener("click", () => { const r = roster(S.store); r.people.forEach(p => p.days = Array(7).fill("")); commit(S.store, S.week, r); renderAll(); toast("Week cleared"); });
function add(role, nh){ const r = roster(S.store); const n = (nh ? r.people.filter(p => p.nh).length : r.people.filter(p => p.role===role).length) + 1;
  const np = {name:nh ? "New hire " + n : ({L:"Leader ", PT:"Part-timer ", CSR:"CSR "}[role] || "Consultant ") + n, role, days:Array(7).fill(""), lunch:Array(7).fill(null)};
  if (nh){ np.nh = true; np.nhStart = S.week; }
  r.people.push(np); commit(S.store, S.week, r); renderAll();
  const el = $("nm" + (r.people.length-1)); if (el){ el.focus(); el.select(); } }
$("addC").addEventListener("click", () => add("C"));
$("addL").addEventListener("click", () => add("L"));
$("addPT").addEventListener("click", () => add("PT"));
(() => { if ($("addCSR")) return; const b = document.createElement("button"); b.className = "btn ghost"; b.id = "addCSR"; b.textContent = "+ Add CSR"; $("addL").after(b); b.addEventListener("click", () => add("CSR"));
  const st = document.createElement("style"); st.textContent = `.roster td.dy select.k-X,.mshift.k-X{background:#FFF4E6;color:#8A4B0F;border-color:#F68C2C}
  .roster td.dy select.k-F,.mshift.k-F{background:#DBECF1;color:#003B4A;border-color:#3F738D} .tag.F{background:#DBECF1;color:#003B4A} .tag.X{background:#FFF4E6;color:#8A4B0F}
  .roster td.dy .adj{display:flex;flex-direction:column;gap:2px;margin-top:3px} .roster td.dy .adj select{min-width:0;width:100%;font-size:11px;padding:3px 1px;border:1px solid #F68C2C;border-radius:5px;background:var(--surface);color:var(--ink);font-weight:600}
  :root[data-theme="dark"] .roster td.dy select.k-X{background:#4A2E12;color:#FCD9B4} @media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .roster td.dy select.k-X{background:#4A2E12;color:#FCD9B4}}`; document.head.appendChild(st); })();
$("addNH").addEventListener("click", () => add("C", true));
$("calAdd").addEventListener("click", () => { CAL_EDIT = CAL_EDIT || clone(CAL.events || []); CAL_EDIT.push({date:"", name:"", open:null, close:null, earlier:0, lift:1, stores:{}}); renderCal(); });
$("calSave").addEventListener("click", saveCal);
$("actFile").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (!f) return; const rd = new FileReader();
  rd.onload = () => { ACT_PENDING = parseTraffic(String(rd.result || ""), $("actHalf").checked); renderActuals(); }; rd.readAsText(f); e.target.value = ""; });
try { for (let i=0; i<localStorage.length; i++){ const key = localStorage.key(i); if (key && key.startsWith("ss-act:")){ const d = JSON.parse(localStorage.getItem(key)); ACTUALS[key.slice(7)] = {g:d.g, source:d.source, uploadedAt:d.uploadedAt}; } } } catch(e) {}
try { const raw = localStorage.getItem("ss-cal"); if (raw) CAL = JSON.parse(raw); } catch(e) {}
try { Object.keys(DATA).forEach(st => { const raw = localStorage.getItem("ss-perf:" + st); if (raw) PERF[st] = JSON.parse(raw); }); } catch(e) {}
$("cvCount").addEventListener("click", () => { S.cview = "count"; renderCoverage(); });
$("cvMix").addEventListener("click", () => { S.cview = "mix"; renderCoverage(); });
$("balance").addEventListener("click", () => { const r = roster(S.store); const res = optimizeWeek(S.store, r.people); if (!res.moved){ toast("This week is already as balanced as these shifts allow"); return; }
  fillLunches(S.store, r.people); commit(S.store, S.week, r); renderAll(); toast(res.moved + " shift " + (res.moved===1 ? "swap" : "swaps") + " made. Coverage and hours didn't change."); });
[["gpc","gpc"],["minc","minc"],["target","target"],["lunch","lunch"],["ptoh","pto"],["pttarget","ptTarget"],["nhweeks","nhWeeks"],["nhtag","nhTagWeeks"]].forEach(([id,k]) => $(id).addEventListener("change", e => {
  if (!IS_OWNER && DB){ e.target.value = S[k]; return; }
  const v = parseFloat(e.target.value); if (v >= 0 && !(k === "gpc" && v <= 0)) { S[k] = v; _recCache = {}; Object.keys(DRAFTS).forEach(x => delete DRAFTS[x]); saveStd(); renderAll(); } }));
$("copy").addEventListener("click", () => { const txt = $("planText").value;
  try { navigator.clipboard.writeText(txt).then(() => toast("Week plan copied"), () => { $("planText").select(); toast("Select all and copy"); }); }
  catch(e){ $("planText").select(); toast("Select all and copy"); } });
subscribe();
renderAll();
setInterval(renderNow, 60000);
(async () => {
  const use = n => (window.claude && window.claude.use) ? window.claude.use(n).catch(() => null) : Promise.resolve(null);
  DB = await use("db"); USER = await use("user");
  if (USER){ try { MYID = (await USER.id()) || ""; } catch(e) {} try { const cw = await USER.can("data.write"); if (cw === false) canWrite = false; } catch(e) {} try { IS_OWNER = !!(await USER.isOwner()); } catch(e) {} try { CAN_ADMIN = !!(await USER.canEdit()); } catch(e) {} }
  LIVE = !!DB;
  if (DB){ DB.collection("perf").onSnapshot(snap => { snap.docs.forEach(doc => { const d = doc.data() || {}; if (d.store) PERF[d.store] = clone(d.tiers || {}); }); renderAll(); }, () => {}); }
  if (DB){ DB.doc("settings/calendar").onSnapshot(snap => { const d = snap.exists ? snap.data() : null; const ev = (d && Array.isArray(d.events)) ? d.events : []; if (JSON.stringify(ev) !== JSON.stringify(CAL.events)){ CAL = {events:ev}; resetDays(); } renderAll(); }, () => {}); }
  if (DB){ DB.doc("settings/standard").onSnapshot(snap => { if (applyStd(snap.exists ? snap.data() : null) || true) renderAll(); }, () => {}); }
  subscribe(); renderAll();
})();
