/* Household Ledger v2 — income, spending, budgets, trips, cards, supplies and reports, synced with Firebase. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const ymOf = d => (d || "").slice(0,7);
const TABS = ["overview","money","budget","reports","trips","cards","supplies"];

let month = todayISO().slice(0,7);
let tab = "overview";
let screen = "loading";      // loading | setup | signin | verify | notmember | error | app
let authMode = "signin", authMsg = "";
let H = null, unsubs = [];
const S = { expenses: [], income: [], cats: [], items: [], trips: [], cards: [], settings: { currency: "$" }, got: {}, fresh: {}, confirmedEmpty: false };
const ui = {
  msg: "", confirmDel: null, restockOpen: null, supplyFilter: "all",
  txType: "expense", moneyView: "category", open: new Set(["inc","sup-grocery","sup-household"]),
  period: "6m", incTrips: true, drillYm: null, drillGroup: null, drillCat: null, showTable: false,
  tripOpen: null, cardOpen: null
};
const pendingQty = {}; const qtyTimers = {};

/* ---------- categories & groups ---------- */
const GROUP_ORDER = ["Food","Home","Transport","Personal","Fun","Travel","Savings","Other"];
const DEFAULT_GROUP = { groceries:"Food", "eating-out":"Food", household:"Home", utilities:"Home", rent:"Home", internet:"Home",
  transport:"Transport", fuel:"Transport", health:"Personal", clothing:"Personal", entertainment:"Fun", subscriptions:"Fun", travel:"Travel", savings:"Savings", other:"Other" };
const SUGGESTED_CATS = [
  ["groceries","Groceries","Food",400],["eating-out","Eating out","Food",60],
  ["rent","Rent / mortgage","Home",0],["utilities","Utilities","Home",150],["internet","Internet & phone","Home",60],["household","Household supplies","Home",80],
  ["fuel","Fuel","Transport",80],["transport","Transport","Transport",120],
  ["health","Health","Personal",40],["clothing","Clothing","Personal",40],
  ["entertainment","Entertainment","Fun",40],["subscriptions","Subscriptions","Fun",25],
  ["travel","Travel","Travel",0],["savings","Savings transfer","Savings",0],["other","Other","Other",50]];
const INCOME_SOURCES = ["Salary","Freelance","Business","Gift","Refund","Interest","Other"];
const CARD_KINDS = { debit:"Debit card", credit:"Credit card", bank:"Bank account", cash:"Cash", mobile:"Mobile money" };

function groupOfCat(c){ return (c && (c.group || DEFAULT_GROUP[c.id])) || "Other"; }
function catById(id){ return S.cats.find(c => c.id === id); }
function catName(id){ const c = catById(id); return c ? c.name : (id ? "Other" : "Uncategorized"); }
function groupOfExp(e){ return groupOfCat(catById(e.category)); }
function groupsInUse(){ const g = new Set(S.cats.map(groupOfCat)); return [...GROUP_ORDER.filter(x => g.has(x)), ...[...g].filter(x => !GROUP_ORDER.includes(x)).sort()]; }
function groupColor(g){ let i = GROUP_ORDER.indexOf(g); if (i < 0){ let h = 0; for (const ch of g) h = (h*31 + ch.charCodeAt(0)) >>> 0; i = h % 8; } return `var(--s${i+1})`; }
function tripById(id){ return S.trips.find(t => t.id === id); }
function cardById(id){ return S.cards.find(c => c.id === id); }

/* ---------- icons ---------- */
const P = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  overview: P('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'),
  money: P('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M7 15h3"/>'),
  budget: P('<path d="M12 3v9l6.4 6.4"/><circle cx="12" cy="12" r="9"/>'),
  reports: P('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
  trips: P('<path d="M10.5 13.5 3 11l1.5-1.5 7 1L16 6c1-1 2.6-1.4 3.3-.7.7.7.3 2.3-.7 3.3l-4.5 4.5 1 7L13.6 21.6 11 14"/>'),
  cards: P('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h4"/>'),
  supplies: P('<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  camera: P('<path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>'),
  upload: P('<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  income: P('<path d="M12 4v13"/><path d="m6 11 6 6 6-6"/><path d="M5 20h14"/>'),
  expense: P('<path d="M12 20V7"/><path d="m6 13 6-6 6 6"/><path d="M5 4h14"/>'),
  wallet: P('<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6"/><circle cx="16" cy="13.5" r="1.2"/>'),
  piggy: P('<path d="M19 9.5c1 .6 1.6 1.3 2 2.5h1v3h-1.5c-.5 1-1.3 1.8-2.5 2.4V20h-3v-2h-4v2h-3v-2.8C5.3 16 4 14 4 12c0-3.3 3.6-6 8-6 1 0 2 .1 3 .4L18 5v4.5Z"/><circle cx="16" cy="11" r=".6" fill="currentColor"/>'),
  more: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  Food: P('<path d="M4 9h16l-1.5 10.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5Z"/><path d="M8 9 10 4M16 9l-2-5"/>'),
  Home: P('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>'),
  Transport: P('<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v2.5H3z"/><circle cx="7.5" cy="13" r=".8" fill="currentColor"/><circle cx="16.5" cy="13" r=".8" fill="currentColor"/>'),
  Personal: P('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  Fun: P('<path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7Z"/>'),
  Travel: P('<path d="M10.5 13.5 3 11l1.5-1.5 7 1L16 6c1-1 2.6-1.4 3.3-.7.7.7.3 2.3-.7 3.3l-4.5 4.5 1 7L13.6 21.6 11 14"/>'),
  Savings: P('<path d="M19 9.5c1 .6 1.6 1.3 2 2.5h1v3h-1.5c-.5 1-1.3 1.8-2.5 2.4V20h-3v-2h-4v2h-3v-2.8C5.3 16 4 14 4 12c0-3.3 3.6-6 8-6 1 0 2 .1 3 .4L18 5v4.5Z"/>'),
  Other: P('<path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.2"/>')
};
const TAB_LABEL = { overview:"Home", money:"Money", budget:"Budget", reports:"Reports", trips:"Trips", cards:"Cards", supplies:"Supplies" };
function buildNav(){
  $("#tabs").innerHTML = TABS.map(t => `<a href="#${t}" data-tab="${t}">${ICON[t]}${TAB_LABEL[t]}${t==="supplies"?'<span class="dot" data-low hidden></span>':""}</a>`).join("");
  const bottom = ["overview","money","reports","trips","supplies"];
  $("#bottombar").innerHTML = bottom.map(t => `<a href="#${t}" data-tab="${t}">${ICON[t]}<span>${TAB_LABEL[t]}</span>${t==="supplies"?'<span class="dot" data-low hidden></span>':""}</a>`).join("") + `<a href="#more" data-tab="more" data-act="sheet" data-s="more">${ICON.more}<span>More</span></a>`;
  $("#fab").innerHTML = ICON.plus;
}
function groupIcon(g){ return ICON[g] || ICON.Other; }

/* ---------- Firebase ---------- */
const CFG = window.FIREBASE_CONFIG || {};
const configured = CFG.apiKey && !String(CFG.apiKey).startsWith("PASTE");
let auth = null, fs = null;
if (configured) {
  firebase.initializeApp(CFG);
  auth = firebase.auth();
  fs = firebase.firestore();
  fs.enablePersistence({ synchronizeTabs: true }).catch(() => {});
}

/* ---------- helpers ---------- */
function money(n, compact){
  const c = S.settings.currency || "$";
  const a = Math.abs(n);
  if (compact && a >= 1000) return (n < 0 ? "−" : "") + c + (a >= 1e6 ? (a/1e6).toFixed(1).replace(/\.0$/,"") + "M" : (a/1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/,"") + "k");
  const v = a.toLocaleString(undefined,{minimumFractionDigits: compact ? 0 : 2, maximumFractionDigits: compact ? 0 : 2});
  return (n < 0 ? "−" : "") + c + v;
}
const pct = (a,b) => b ? Math.round(a/b*100) : 0;
function monthName(ym, short){ const [y,m] = ym.split("-").map(Number); return new Date(y, m-1, 1).toLocaleString(undefined, short ? {month:"short"} : {month:"long",year:"numeric"}); }
function shiftMonth(ym, d){ let [y,m] = ym.split("-").map(Number); m += d; while(m<1){m+=12;y--} while(m>12){m-=12;y++} return `${y}-${pad(m)}`; }
function daysIn(ym){ const [y,m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); }
function fmtDay(d, opts){ return new Date(d+"T12:00").toLocaleDateString(undefined, opts || {month:"short",day:"numeric"}); }
function daysBetween(a,b){ return Math.round((new Date(b+"T12:00") - new Date(a+"T12:00"))/864e5); }
function qtyOf(it){ return pendingQty[it.id] ?? it.qty ?? 0; }
function stockState(it){ const q = qtyOf(it), m = Number(it.minQty ?? 1); return q <= 0 ? "out" : (q <= m ? "low" : "ok"); }
function lowItems(){ return S.items.filter(it => stockState(it) !== "ok"); }
const sum = (list, f = x => Number(x.amount||0)) => list.reduce((s,x) => s + f(x), 0);
function expIn(yms, opts = {}){ const set = new Set(yms); return S.expenses.filter(e => set.has(ymOf(e.date)) && (opts.trips !== false || !e.tripId)); }
function incIn(yms){ const set = new Set(yms); return S.income.filter(e => set.has(ymOf(e.date))); }
function byDesc(a,b){ return (b.date||"").localeCompare(a.date||"") || (b.createdAt||0)-(a.createdAt||0); }
function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60) || ("c-" + Date.now()); }
function flash(t){ const r = $("#toastRoot"); r.innerHTML = `<div class="toast" role="status">${esc(t)}</div>`; clearTimeout(flash.t); flash.t = setTimeout(()=>{ r.innerHTML = ""; }, 3600); }
function col(name){ return H.collection(name); }
function save(p, okMsg){
  if (okMsg) flash(okMsg);
  Promise.resolve(p).catch(e => flash(e && e.code === "permission-denied" ? "This account isn't allowed to change the ledger's data." : "That change didn't save. Try again."));
}
function tripStatus(t){ const d = todayISO(); return d < (t.start||"") ? "upcoming" : (d > (t.end||t.start||"") ? "past" : "active"); }
function activeTrip(){ return S.trips.find(t => tripStatus(t) === "active"); }
function authError(e){
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "That email and password don't match. Try again or reset your password.";
  if (c.includes("email-already-in-use")) return "There's already an account with that email. Sign in instead.";
  if (c.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (c.includes("invalid-email")) return "Check the email address.";
  if (c.includes("network")) return "No internet connection. Connect and try again.";
  if (c.includes("unauthorized-domain")) return "This web address isn't approved in Firebase yet. Add it under Authentication → Settings → Authorized domains.";
  if (c.includes("too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  return (e && e.message) || "Something went wrong. Try again.";
}
function det(key, defOpen){ return (ui.open.has(key) || (defOpen && !ui.open.has("x:"+key))) ? " open" : ""; }

/* ---------- options ---------- */
function catOptions(sel){
  if (!S.cats.length) return `<option value="">Add a category in Budget first</option>`;
  return groupsInUse().map(g => `<optgroup label="${esc(g)}">` + S.cats.filter(c => groupOfCat(c) === g).sort((a,b)=>a.name.localeCompare(b.name))
    .map(c => `<option value="${esc(c.id)}"${c.id===sel?" selected":""}>${esc(c.name)}</option>`).join("") + `</optgroup>`).join("");
}
function cardOptions(sel){ return `<option value="">No card</option>` + S.cards.map(c => `<option value="${esc(c.id)}"${c.id===sel?" selected":""}>${esc(c.name)}${c.last4?" ••"+esc(c.last4):""}</option>`).join(""); }
function tripOptions(sel){ return `<option value="">Not a trip</option>` + S.trips.slice().sort((a,b)=>(b.start||"").localeCompare(a.start||"")).map(t => `<option value="${esc(t.id)}"${t.id===sel?" selected":""}>${esc(t.name)}</option>`).join(""); }

/* ---------- render ---------- */
function render(){
  const inApp = screen === "app";
  $("#tabs").hidden = !inApp; $("#monthNav").hidden = !inApp; $("#bottombar").hidden = !inApp; $("#fab").hidden = !inApp;
  $("#monthLabel").textContent = monthName(month);
  document.querySelectorAll("#tabs a, #bottombar a").forEach(a => { const cur = a.dataset.tab === tab || (a.dataset.tab === "more" && ["budget","cards"].includes(tab)); if (cur) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  const low = lowItems().length; document.querySelectorAll("[data-low]").forEach(d => { d.hidden = !low; d.textContent = low; });
  const v = $("#view");
  let html;
  if (inApp) {
    html = "";
    const ready = ["e","n","c","i","t","k"].every(k => S.got[k]);
    html += ready ? ({overview:viewOverview, money:viewMoney, budget:viewBudget, reports:viewReports, trips:viewTrips, cards:viewCards, supplies:viewSupplies})[tab]() : `<div class="panel empty">Loading your ledger…</div>`;
  } else html = viewAuth();
  const focusId = document.activeElement && document.activeElement.id;
  const keep = {};
  v.querySelectorAll("form[id] input[id], form[id] select[id]").forEach(el => { if (el.type !== "password") keep[el.id] = el.value; });
  if (focusId && !(focusId in keep) && document.activeElement.value !== undefined && document.activeElement.type !== "password") keep[focusId] = document.activeElement.value;
  const pw = $("#auPass") ? $("#auPass").value : null;
  v.innerHTML = html;
  for (const k in keep){ const el = document.getElementById(k); if (el && "value" in el) el.value = keep[k]; }
  if (pw !== null && $("#auPass")) $("#auPass").value = pw;
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
  wireCharts();
}

function viewAuth(){
  if (screen === "loading") return `<div class="panel empty">Loading…</div>`;
  if (screen === "setup") return `<div class="auth panel"><h2>Almost ready</h2><p>This app isn't connected to your Firebase project yet. Open <b>config.js</b> and paste in the settings from your Firebase project, then reload this page.</p></div>`;
  if (screen === "error") return `<div class="auth panel"><h2>Can't load your ledger</h2><p>${esc(authMsg || "Check your internet connection and reload.")}</p><button data-act="signout">Sign out</button></div>`;
  const email = auth && auth.currentUser ? auth.currentUser.email : "";
  if (screen === "verify") return `<div class="auth panel"><h2>Confirm your email</h2>
    <p>We sent a link to <b>${esc(email)}</b>. Open it, then come back and tap Continue. Check your spam folder if you don't see it.</p>
    ${authMsg ? `<div class="banner">${esc(authMsg)}</div>` : ""}
    <div class="links"><button class="primary" data-act="verified">Continue</button><button data-act="resend">Send the link again</button><button class="ghost" data-act="signout">Sign out</button></div></div>`;
  if (screen === "notmember") return `<div class="auth panel"><h2>This email isn't allowed yet</h2>
    <p>You're signed in as <b>${esc(email)}</b>, but the Firestore rules in Firebase list a different email. Put this email in the rules, publish them, then tap Try again.</p>
    <div class="links"><button class="primary" data-act="retry">Try again</button><button class="ghost" data-act="signout">Sign out</button></div></div>`;
  const title = authMode === "signup" ? "Create your account" : authMode === "reset" ? "Reset your password" : "Sign in";
  return `<div class="auth"><div class="panel"><h2>${title}</h2>
    <form id="authForm">
      <label>Email<input id="auEmail" type="email" autocomplete="email" required></label>
      ${authMode !== "reset" ? `<label>Password<input id="auPass" type="password" autocomplete="${authMode==="signup"?"new-password":"current-password"}" minlength="6" required></label>` : ""}
      ${authMsg ? `<div class="banner">${esc(authMsg)}</div>` : ""}
      <button class="primary" type="submit">${authMode === "signup" ? "Create account" : authMode === "reset" ? "Send reset link" : "Sign in"}</button>
    </form>
    <div class="links" style="margin-top:12px">
      ${authMode !== "signin" ? `<button class="linkbtn" data-act="mode" data-m="signin">I have an account</button>` : `<button class="linkbtn" data-act="mode" data-m="signup">Create an account</button>`}
      ${authMode !== "reset" ? `<button class="linkbtn" data-act="mode" data-m="reset">Forgot password?</button>` : ""}
    </div></div>
    <p class="muted" style="font-size:.85rem">Use the same email and password on every device. Your ledger stays in sync between them.</p></div>`;
}

function barClass(p){ return p > 1 ? "bad" : (p >= .8 ? "warn" : ""); }
function meter(spent, budget){ const p = budget ? spent/budget : (spent ? 2 : 0); return `<div class="bar"><i class="${barClass(p)}" style="width:${Math.min(100,p*100).toFixed(1)}%"></i></div>`; }

/* ---------- transactions ---------- */
function txRow(e, kind){
  const key = (kind === "in" ? "n:" : "e:") + e.id, del = ui.confirmDel === key;
  const card = cardById(e.cardId), trip = tripById(e.tripId);
  const meta = [kind === "in" ? (e.source || "Income") : catName(e.category), fmtDay(e.date), card ? card.name : "", trip ? "✈ " + trip.name : ""].filter(Boolean).map(esc).join(" · ");
  const g = kind === "in" ? null : groupOfExp(e);
  return `<div class="row"><span class="avatar" style="--c:${kind === "in" ? "var(--income)" : groupColor(g)}">${kind === "in" ? ICON.income : groupIcon(g)}</span><div class="grow"><div class="t">${esc(e.note || (kind === "in" ? (e.source || "Income") : catName(e.category)))}</div><div class="s">${meta}</div></div>
    <span class="num ${kind === "in" ? "pos" : ""}">${kind === "in" ? "+" : ""}${money(Number(e.amount||0))}</span>
    ${del ? `<button class="danger" data-act="del-tx" data-key="${esc(key)}">Delete?</button>` : `<button class="ghost" data-act="ask-del" data-key="${esc(key)}" aria-label="Delete">✕</button>`}</div>`;
}
function recentTx(n){
  return [...S.expenses.map(e => ({e, k:"out"})), ...S.income.map(e => ({e, k:"in"}))]
    .filter(x => ymOf(x.e.date) === month).sort((a,b) => byDesc(a.e,b.e)).slice(0,n).map(x => txRow(x.e, x.k)).join("");
}

/* ---------- Overview ---------- */
function viewOverview(){
  const ex = expIn([month]), inc = incIn([month]);
  const spent = sum(ex), income = sum(inc), budget = sum(S.cats, c => Number(c.budget||0));
  const low = lowItems(), isNow = month === todayISO().slice(0,7), dim = daysIn(month), d = isNow ? new Date().getDate() : dim;
  let h = "";
  if (!S.cats.length && !S.items.length && S.confirmedEmpty) h += `<div class="banner"><span>Your ledger is empty. Start with suggested categories (Groceries, Utilities…) and common supplies (tissues, dish soap…)? You can change or delete any of them.</span><button class="primary" data-act="seed">Add suggestions</button></div>`;
  // hero
  const usedP = budget ? spent / budget : 0, R = 52, C = 2*Math.PI*R, frac = Math.min(1, usedP);
  const ringCol = usedP > 1 ? "#ff9b87" : usedP >= .8 ? "#f2c35c" : "#8fe0b6";
  const proj = isNow ? forecastMonth(ex, d, dim) : spent;
  const last6 = periodMonths("6m"), sp = last6.map(m => sum(expIn([m])));
  h += `<section class="hero">
    <svg class="ring" viewBox="0 0 130 130" role="img" aria-label="${budget ? pct(spent,budget) + "% of budget used" : "No budget set"}">
      <circle cx="65" cy="65" r="${R}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="12"/>
      <circle cx="65" cy="65" r="${R}" fill="none" stroke="${ringCol}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(C*frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 65 65)"/>
      <text x="65" y="63" text-anchor="middle" style="font:800 26px var(--f-display)">${budget ? pct(spent,budget) + "%" : "—"}</text>
      <text x="65" y="83" text-anchor="middle" style="font:600 10px var(--f-body);letter-spacing:.08em;opacity:.8">OF BUDGET</text></svg>
    <div class="txt"><div class="eyebrow">${esc(monthName(month))}</div>
      <div class="big"><span class="num">${money(spent)}</span></div>
      <div class="line">${budget ? `spent of ${money(budget)} · ${spent > budget ? money(spent-budget) + " over" : money(budget-spent) + " left"}` : "spent this month"}${isNow ? ` · ${dim - d} day${dim-d===1?"":"s"} to go` : ""}</div>
      <div class="minis">
        <div class="mini"><div class="k">Income</div><div class="v">${money(income)}</div></div>
        <div class="mini"><div class="k">${income - spent < 0 ? "Overspent" : "Saved"}</div><div class="v">${money(Math.abs(income-spent))}</div></div>
        ${isNow ? `<div class="mini"><div class="k">Forecast</div><div class="v">${money(proj)}</div></div>` : ""}
      </div>
      <div class="acts"><button data-act="sheet" data-s="add">${ICON.plus}Add</button><button data-act="scan-start">${ICON.camera}Scan receipt</button><button data-act="import-start">${ICON.upload}Import statement</button></div>
    </div>
    <div class="spark">${sparkline(sp, last6)}</div>
  </section>`;
  h += paceBanner();
  const at = activeTrip() || S.trips.filter(t => tripStatus(t) === "upcoming").sort((a,b)=>(a.start||"").localeCompare(b.start||""))[0];
  if (at) h += tripTile(at, true);
  h += `<div class="two"><section class="panel"><div class="flex"><h2>Spending mix</h2><a href="#reports" class="small">Full report</a></div>${mixDonut(ex)}</section>
    <section class="panel"><div class="flex"><h2>Shopping list</h2><button data-act="scan-start">${ICON.camera}Scan receipt</button></div>`;
  if (!low.length) h += `<div class="empty">Everything is stocked.</div>`;
  else h += `<div class="list">` + low.slice(0,8).map(it => `<div class="row"><span class="avatar" style="--c:${it.kind==="grocery"?groupColor("Food"):groupColor("Home")}">${ICON.supplies}</span><div class="grow"><div class="t">${esc(it.name)}</div><div class="s">${it.kind==="grocery"?"Groceries":"Household"} · ${qtyOf(it)} ${esc(it.unit||"")} left</div></div><span class="pill ${stockState(it)}">${stockState(it)==="out"?"Out":"Low"}</span><button data-act="goto-restock" data-id="${esc(it.id)}">Restock</button></div>`).join("") + `</div>`;
  h += `</section></div>`;
  h += `<div class="two"><section class="panel"><div class="flex"><h2>Budget by group</h2><a href="#budget" class="small">Edit budgets</a></div>${groupBudgetList(ex)}</section>`;
  h += `<section class="panel"><div class="flex"><h2>Recent activity</h2><a class="small" href="#money">See all</a></div>`;
  const r = recentTx(6);
  h += r ? `<div class="list">${r}</div>` : `<div class="empty">Nothing recorded in ${esc(monthName(month))} yet.</div>`;
  return h + `</section></div>`;
}
function sparkline(vals, yms){
  const W = 600, H = 46, max = Math.max(...vals, 1), n = vals.length;
  const x = i => 6 + i * (W-12)/(n-1 || 1), y = v => H - 6 - v/max*(H-14);
  const pts = vals.map((v,i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Spending over the last 6 months">
    <polygon points="${x(0)},${H} ${pts} ${x(n-1)},${H}" fill="rgba(255,255,255,.10)"/>
    <polyline points="${pts}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    ${vals.map((v,i)=>`<rect x="${x(i)-30}" y="0" width="60" height="${H}" fill="transparent" data-tip="<b>${esc(monthName(yms[i]))}</b><br>Spent ${esc(money(v))}"/>`).join("")}</svg>`;
}
function mixDonut(ex){
  const total = sum(ex);
  if (!total) return `<div class="empty">No spending yet this month.</div>`;
  const by = {}; for (const e of ex){ const g = groupOfExp(e); by[g] = (by[g]||0) + Number(e.amount||0); }
  const rows = Object.entries(by).sort((a,b)=>b[1]-a[1]);
  const R = 70, r = 46, cx = 85, cy = 85, gap = rows.length > 1 ? 0.025 : 0;
  let a0 = -Math.PI/2, arcs = "";
  for (const [g,v] of rows){
    const sweep = v/total * Math.PI*2, s = a0 + gap/2, e = a0 + sweep - gap/2; a0 += sweep;
    if (e <= s) continue;
    const L = (e - s) > Math.PI ? 1 : 0, p = (rr,ang) => `${(cx+rr*Math.cos(ang)).toFixed(2)},${(cy+rr*Math.sin(ang)).toFixed(2)}`;
    const d = rows.length === 1 ? `M${cx},${cy-R}A${R},${R} 0 1 1 ${cx-0.01},${cy-R}L${cx-0.01},${cy-r}A${r},${r} 0 1 0 ${cx},${cy-r}Z` : `M${p(R,s)}A${R},${R} 0 ${L} 1 ${p(R,e)}L${p(r,e)}A${r},${r} 0 ${L} 0 ${p(r,s)}Z`;
    arcs += `<path class="seg-arc" d="${d}" fill="${groupColor(g)}" data-act="mixgo" data-g="${esc(g)}" data-tip="<b>${esc(g)}</b><br>${esc(money(v))} · ${pct(v,total)}%"/>`;
  }
  return `<div class="mix"><svg viewBox="0 0 170 170" role="img" aria-label="Spending by group">${arcs}
      <text x="85" y="84" text-anchor="middle" class="ctr1">${esc(money(total,true))}</text><text x="85" y="100" text-anchor="middle" class="ctr2">SPENT</text></svg>
    <div class="mixlist">${rows.map(([g,v]) => `<button data-act="mixgo" data-g="${esc(g)}"><span class="sw" style="background:${groupColor(g)}"></span><span>${esc(g)}</span><span class="num">${money(v)}</span><span class="muted small num">${pct(v,total)}%</span></button>`).join("")}</div></div>`;
}

function groupBudgetList(ex){
  const by = {}; for (const e of ex) by[e.category] = (by[e.category]||0) + Number(e.amount||0);
  const groups = groupsInUse();
  const stray = Object.keys(by).filter(k => !catById(k));
  if (!groups.length && !stray.length) return `<div class="empty">No categories yet. Add them on the Budget tab.</div>`;
  let h = "";
  for (const g of groups){
    const cats = S.cats.filter(c => groupOfCat(c) === g);
    const gs = sum(cats, c => by[c.id]||0), gb = sum(cats, c => Number(c.budget||0));
    h += `<details class="grp" data-key="ov-${esc(g)}"${det("ov-"+g)}><summary><span class="sw" style="background:${groupColor(g)}"></span><span class="gname">${esc(g)}</span><span class="num">${money(gs)} <span class="muted">/ ${money(gb,true)}</span></span></summary>${meter(gs,gb)}<div class="inner">`;
    for (const c of cats.sort((a,b)=>(by[b.id]||0)-(by[a.id]||0))){ const s = by[c.id]||0, b = Number(c.budget||0);
      h += `<div class="catrow"><div class="h"><span>${esc(c.name)}</span><span class="num">${money(s)} <span class="muted">/ ${money(b)}</span></span></div>${meter(s,b)}</div>`; }
    h += `</div></details>`;
  }
  for (const k of stray) h += `<div class="catrow"><div class="h"><span>${esc(catName(k))}</span><span class="num">${money(by[k])} <span class="muted">/ no budget</span></span></div></div>`;
  return h;
}

const BILL_CATS = new Set(["rent","utilities","internet","subscriptions","savings"]);
function isBill(e){ return BILL_CATS.has(e.category); }
// Bills (rent, utilities…) and trip spending are counted once, not projected daily.
function forecastMonth(ex, upto, dim){
  const spent = sum(ex), everyday = sum(ex.filter(e => !isBill(e) && !e.tripId));
  const budgetBills = sum(S.cats.filter(c => BILL_CATS.has(c.id)), c => Number(c.budget||0));
  const billsLeft = Math.max(0, budgetBills - sum(ex.filter(isBill)));
  return spent + (upto ? everyday / upto * (dim - upto) : 0) + billsLeft;
}
function paceBanner(){
  if (month !== todayISO().slice(0,7)) return "";
  const budget = sum(S.cats, c => Number(c.budget||0)); if (!budget) return "";
  const spent = sum(expIn([month])), d = new Date().getDate(), dim = daysIn(month);
  const proj = forecastMonth(expIn([month]), d, dim), left = budget - spent, perDay = (dim - d + 1) > 0 ? left / (dim - d + 1) : 0;
  const over = proj > budget;
  return `<div class="pace ${over?"over":""}"><div><b>${over ? "On pace to go over budget" : "On track"}</b> · At this rate you'll spend about <span class="num">${money(proj)}</span> this month (budget <span class="num">${money(budget)}</span>).</div>
    <div class="muted">${left > 0 ? `You can spend <span class="num">${money(perDay)}</span> a day for the rest of ${esc(monthName(month,true))}.` : `You're <span class="num">${money(-left)}</span> over budget.`} <a href="#reports">See reports</a></div></div>`;
}

/* ---------- Money ---------- */
function viewMoney(){
  const t = ui.txType;
  const defDate = month === todayISO().slice(0,7) ? todayISO() : month + "-01";
  const at = activeTrip();
  let h = `<section class="panel"><div class="flex"><h2>Add ${t === "income" ? "income" : "an expense"}</h2>
    <div class="seg" role="group" aria-label="Type"><button data-act="txtype" data-t="expense" aria-pressed="${t==="expense"}">Expense</button><button data-act="txtype" data-t="income" aria-pressed="${t==="income"}">Income</button></div></div>
    <form class="form" id="txForm">
    <label>Amount<input id="txAmount" type="number" step="0.01" min="0" inputmode="decimal" required placeholder="0.00"></label>
    ${t === "income"
      ? `<label>Source<input id="txSource" type="text" list="srcList" maxlength="40" placeholder="Salary" required><datalist id="srcList">${INCOME_SOURCES.map(s=>`<option value="${s}">`).join("")}</datalist></label>`
      : `<label>Category<select id="txCat">${catOptions(catById("groceries")?"groceries":"")}</select></label>`}
    <label>Date<input id="txDate" type="date" value="${defDate}" required></label>
    <label>${t === "income" ? "Paid into" : "Paid with"}<select id="txCard">${cardOptions(S.cards.length === 1 ? S.cards[0].id : "")}</select></label>
    ${t === "expense" ? `<label>Trip<select id="txTrip">${tripOptions(at ? at.id : "")}</select></label>` : ""}
    <label>Note<input id="txNote" type="text" maxlength="80" placeholder="${t==="income"?"e.g. November pay":"e.g. Weekly groceries"}"></label>
    <button class="primary" type="submit">Add ${t === "income" ? "income" : "expense"}</button></form>
    ${t === "expense" && at ? `<p class="status">You're on <b>${esc(at.name)}</b>, so new expenses are tagged to it. Change Trip to "Not a trip" for everyday spending.</p>` : ""}</section>`;

  const ex = expIn([month]).sort(byDesc), inc = incIn([month]).sort(byDesc);
  h += `<section class="panel"><div class="flex"><h2>${esc(monthName(month))}</h2>
    <div class="seg" role="group" aria-label="View"><button data-act="mview" data-v="category" aria-pressed="${ui.moneyView==="category"}">By category</button><button data-act="mview" data-v="date" aria-pressed="${ui.moneyView==="date"}">By date</button></div></div>
    <div class="totals"><span>In <b class="num pos">${money(sum(inc))}</b></span><span>Out <b class="num">${money(sum(ex))}</b></span><span>Net <b class="num ${sum(inc)-sum(ex)<0?"neg":""}">${money(sum(inc)-sum(ex))}</b></span></div>`;
  if (!ex.length && !inc.length) return h + `<div class="empty">Nothing recorded this month. Add your first entry above.</div></section>`;
  if (ui.moneyView === "date"){
    const all = [...ex.map(e=>({e,k:"out"})), ...inc.map(e=>({e,k:"in"}))].sort((a,b)=>byDesc(a.e,b.e));
    let last = ""; h += `<div class="list">`;
    for (const x of all){ if (x.e.date !== last){ last = x.e.date; h += `<div class="daygroup">${esc(fmtDay(x.e.date,{weekday:"long",month:"short",day:"numeric"}))}</div>`; } h += txRow(x.e, x.k); }
    return h + `</div></section>`;
  }
  if (inc.length) h += `<details class="grp" data-key="inc"${det("inc")}><summary><span class="sw" style="background:var(--income)"></span><span class="gname">Income</span><span class="num pos">+${money(sum(inc))}</span></summary><div class="list inner">${inc.map(e => txRow(e,"in")).join("")}</div></details>`;
  const groups = [...new Set([...groupsInUse(), ...ex.map(groupOfExp)])];
  for (const g of groups){
    const gex = ex.filter(e => groupOfExp(e) === g); if (!gex.length) continue;
    const cats = [...new Set(gex.map(e => e.category))];
    h += `<details class="grp" data-key="m-${esc(g)}"${det("m-"+g)}><summary><span class="sw" style="background:${groupColor(g)}"></span><span class="gname">${esc(g)}</span><span class="cnt">${gex.length}</span><span class="num">${money(sum(gex))}</span></summary><div class="inner">`;
    for (const cid of cats.sort((a,b)=>sum(gex.filter(e=>e.category===b))-sum(gex.filter(e=>e.category===a)))){
      const cex = gex.filter(e => e.category === cid), c = catById(cid), b = c ? Number(c.budget||0) : 0;
      h += `<details class="sub" data-key="mc-${esc(cid)}"${det("mc-"+cid)}><summary><span class="gname">${esc(catName(cid))}</span><span class="cnt">${cex.length}</span><span class="num">${money(sum(cex))}${b?` <span class="muted">/ ${money(b,true)}</span>`:""}</span></summary><div class="list">${cex.map(e => txRow(e,"out")).join("")}</div></details>`;
    }
    h += `</div></details>`;
  }
  return h + `</section>`;
}

/* ---------- Budget ---------- */
function viewBudget(){
  const by = {}; for (const e of expIn([month])) by[e.category] = (by[e.category]||0) + Number(e.amount||0);
  let total = 0, totalSpent = 0;
  const groups = groupsInUse();
  let h = `<section class="panel"><h2>Monthly budget</h2><p class="muted" style="margin:0 0 10px">Set how much you plan to spend each month. Tap a group to open it. Changes save when you leave the box.</p>
    <datalist id="groupList">${[...new Set([...GROUP_ORDER, ...groups])].map(g=>`<option value="${esc(g)}">`).join("")}</datalist>`;
  for (const g of groups){
    const cats = S.cats.filter(c => groupOfCat(c) === g).sort((a,b)=>a.name.localeCompare(b.name));
    const gb = sum(cats, c=>Number(c.budget||0)), gs = sum(cats, c=>by[c.id]||0); total += gb; totalSpent += gs;
    h += `<details class="grp" data-key="b-${esc(g)}"${det("b-"+g, true)}><summary><span class="sw" style="background:${groupColor(g)}"></span><span class="gname">${esc(g)}</span><span class="num">${money(gs)} <span class="muted">/ ${money(gb)}</span></span></summary>
      <div class="tablewrap inner"><table><thead><tr><th>Category</th><th class="r">Budget</th><th class="r">Spent</th><th class="r">Left</th><th>Group</th><th></th></tr></thead><tbody>`;
    for (const c of cats){
      const b = Number(c.budget||0), s = by[c.id]||0, del = ui.confirmDel === "c:"+c.id;
      h += `<tr><td>${esc(c.name)}</td><td class="r"><input id="bud-${esc(c.id)}" class="num" type="number" min="0" step="1" inputmode="decimal" value="${b}" data-act="budget" data-id="${esc(c.id)}" aria-label="Budget for ${esc(c.name)}"></td>
        <td class="r num">${money(s)}</td><td class="r num ${b-s<0?"neg":""}">${money(b-s)}</td>
        <td><input id="grp-${esc(c.id)}" list="groupList" value="${esc(g)}" data-act="group" data-id="${esc(c.id)}" aria-label="Group for ${esc(c.name)}" class="grpin"></td>
        <td class="r">${del?`<button class="danger" data-act="del-cat" data-id="${esc(c.id)}">Delete?</button>`:`<button class="ghost" data-act="ask-del" data-key="c:${esc(c.id)}" aria-label="Delete ${esc(c.name)}">✕</button>`}</td></tr>`;
    }
    h += `</tbody></table></div></details>`;
  }
  h += `<div class="totals" style="margin-top:12px"><span>Total budget <b class="num">${money(total)}</b></span><span>Spent in ${esc(monthName(month,true))} <b class="num">${money(totalSpent)}</b></span><span>Left <b class="num ${total-totalSpent<0?"neg":""}">${money(total-totalSpent)}</b></span></div></section>`;
  const missing = SUGGESTED_CATS.filter(([id]) => !catById(id));
  h += `<section class="panel"><h2>Add a category</h2><form class="form" id="catForm"><label>Name<input id="catName" type="text" maxlength="40" required placeholder="e.g. School fees"></label><label>Group<input id="catGroup" list="groupList" maxlength="24" placeholder="e.g. Personal"></label><label>Monthly budget<input id="catBudget" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></label><button class="primary" type="submit">Add category</button></form>
    ${missing.length ? `<p class="status">Suggested categories you don't have yet: ${missing.map(m=>esc(m[1])).join(", ")}. <button class="linkbtn" data-act="add-suggested">Add them</button></p>` : ""}</section>`;
  h += `<section class="panel"><h2>Currency</h2><form class="form" id="curForm"><label>Symbol shown before amounts<input id="curSym" type="text" maxlength="4" value="${esc(S.settings.currency||"$")}"></label><button type="submit">Save currency</button></form></section>`;
  h += `<section class="panel acct"><span class="muted">Signed in as <b>${esc(auth.currentUser ? auth.currentUser.email : "")}</b></span><button data-act="signout">Sign out</button></section>`;
  return h;
}

/* ---------- Reports ---------- */
function periodMonths(p, anchor = month){
  const n = { "1m":1, "3m":3, "6m":6, "12m":12 }[p];
  if (n) return Array.from({length:n}, (_,i) => shiftMonth(anchor, i-n+1));
  const [y,m] = anchor.split("-").map(Number); return Array.from({length:m}, (_,i) => `${y}-${pad(i+1)}`);
}
const PERIODS = [["1m","This month"],["3m","3 months"],["6m","6 months"],["12m","12 months"],["ytd","Year to date"]];
let chartData = {};

function viewReports(){
  const yms = periodMonths(ui.period), n = yms.length;
  const prevYms = yms.map(m => shiftMonth(m, -n));
  const opt = { trips: ui.incTrips };
  const exAll = expIn(yms, opt), inc = incIn(yms);
  const focusYms = ui.drillYm && yms.includes(ui.drillYm) ? [ui.drillYm] : yms;
  const ex = expIn(focusYms, opt);
  const spent = sum(exAll), income = sum(inc), budgetM = sum(S.cats, c=>Number(c.budget||0));
  const label = PERIODS.find(p=>p[0]===ui.period)[1];
  let h = `<section class="panel filters"><div class="seg wrap-seg" role="group" aria-label="Period">${PERIODS.map(([k,l]) => `<button data-act="period" data-p="${k}" aria-pressed="${ui.period===k}">${l}</button>`).join("")}</div>
    <label class="check"><input type="checkbox" id="incTrips" data-act="inctrips" ${ui.incTrips?"checked":""}> Include trip spending</label>
    <span class="muted small">Ending ${esc(monthName(month))}. Use the arrows at the top to change it.</span></section>`;
  h += `<section class="stats">
    <div class="stat"><div class="k">${ICON.income}Income</div><div class="v num">${money(income)}</div><div class="sub">${n>1?money(income/n)+" a month":""}</div></div>
    <div class="stat"><div class="k">${ICON.expense}Spent</div><div class="v num">${money(spent)}</div><div class="sub">${n>1?money(spent/n)+" a month":""}${budgetM?` · ${pct(spent, budgetM*n)}% of budget`:""}</div></div>
    <div class="stat"><div class="k">${ICON.piggy}${income-spent<0?"Overspent":"Saved"}</div><div class="v num ${income-spent<0?"bad":"good"}">${money(Math.abs(income-spent))}</div><div class="sub">${income?"Savings rate "+pct(income-spent,income)+"%":"No income recorded"}</div></div>
    <div class="stat"><div class="k">${ICON.budget}Average day</div><div class="v num">${money(spent / Math.max(1, periodDays(yms)))}</div><div class="sub">${exAll.length} expenses</div></div></section>`;

  // Income vs spending by month
  const series = yms.map(m => ({ ym: m, income: sum(incIn([m])), spent: sum(expIn([m], opt)), budget: budgetM }));
  chartData.months = series;
  h += `<section class="panel"><div class="flex"><h2>Income vs spending</h2><div class="legend"><span><i style="background:var(--income)"></i>Income</span><span><i style="background:var(--spend)"></i>Spending</span><span><i class="dash"></i>Budget</span></div></div>
    ${n > 1 ? `<p class="muted small" style="margin:0 0 6px">Tap a month to see its breakdown below.</p>` : ""}
    <div class="chartbox">${monthChart(series)}</div>
    <button class="linkbtn small" data-act="toggletable">${ui.showTable ? "Hide table" : "Show as table"}</button>
    ${ui.showTable ? `<div class="tablewrap"><table><thead><tr><th>Month</th><th class="r">Income</th><th class="r">Spending</th><th class="r">Saved</th><th class="r">Budget</th></tr></thead><tbody>${series.map(s=>`<tr><td>${esc(monthName(s.ym))}</td><td class="r num">${money(s.income)}</td><td class="r num">${money(s.spent)}</td><td class="r num ${s.income-s.spent<0?"neg":""}">${money(s.income-s.spent)}</td><td class="r num">${money(s.budget)}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>`;

  // Breakdown with drill-down
  h += `<div class="two"><section class="panel"><div class="flex"><h2>Where the money went</h2>${ui.drillYm ? `<button class="chipbtn" data-act="drillym" data-ym="">${esc(monthName(ui.drillYm))} ✕</button>` : `<span class="muted small">${esc(label)}</span>`}</div>${breakdown(ex, focusYms.length)}</section>`;
  h += `<section class="panel"><h2>Insights</h2>${insights(yms, prevYms, opt)}</section></div>`;

  // This month pace
  if (yms.includes(month)) h += `<section class="panel"><div class="flex"><h2>${esc(monthName(month))}: spending pace</h2><div class="legend"><span><i style="background:var(--spend)"></i>Spent so far</span><span><i class="dash"></i>Budget pace</span>${month === todayISO().slice(0,7) ? `<span><i class="dash proj"></i>Forecast</span>` : ""}</div></div><div class="chartbox">${paceChart()}</div></section>`;

  // Budget vs actual
  const byCat = {}; for (const e of exAll) byCat[e.category] = (byCat[e.category]||0) + Number(e.amount||0);
  const rows = S.cats.map(c => ({ c, b: Number(c.budget||0)*n, s: byCat[c.id]||0 })).filter(r => r.b || r.s).sort((a,b)=> (b.s - b.b) - (a.s - a.b));
  h += `<section class="panel"><h2>Budget vs actual · ${esc(label)}</h2><div class="tablewrap"><table><thead><tr><th>Category</th><th class="r">Budget</th><th class="r">Actual</th><th class="r">Difference</th><th style="min-width:110px"></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><span class="sw" style="background:${groupColor(groupOfCat(r.c))}"></span>${esc(r.c.name)}</td><td class="r num">${money(r.b)}</td><td class="r num">${money(r.s)}</td><td class="r num ${r.s>r.b?"neg":r.s<r.b?"pos":""}">${r.s>r.b?"+":r.s<r.b?"−":""}${money(Math.abs(r.s-r.b))}</td><td>${meter(r.s,r.b)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No budgets or spending in this period.</td></tr>`}
    </tbody></table></div></section>`;

  // Cards & trips
  h += `<div class="two"><section class="panel"><h2>By card</h2>${cardBreakdown(exAll, inc)}</section><section class="panel"><h2>Trips</h2>${tripBreakdown(yms)}</section></div>`;
  return h;
}
function periodDays(yms){ const t = todayISO(); return yms.reduce((s,m) => s + (m === t.slice(0,7) ? new Date().getDate() : (m > t.slice(0,7) ? 0 : daysIn(m))), 0); }

function breakdown(ex, nMonths){
  const total = sum(ex);
  if (!ex.length) return `<div class="empty">No spending in this period.</div>`;
  let crumbs = `<div class="crumbs"><button class="linkbtn" data-act="drill" data-g="" data-c="">All groups</button>`;
  let rows = [];
  if (!ui.drillGroup){
    const by = {}; for (const e of ex){ const g = groupOfExp(e); by[g] = (by[g]||0) + Number(e.amount||0); }
    rows = Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([g,v]) => ({ label: g, v, color: groupColor(g), act: `data-act="drill" data-g="${esc(g)}" data-c=""` }));
  } else if (!ui.drillCat){
    crumbs += ` › <span>${esc(ui.drillGroup)}</span>`;
    const gex = ex.filter(e => groupOfExp(e) === ui.drillGroup), by = {};
    for (const e of gex) by[e.category] = (by[e.category]||0) + Number(e.amount||0);
    rows = Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([c,v]) => { const cat = catById(c); return { label: catName(c), v, color: groupColor(ui.drillGroup), sub: cat && cat.budget ? `budget ${money(Number(cat.budget)*nMonths,true)}` : "", act: `data-act="drill" data-g="${esc(ui.drillGroup)}" data-c="${esc(c)}"` }; });
  } else {
    crumbs += ` › <button class="linkbtn" data-act="drill" data-g="${esc(ui.drillGroup)}" data-c="">${esc(ui.drillGroup)}</button> › <span>${esc(catName(ui.drillCat))}</span>`;
    const cex = ex.filter(e => e.category === ui.drillCat).sort(byDesc);
    return crumbs + `</div><div class="totals"><span>Total <b class="num">${money(sum(cex))}</b></span><span>${cex.length} expenses</span></div><div class="list">${cex.map(e => txRow(e,"out")).join("") || `<div class="empty">No spending here.</div>`}</div>`;
  }
  crumbs += `</div>`;
  const max = Math.max(...rows.map(r => r.v));
  return crumbs + `<div class="hbars">${rows.map(r => `<button class="hbar" ${r.act} data-tip="${esc(r.label)}: ${esc(money(r.v))} (${pct(r.v,total)}%)">
      <span class="hl"><span class="sw" style="background:${r.color}"></span>${esc(r.label)}${r.sub?` <span class="muted small">${esc(r.sub)}</span>`:""}</span>
      <span class="num">${money(r.v)} <span class="muted">${pct(r.v,total)}%</span></span>
      <span class="track"><i style="width:${(r.v/max*100).toFixed(1)}%;background:${r.color}"></i></span></button>`).join("")}</div>
      <p class="muted small" style="margin:8px 0 0">${ui.drillGroup ? "Tap a category to see each expense." : "Tap a group to see its categories."}</p>`;
}

function insights(yms, prevYms, opt){
  const ex = expIn(yms, opt), prev = expIn(prevYms, opt), inc = incIn(yms);
  const total = sum(ex), out = [];
  if (!ex.length) return `<div class="empty">Add some expenses to see insights.</div>`;
  const gBy = {}; for (const e of ex){ const g = groupOfExp(e); gBy[g] = (gBy[g]||0) + Number(e.amount||0); }
  const topG = Object.entries(gBy).sort((a,b)=>b[1]-a[1])[0];
  out.push(`<b>${esc(topG[0])}</b> is your biggest area: <span class="num">${money(topG[1])}</span>, ${pct(topG[1], total)}% of spending.`);
  const prevCovered = prevYms.every(m => S.expenses.some(e => ymOf(e.date) === m));
  if (prev.length && prevCovered){
    const cNow = {}, cPrev = {};
    for (const e of ex) cNow[e.category] = (cNow[e.category]||0) + Number(e.amount||0);
    for (const e of prev) cPrev[e.category] = (cPrev[e.category]||0) + Number(e.amount||0);
    const diffs = [...new Set([...Object.keys(cNow), ...Object.keys(cPrev)])].map(c => [c, (cNow[c]||0) - (cPrev[c]||0)]).sort((a,b)=>b[1]-a[1]);
    const t = total - sum(prev);
    out.push(`Spending is <b>${t >= 0 ? "up" : "down"} <span class="num">${money(Math.abs(t))}</span></b> (${t>=0?"+":"−"}${Math.abs(pct(t, sum(prev)))}%) compared with the previous ${yms.length === 1 ? "month" : yms.length + " months"}.`);
    if (diffs[0] && diffs[0][1] > 0) out.push(`Biggest increase: <b>${esc(catName(diffs[0][0]))}</b>, up <span class="num">${money(diffs[0][1])}</span>.`);
    const dn = diffs[diffs.length-1]; if (dn && dn[1] < 0) out.push(`Biggest saving: <b>${esc(catName(dn[0]))}</b>, down <span class="num">${money(-dn[1])}</span>.`);
  }
  const income = sum(inc);
  if (income) out.push(`You kept <b>${pct(income-total, income)}%</b> of your income${income-total<0?", so you spent more than you earned":""}.`);
  else out.push(`Record your income on the Money tab to see your savings rate.`);
  const trip = sum(expIn(yms).filter(e => e.tripId));
  if (trip) out.push(`Trips cost <span class="num">${money(trip)}</span>${opt.trips ? `, ${pct(trip,total)}% of spending` : " (not included in these totals)"}.`);
  const home = sum(ex.filter(e => ["groceries","household"].includes(e.category)));
  if (home) out.push(`Groceries and household supplies: <span class="num">${money(home)}</span>.`);
  const n = yms.length, overs = S.cats.filter(c => Number(c.budget||0) && sum(ex.filter(e=>e.category===c.id)) > Number(c.budget)*n);
  if (overs.length) out.push(`Over budget: ${overs.map(c => `<b>${esc(c.name)}</b>`).join(", ")}.`);
  const top = ex.filter(e => !isBill(e)).sort((a,b)=>b.amount-a.amount).slice(0,5);
  return `<ul class="insights">${out.map(s=>`<li>${s}</li>`).join("")}</ul><h3>Largest expenses <span class="muted small">(not counting bills)</span></h3><div class="list">${top.map(e => txRow(e,"out")).join("")}</div>`;
}

function cardBreakdown(ex, inc){
  if (!S.cards.length) return `<div class="empty">Add your cards on the Cards tab to see spending per card.</div>`;
  const rows = [...S.cards.map(c => ({ name: c.name, out: sum(ex.filter(e=>e.cardId===c.id)), inn: sum(inc.filter(e=>e.cardId===c.id)) })),
    { name: "No card", out: sum(ex.filter(e=>!cardById(e.cardId))), inn: sum(inc.filter(e=>!cardById(e.cardId))) }].filter(r => r.out || r.inn);
  if (!rows.length) return `<div class="empty">No card activity in this period.</div>`;
  const max = Math.max(...rows.map(r=>Math.max(r.out,r.inn)));
  return `<div class="hbars">${rows.map(r => `<div class="hbar static"><span class="hl">${esc(r.name)}</span><span class="num">−${money(r.out)}${r.inn?` <span class="pos">+${money(r.inn)}</span>`:""}</span><span class="track"><i style="width:${(r.out/max*100).toFixed(1)}%;background:var(--spend)"></i></span></div>`).join("")}</div>`;
}
function tripBreakdown(yms){
  const ex = expIn(yms).filter(e => e.tripId);
  const ids = [...new Set(ex.map(e => e.tripId))];
  if (!ids.length) return `<div class="empty">No trip spending in this period. Plan one on the Trips tab.</div>`;
  return `<div class="list">${ids.map(id => { const t = tripById(id), s = sum(S.expenses.filter(e=>e.tripId===id)), b = t ? Number(t.budget||0) : 0;
    return `<div class="row"><div class="grow"><div class="t">${esc(t ? t.name : "Deleted trip")}</div><div class="s">${t ? esc(fmtDay(t.start)) + " – " + esc(fmtDay(t.end||t.start)) : ""}</div>${b?meter(s,b):""}</div><span class="num">${money(s)}${b?` <span class="muted">/ ${money(b,true)}</span>`:""}</span>${t?`<button data-act="opentrip" data-id="${esc(id)}">Open</button>`:""}</div>`; }).join("")}</div>`;
}

/* ---------- SVG charts ---------- */
function chartWidth(){ const m = $("#view"); return Math.max(300, Math.min(900, (m ? m.clientWidth : 600) - 34)); }
function niceMax(v){ if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function topBar(x, y, w, h, r){ if (h <= 0) return ""; r = Math.min(r, w/2, h); return `M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z`; }

function monthChart(series){
  const W = chartWidth(), Hh = 230, L = 52, R = 10, T = 12, B = 28, pw = W-L-R, ph = Hh-T-B;
  const max = niceMax(Math.max(...series.map(s => Math.max(s.income, s.spent, s.budget)), 1));
  const y = v => T + ph - v/max*ph, band = pw / series.length;
  const bw = Math.max(4, Math.min(22, band*0.32));
  let g = "";
  for (let i = 0; i <= 4; i++){ const v = max*i/4, yy = y(v); g += `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L-8}" y="${yy+4}" text-anchor="end" class="axis">${esc(money(v,true))}</text>`; }
  const skip = series.length > 8 && W < 520 ? 2 : 1;
  series.forEach((s, i) => {
    const cx = L + band*i + band/2, sel = ui.drillYm === s.ym;
    if (sel) g += `<rect x="${L+band*i+2}" y="${T}" width="${band-4}" height="${ph}" class="selband" rx="6"/>`;
    g += `<path d="${topBar(cx-bw-1, y(s.income), bw, T+ph-y(s.income), 4)}" fill="var(--income)"/>`;
    g += `<path d="${topBar(cx+1, y(s.spent), bw, T+ph-y(s.spent), 4)}" fill="var(--spend)"/>`;
    if (s.budget) g += `<line x1="${cx-bw-4}" x2="${cx+bw+4}" y1="${y(s.budget)}" y2="${y(s.budget)}" class="budgetline"/>`;
    if (i % skip === 0) g += `<text x="${cx}" y="${Hh-8}" text-anchor="middle" class="axis${sel?" strong":""}">${esc(monthName(s.ym,true))}</text>`;
    const tip = `<b>${esc(monthName(s.ym))}</b><br>Income ${esc(money(s.income))}<br>Spending ${esc(money(s.spent))}<br>${s.income-s.spent<0?"Overspent":"Saved"} ${esc(money(Math.abs(s.income-s.spent)))}${s.budget?`<br>Budget ${esc(money(s.budget))}`:""}`;
    g += `<rect x="${L+band*i}" y="${T}" width="${band}" height="${ph+B}" fill="transparent" class="hit" data-tip="${esc(tip)}" data-act="drillym" data-ym="${s.ym}" role="button" tabindex="0" aria-label="${esc(monthName(s.ym))}: income ${esc(money(s.income))}, spending ${esc(money(s.spent))}"/>`;
  });
  g += `<line x1="${L}" x2="${W-R}" y1="${T+ph}" y2="${T+ph}" class="baseline"/>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Income and spending by month">${g}</svg>`;
}

function paceChart(){
  const W = chartWidth(), Hh = 220, L = 52, R = 14, T = 12, B = 26, pw = W-L-R, ph = Hh-T-B;
  const dim = daysIn(month), isNow = month === todayISO().slice(0,7), upto = isNow ? new Date().getDate() : dim;
  const budget = sum(S.cats, c=>Number(c.budget||0));
  const daily = Array(dim+1).fill(0); for (const e of expIn([month])) { const d = Number(e.date.slice(8,10)); if (d) daily[d] += Number(e.amount||0); }
  const cum = [0]; for (let d = 1; d <= dim; d++) cum[d] = cum[d-1] + daily[d];
  const proj = forecastMonth(expIn([month]), upto, dim);
  const max = niceMax(Math.max(budget, cum[upto], isNow ? proj : 0, 1));
  const x = d => L + (d/dim)*pw, y = v => T + ph - v/max*ph;
  let g = "";
  for (let i = 0; i <= 4; i++){ const v = max*i/4, yy = y(v); g += `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L-8}" y="${yy+4}" text-anchor="end" class="axis">${esc(money(v,true))}</text>`; }
  [1, 8, 15, 22, dim].forEach(d => g += `<text x="${x(d)}" y="${Hh-6}" text-anchor="${d===1?"start":d===dim?"end":"middle"}" class="axis">${esc(monthName(month,true))} ${d}</text>`);
  if (budget) g += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(dim)}" y2="${y(budget)}" class="budgetline"/>`;
  let p = `M${x(0)},${y(0)}`; for (let d = 1; d <= upto; d++) p += `L${x(d)},${y(cum[d])}`;
  g += `<path d="${p}L${x(upto)},${y(0)}L${x(0)},${y(0)}Z" class="area"/><path d="${p}" class="line"/>`;
  if (isNow && upto < dim) g += `<line x1="${x(upto)}" y1="${y(cum[upto])}" x2="${x(dim)}" y2="${y(proj)}" class="projline"/><text x="${x(dim)-4}" y="${Math.max(T+10, y(proj)-6)}" text-anchor="end" class="axis strong">${esc(money(proj,true))}</text>`;
  g += `<circle cx="${x(upto)}" cy="${y(cum[upto])}" r="4.5" class="endpt"/>`;
  g += `<line x1="${L}" x2="${W-R}" y1="${T+ph}" y2="${T+ph}" class="baseline"/>`;
  g += `<line id="paceX" x1="0" x2="0" y1="${T}" y2="${T+ph}" class="crosshair" visibility="hidden"/><circle id="paceDot" r="5" class="endpt" visibility="hidden"/>`;
  g += `<rect id="paceHit" x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent"/>`;
  chartData.pace = { dim, upto, cum, budget, L, pw, x, y };
  return `<svg id="paceSvg" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Cumulative spending this month against budget">${g}</svg>`;
}

function wireCharts(){
  const hit = $("#paceHit"); if (!hit) return;
  const c = chartData.pace, svg = $("#paceSvg");
  const move = ev => {
    const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
    const d = Math.max(1, Math.min(c.upto, Math.round((sx - c.L) / c.pw * c.dim)));
    $("#paceX").setAttribute("x1", c.x(d)); $("#paceX").setAttribute("x2", c.x(d)); $("#paceX").setAttribute("visibility","visible");
    $("#paceDot").setAttribute("cx", c.x(d)); $("#paceDot").setAttribute("cy", c.y(c.cum[d])); $("#paceDot").setAttribute("visibility","visible");
    const bud = c.budget ? c.budget * d / c.dim : 0;
    showTip(`<b>${esc(fmtDay(month + "-" + pad(d), {weekday:"short",month:"short",day:"numeric"}))}</b><br>Spent so far ${esc(money(c.cum[d]))}${bud?`<br>Budget pace ${esc(money(bud))}<br>${c.cum[d] > bud ? "Ahead of" : "Under"} pace by ${esc(money(Math.abs(c.cum[d]-bud)))}`:""}`, ev);
  };
  hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => { hideTip(); $("#paceX").setAttribute("visibility","hidden"); $("#paceDot").setAttribute("visibility","hidden"); });
}

/* tooltip */
const tip = document.createElement("div"); tip.id = "tip"; tip.hidden = true; document.body.appendChild(tip);
function showTip(html, ev){ tip.innerHTML = html; tip.hidden = false; const w = tip.offsetWidth, h = tip.offsetHeight; let x = ev.clientX + 14, y = ev.clientY - h - 12; if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (x < 8) x = 8; if (y < 8) y = ev.clientY + 16; tip.style.left = x + "px"; tip.style.top = y + "px"; }
function hideTip(){ tip.hidden = true; }
document.addEventListener("pointerover", ev => { const t = ev.target.closest && ev.target.closest("[data-tip]"); if (t && ev.pointerType === "mouse") showTip(t.dataset.tip, ev); });
document.addEventListener("pointermove", ev => { const t = ev.target.closest && ev.target.closest("[data-tip]"); if (t && ev.pointerType === "mouse") showTip(t.dataset.tip, ev); });
document.addEventListener("pointerout", ev => { const t = ev.target.closest && ev.target.closest("[data-tip]"); if (t) hideTip(); });
let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (tab === "reports") render(); }, 200); });

/* ---------- Trips ---------- */
function tripTile(t, compact){
  const spent = sum(S.expenses.filter(e => e.tripId === t.id)), b = Number(t.budget||0), st = tripStatus(t);
  const days = daysBetween(t.start, t.end || t.start) + 1, gone = st === "active" ? daysBetween(t.start, todayISO()) + 1 : (st === "past" ? days : 0);
  const when = st === "upcoming" ? `Starts in ${daysBetween(todayISO(), t.start)} day${daysBetween(todayISO(), t.start)===1?"":"s"}` : st === "active" ? `Day ${gone} of ${days}` : "Finished";
  return `<section class="panel trip"><div class="flex"><div><span class="pill ${st==="active"?"ok":st==="upcoming"?"low":"plain"}">${st === "active" ? "On now" : st === "upcoming" ? "Upcoming" : "Past"}</span>
    <h2 style="margin:6px 0 2px">✈ ${esc(t.name)}</h2><div class="muted small">${esc(fmtDay(t.start,{month:"short",day:"numeric",year:"numeric"}))} – ${esc(fmtDay(t.end||t.start,{month:"short",day:"numeric",year:"numeric"}))} · ${days} day${days===1?"":"s"} · ${esc(when)}</div></div>
    <div class="tripnums"><span class="num big">${money(spent)}</span><span class="muted small">${b ? `of ${money(b)} · ${money(b-spent)} left` : "No budget set"}</span></div></div>
    ${b ? meter(spent, b) : ""}
    ${compact ? `<div style="margin-top:10px"><button data-act="opentrip" data-id="${esc(t.id)}">Open trip</button></div>` : ""}</section>`;
}
function viewTrips(){
  if (ui.tripOpen && tripById(ui.tripOpen)) return tripDetail(tripById(ui.tripOpen));
  const order = { active:0, upcoming:1, past:2 };
  const list = S.trips.slice().sort((a,b) => order[tripStatus(a)] - order[tripStatus(b)] || (tripStatus(a)==="past" ? (b.start||"").localeCompare(a.start||"") : (a.start||"").localeCompare(b.start||"")));
  let h = `<section class="panel"><h2>Plan a trip</h2><form class="form" id="tripForm">
    <label>Trip name<input id="trName" type="text" maxlength="40" required placeholder="e.g. Beach weekend"></label>
    <label>Start<input id="trStart" type="date" required value="${todayISO()}"></label>
    <label>End<input id="trEnd" type="date" required value="${todayISO()}"></label>
    <label>Trip budget<input id="trBudget" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></label>
    <button class="primary" type="submit">Add trip</button></form>
    <p class="status">Tag expenses to a trip when you add them. While a trip is on, new expenses are tagged to it automatically. Reports can show spending with or without trips.</p></section>`;
  if (!list.length) return h + `<section class="panel empty">No trips yet. Add one above to give it its own budget.</section>`;
  return h + list.map(t => tripTile(t, true)).join("");
}
function tripDetail(t){
  const ex = S.expenses.filter(e => e.tripId === t.id).sort(byDesc), spent = sum(ex), b = Number(t.budget||0);
  const days = daysBetween(t.start, t.end || t.start) + 1, del = ui.confirmDel === "t:"+t.id;
  let h = `<div><button data-act="closetrip">‹ All trips</button></div>` + tripTile(t, false);
  h += `<section class="stats"><div class="stat"><div class="k">Budget per day</div><div class="v num">${b ? money(b/days) : "—"}</div></div>
    <div class="stat"><div class="k">Spent per day</div><div class="v num">${money(spent / Math.max(1, tripStatus(t)==="active" ? daysBetween(t.start, todayISO())+1 : days))}</div></div>
    <div class="stat"><div class="k">Expenses</div><div class="v num">${ex.length}</div></div>
    <div class="stat"><div class="k">${b-spent<0?"Over budget":"Left"}</div><div class="v num ${b-spent<0?"bad":"good"}">${b ? money(Math.abs(b-spent)) : "—"}</div></div></section>`;
  const defDate = todayISO() >= t.start && todayISO() <= (t.end||t.start) ? todayISO() : t.start;
  h += `<section class="panel"><h2>Add a trip expense</h2><form class="form" id="tripExpForm" data-trip="${esc(t.id)}">
    <label>Amount<input id="teAmount" type="number" step="0.01" min="0" inputmode="decimal" required placeholder="0.00"></label>
    <label>Category<select id="teCat">${catOptions(catById("travel") ? "travel" : catById("eating-out") ? "eating-out" : "")}</select></label>
    <label>Date<input id="teDate" type="date" value="${defDate}" required></label>
    <label>Paid with<select id="teCard">${cardOptions(S.cards.length===1?S.cards[0].id:"")}</select></label>
    <label>Note<input id="teNote" type="text" maxlength="80" placeholder="e.g. Hotel, 2 nights"></label>
    <button class="primary" type="submit">Add expense</button></form></section>`;
  const by = {}; for (const e of ex) by[e.category] = (by[e.category]||0) + Number(e.amount||0);
  const rows = Object.entries(by).sort((a,b)=>b[1]-a[1]), max = rows.length ? rows[0][1] : 1;
  h += `<div class="two"><section class="panel"><h2>Spending by category</h2>${rows.length ? `<div class="hbars">${rows.map(([c,v]) => `<div class="hbar static"><span class="hl"><span class="sw" style="background:${groupColor(groupOfCat(catById(c)))}"></span>${esc(catName(c))}</span><span class="num">${money(v)} <span class="muted">${pct(v,spent)}%</span></span><span class="track"><i style="width:${(v/max*100).toFixed(1)}%;background:${groupColor(groupOfCat(catById(c)))}"></i></span></div>`).join("")}</div>` : `<div class="empty">No expenses on this trip yet.</div>`}</section>
    <section class="panel"><h2>Edit trip</h2><form class="form" id="tripEdit" data-trip="${esc(t.id)}">
      <label>Name<input id="teName" type="text" maxlength="40" value="${esc(t.name)}" required></label>
      <label>Start<input id="teStart" type="date" value="${esc(t.start)}" required></label>
      <label>End<input id="teEnd" type="date" value="${esc(t.end||t.start)}" required></label>
      <label>Budget<input id="teBudget" type="number" min="0" step="1" value="${b}"></label>
      <button type="submit">Save trip</button></form>
      <div style="margin-top:12px">${del ? `<button class="danger" data-act="del-trip" data-id="${esc(t.id)}">Delete trip? Its expenses stay, untagged</button>` : `<button class="ghost" data-act="ask-del" data-key="t:${esc(t.id)}">Delete trip</button>`}</div></section></div>`;
  h += `<section class="panel"><h2>Trip expenses</h2>${ex.length ? `<div class="list">${ex.map(e => txRow(e,"out")).join("")}</div>` : `<div class="empty">Nothing yet.</div>`}</section>`;
  return h;
}

/* ---------- Cards ---------- */
function viewCards(){
  const ex = expIn([month]), inc = incIn([month]);
  let h = `<section class="cards">`;
  S.cards.forEach((c, i) => {
    const out = sum(ex.filter(e=>e.cardId===c.id)), inn = sum(inc.filter(e=>e.cardId===c.id)), lim = Number(c.limit||0), del = ui.confirmDel === "k:"+c.id;
    h += `<article class="ccard k-${esc(c.kind||"debit")}" style="--cc:var(--s${(i%8)+1})"><div class="cc-top"><span class="cc-kind">${esc(CARD_KINDS[c.kind]||"Card")}</span>${["credit","debit"].includes(c.kind)?'<span class="chipimg"></span>':""}</div>
      <div class="cc-name">${esc(c.name)}</div>${c.last4?`<div class="num" style="letter-spacing:.14em;opacity:.9">•••• •••• •••• ${esc(c.last4)}</div>`:""}
      <div class="cc-nums"><div><span class="k">Out in ${esc(monthName(month,true))}</span><span class="num">${money(out)}</span></div><div><span class="k">In</span><span class="num">${money(inn)}</span></div></div>
      ${c.kind === "credit" && lim ? `<div class="cc-lim"><span class="small">${pct(out,lim)}% of ${money(lim,true)} limit</span>${meter(out,lim)}</div>` : ""}
      <div class="cc-act"><button data-act="opencard" data-id="${esc(c.id)}" aria-expanded="${ui.cardOpen===c.id}">${ui.cardOpen===c.id?"Hide":"Transactions"}</button><button data-act="import-start" data-id="${esc(c.id)}">${ICON.upload}Import</button>${del?`<button class="danger" data-act="del-card" data-id="${esc(c.id)}">Delete?</button>`:`<button class="ghost" data-act="ask-del" data-key="k:${esc(c.id)}" aria-label="Delete ${esc(c.name)}">✕</button>`}</div></article>`;
  });
  h += `</section>`;
  if (S.cards.length) h = `<section class="panel"><div class="flex"><div><h2>Your cards</h2><div class="muted small">Import a statement (CSV file, PDF or photo) to bring in card transactions automatically.</div></div><button class="primary" data-act="import-start">${ICON.upload}Import statement</button></div></section>` + h;
  if (!S.cards.length) h = `<section class="panel empty">No cards yet. Add your debit card, credit card, bank account or cash below, then choose one whenever you record money in or out.</section>`;
  if (ui.cardOpen && cardById(ui.cardOpen)){
    const c = cardById(ui.cardOpen);
    const all = [...ex.filter(e=>e.cardId===c.id).map(e=>({e,k:"out"})), ...inc.filter(e=>e.cardId===c.id).map(e=>({e,k:"in"}))].sort((a,b)=>byDesc(a.e,b.e));
    h += `<section class="panel"><h2>${esc(c.name)} · ${esc(monthName(month))}</h2>${all.length ? `<div class="list">${all.map(x=>txRow(x.e,x.k)).join("")}</div>` : `<div class="empty">No activity on this card this month.</div>`}</section>`;
  }
  const unassigned = ex.filter(e => !cardById(e.cardId)).length + inc.filter(e => !cardById(e.cardId)).length;
  if (S.cards.length && unassigned) h += `<p class="status">${unassigned} entr${unassigned===1?"y":"ies"} this month aren't linked to a card.</p>`;
  h += `<section class="panel"><h2>Add a card or account</h2><form class="form" id="cardForm">
    <label>Name<input id="ccName" type="text" maxlength="30" required placeholder="e.g. Everyday debit"></label>
    <label>Type<select id="ccKind">${Object.entries(CARD_KINDS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label>
    <label>Last 4 digits (optional)<input id="ccLast4" type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="1234"></label>
    <label>Credit limit (credit cards)<input id="ccLimit" type="number" min="0" step="1" placeholder="0"></label>
    <button class="primary" type="submit">Add card</button></form>
    <p class="status">Only store a nickname and the last 4 digits. Never enter a full card number.</p></section>`;
  return h;
}

/* ---------- Supplies ---------- */
const COMMON_GROCERIES = [["Rice","bags",1],["Cooking oil","bottles",1],["Sugar","bags",1],["Flour","bags",1],["Milk","cartons",1],["Eggs","trays",1],["Bread","loaves",1],["Salt","packs",1]];
function viewSupplies(){
  const f = ui.supplyFilter;
  let h = `<section class="panel"><div class="flex"><div><h2>Supplies</h2><div class="muted small">Scan a shopping receipt to restock everything at once.</div></div><button class="primary" data-act="scan-start">${ICON.camera}Scan receipt</button></div><div class="flex"><span></span><div class="seg" role="group" aria-label="Filter"><button data-act="filter" data-f="all" aria-pressed="${f==="all"}">All</button><button data-act="filter" data-f="low" aria-pressed="${f==="low"}">Need to buy (${lowItems().length})</button></div></div>`;
  for (const [kind, label] of [["grocery","Groceries"],["household","Household items"]]){
    let items = S.items.filter(it => (it.kind || "household") === kind).sort((a,b)=>{ const o={out:0,low:1,ok:2}; return o[stockState(a)]-o[stockState(b)] || a.name.localeCompare(b.name); });
    const lowN = items.filter(it => stockState(it) !== "ok").length;
    if (f === "low") items = items.filter(it => stockState(it) !== "ok");
    h += `<details class="grp" data-key="sup-${kind}"${det("sup-"+kind)}><summary><span class="sw" style="background:${kind==="grocery"?groupColor("Food"):groupColor("Home")}"></span><span class="gname">${label}</span>${lowN?`<span class="pill low">${lowN} to buy</span>`:""}<span class="cnt">${S.items.filter(it => (it.kind||"household")===kind).length} items</span></summary><div class="inner">`;
    if (!items.length) h += f === "low" ? `<div class="empty">Nothing to buy here.</div>` : (kind === "grocery" ? `<div class="empty">No groceries tracked yet. <button class="linkbtn" data-act="seed-groceries">Add common staples</button> or add your own below.</div>` : `<div class="empty">No household items yet. Add tissues, dish soap and more below.</div>`);
    else h += `<div class="list">` + items.map(itemRow).join("") + `</div>`;
    h += `</div></details>`;
  }
  h += `</section>`;
  h += `<section class="panel"><h2>Add a supply</h2><form class="form" id="itemForm">
    <label>Item<input id="itName" type="text" maxlength="50" required placeholder="e.g. Dish soap"></label>
    <label>Type<select id="itKind"><option value="household">Household item</option><option value="grocery">Grocery</option></select></label>
    <label>How many now<input id="itQty" type="number" min="0" step="1" value="1"></label>
    <label>Unit<input id="itUnit" type="text" maxlength="15" placeholder="bottles, rolls, bags"></label>
    <label>Buy more when at or below<input id="itMin" type="number" min="0" step="1" value="1"></label>
    <label>Where it's kept<input id="itLoc" type="text" maxlength="30" placeholder="Kitchen"></label>
    <button class="primary" type="submit">Add supply</button></form></section>`;
  return h;
}
function itemRow(it){
  const st = stockState(it), open = ui.restockOpen === it.id, del = ui.confirmDel === "i:"+it.id;
  const want = (it.kind === "grocery") ? "groceries" : "household";
  const defCat = catById(want) ? want : (S.cats[0]?.id || "");
  let h = `<div class="row item"><div class="grow"><div class="t">${esc(it.name)}</div><div class="s">${esc(it.location||"")}${it.location?" · ":""}restock at ${Number(it.minQty??1)} ${esc(it.unit||"")}</div></div>
    <span class="pill ${st}">${st==="out"?"Out":st==="low"?"Low":"Stocked"}</span>
    <div class="qty"><button class="icon" data-act="qty" data-id="${esc(it.id)}" data-d="-1" aria-label="Used one ${esc(it.name)}">−</button><span class="n" aria-label="Quantity">${qtyOf(it)}</span><button class="icon" data-act="qty" data-id="${esc(it.id)}" data-d="1" aria-label="Add one ${esc(it.name)}">+</button></div>
    <button data-act="restock" data-id="${esc(it.id)}" aria-expanded="${open}">Restock</button>
    ${del?`<button class="danger" data-act="del-item" data-id="${esc(it.id)}">Delete?</button>`:`<button class="ghost" data-act="ask-del" data-key="i:${esc(it.id)}" aria-label="Delete ${esc(it.name)}">✕</button>`}`;
  if (open) h += `<form class="restock" data-form="restock" data-id="${esc(it.id)}"><div class="form">
      <label>How many did you buy?<input id="rsQty" type="number" min="1" step="1" value="${Math.max(1, Number(it.minQty??1)*2 - qtyOf(it))}" required></label>
      <label>Total cost<input id="rsCost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label>
      <label>Log cost under<select id="rsCat">${catOptions(defCat)}</select></label>
      <label>Paid with<select id="rsCard">${cardOptions(S.cards.length===1?S.cards[0].id:"")}</select></label>
      <button class="primary" type="submit">Save restock</button></div>
      <span class="status">If you enter a cost, it's added to your expenses for today, so your budget stays up to date.</span></form>`;
  return h + `</div>`;
}

/* ---------- data ---------- */
function stopData(){ unsubs.forEach(u => u()); unsubs = []; S.got = {}; S.fresh = {}; S.confirmedEmpty = false; S.expenses = []; S.income = []; S.cats = []; S.items = []; S.trips = []; S.cards = []; }
function startData(){
  stopData();
  H = fs.collection("households").doc("home");
  const map = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const fail = e => { stopData(); screen = e && e.code === "permission-denied" ? "notmember" : "error"; authMsg = e && e.message || ""; render(); };
  const checkEmpty = () => { S.confirmedEmpty = S.fresh.c && S.fresh.i && !S.cats.length && !S.items.length; };
  const listen = (name, key, field) => unsubs.push(col(name).onSnapshot({ includeMetadataChanges: true }, s => { S[field] = map(s); S.got[key] = true; if (!s.metadata.fromCache) S.fresh[key] = true; checkEmpty(); render(); }, fail));
  listen("expenses","e","expenses"); listen("income","n","income"); listen("categories","c","cats");
  listen("inventory","i","items"); listen("trips","t","trips"); listen("cards","k","cards");
  unsubs.push(col("settings").doc("main").onSnapshot(s => { if (s.exists) S.settings = { currency: "$", ...s.data() }; render(); }, () => {}));
  screen = "app"; render();
}
function seed(){
  const b = fs.batch();
  for (const [id,name,group,budget] of SUGGESTED_CATS) b.set(col("categories").doc(id), { name, group, budget });
  const items = [["toilet-paper","Toilet paper",6,"rolls",4,"Bathroom"],["tissues","Tissues",2,"boxes",2,"Living room"],["dish-soap","Dish soap",1,"bottles",1,"Kitchen"],["hand-soap","Hand soap",2,"bottles",1,"Bathroom"],["laundry-detergent","Laundry detergent",1,"bottles",1,"Laundry"],["paper-towels","Paper towels",3,"rolls",2,"Kitchen"],["trash-bags","Trash bags",1,"boxes",1,"Kitchen"]];
  for (const [id,name,qty,unit,minQty,location] of items) b.set(col("inventory").doc(id), { name, qty, unit, minQty, location, kind: "household", updatedAt: Date.now() });
  save(b.commit(), "Added suggested categories and supplies. Update the amounts to match your home.");
}
function setQty(id, d){
  const it = S.items.find(i=>i.id===id); if (!it) return;
  pendingQty[id] = Math.max(0, qtyOf(it) + d); render();
  clearTimeout(qtyTimers[id]);
  qtyTimers[id] = setTimeout(() => {
    const q = pendingQty[id];
    col("inventory").doc(id).update({ qty: q, updatedAt: Date.now() }).catch(() => flash("That change didn't save. Try again."));
    setTimeout(() => { if (pendingQty[id] === q) { delete pendingQty[id]; render(); } }, 300);
  }, 500);
}

/* ---------- events ---------- */
document.addEventListener("toggle", ev => {
  const d = ev.target; if (!d.matches || !d.matches("details[data-key]")) return;
  const k = d.dataset.key; if (d.open){ ui.open.add(k); ui.open.delete("x:"+k); } else { ui.open.delete(k); ui.open.add("x:"+k); }
}, true);

document.addEventListener("keydown", ev => { if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches && ev.target.matches("rect.hit")){ ev.preventDefault(); ev.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); } });

document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-act]"); if (!b || b.tagName === "INPUT") return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "mode"){ authMode = b.dataset.m; authMsg = ""; return render(); }
  if (act === "signout"){ stopData(); await auth.signOut(); return; }
  if (act === "resend"){ try { await auth.currentUser.sendEmailVerification(); authMsg = "Link sent again."; } catch(e){ authMsg = authError(e); } return render(); }
  if (act === "verified"){ await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); if (auth.currentUser.emailVerified) startData(); else { authMsg = "Not confirmed yet. Open the link in the email first."; render(); } return; }
  if (act === "retry"){ await auth.currentUser.getIdToken(true); return startData(); }
  if (screen !== "app") return;
  if (scanClick(act, b, ev)) return;
  if (act !== "ask-del" && !act.startsWith("del")) ui.confirmDel = null;
  switch (act){
    case "sheet": ev.preventDefault(); return openSheet(b.dataset.s);
    case "mixgo": ui.period = "1m"; ui.drillYm = null; ui.drillGroup = b.dataset.g; ui.drillCat = null; hideTip(); location.hash = "reports"; return;
    case "seed": return seed();
    case "seed-groceries": { const bt = fs.batch(); for (const [name,unit,minQty] of COMMON_GROCERIES) bt.set(col("inventory").doc("g-" + slug(name)), { name, unit, minQty, qty: 1, location: "Kitchen", kind: "grocery", updatedAt: Date.now() }); return save(bt.commit(), "Added common groceries. Adjust the counts to what you have."); }
    case "add-suggested": { const bt = fs.batch(); for (const [cid,name,group,budget] of SUGGESTED_CATS) if (!catById(cid)) bt.set(col("categories").doc(cid), { name, group, budget }); return save(bt.commit(), "Suggested categories added."); }
    case "qty": return setQty(id, Number(b.dataset.d));
    case "restock": ui.restockOpen = ui.restockOpen === id ? null : id; return render();
    case "goto-restock": { ui.restockOpen = id; ui.supplyFilter = "all"; const it = S.items.find(x=>x.id===id); if (it) ui.open.add("sup-" + (it.kind||"household")); location.hash = "supplies"; return; }
    case "filter": ui.supplyFilter = b.dataset.f; return render();
    case "ask-del": ui.confirmDel = b.dataset.key; return render();
    case "txtype": ui.txType = b.dataset.t; return render();
    case "mview": ui.moneyView = b.dataset.v; return render();
    case "period": ui.period = b.dataset.p; ui.drillYm = null; return render();
    case "drillym": ui.drillYm = b.dataset.ym && ui.drillYm !== b.dataset.ym ? b.dataset.ym : null; hideTip(); return render();
    case "drill": ui.drillGroup = b.dataset.g || null; ui.drillCat = b.dataset.c || null; hideTip(); return render();
    case "toggletable": ui.showTable = !ui.showTable; return render();
    case "opentrip": ui.tripOpen = id; ui.confirmDel = null; if (tab !== "trips") location.hash = "trips"; else render(); scrollTo(0,0); return;
    case "closetrip": ui.tripOpen = null; return render();
    case "opencard": ui.cardOpen = ui.cardOpen === id ? null : id; return render();
    case "del-tx": { ui.confirmDel = null; const k = b.dataset.key, coll = k.startsWith("n:") ? "income" : "expenses"; return save(col(coll).doc(k.slice(2)).delete(), "Deleted."); }
    case "del-item": ui.confirmDel = null; return save(col("inventory").doc(id).delete(), "Supply removed.");
    case "del-cat": ui.confirmDel = null; return save(col("categories").doc(id).delete(), "Category deleted. Its past expenses now show as Other.");
    case "del-card": ui.confirmDel = null; if (ui.cardOpen === id) ui.cardOpen = null; return save(col("cards").doc(id).delete(), "Card removed. Its past entries stay in your history.");
    case "del-trip": ui.confirmDel = null; ui.tripOpen = null; return save(col("trips").doc(id).delete(), "Trip deleted. Its expenses are kept.");
  }
});

document.addEventListener("change", ev => {
  const el = ev.target; if (screen !== "app" || !el.dataset) return;
  if (el.dataset.act === "budget"){ const v = Math.max(0, Number(el.value)||0), c = catById(el.dataset.id); if (c && Number(c.budget||0) !== v) save(col("categories").doc(c.id).update({ budget: v }), `${c.name} budget saved.`); }
  if (el.dataset.act === "group"){ const v = el.value.trim().slice(0,24) || "Other", c = catById(el.dataset.id); if (c && groupOfCat(c) !== v) save(col("categories").doc(c.id).update({ group: v }), `${c.name} moved to ${v}.`); }
  if (el.dataset.act === "inctrips"){ ui.incTrips = el.checked; render(); }
});

document.addEventListener("submit", async ev => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === "authForm"){
    const email = $("#auEmail").value.trim(), pass = $("#auPass") ? $("#auPass").value : "";
    authMsg = "";
    try {
      if (authMode === "signup"){ const cred = await auth.createUserWithEmailAndPassword(email, pass); await cred.user.sendEmailVerification(); }
      else if (authMode === "reset"){ await auth.sendPasswordResetEmail(email); authMode = "signin"; authMsg = "Check your email for a link to set a new password."; }
      else await auth.signInWithEmailAndPassword(email, pass);
    } catch(e){ authMsg = authError(e); }
    return render();
  }
  if (screen !== "app") return;
  const amt = v => Math.round(Number(v)*100)/100;
  if (f.id === "txForm"){
    const amount = amt($("#txAmount").value); if (!(amount > 0)) return;
    const date = $("#txDate").value || todayISO(), note = $("#txNote").value.trim(), cardId = $("#txCard").value;
    if (ui.txType === "income"){
      const source = $("#txSource").value.trim() || "Income";
      $("#txAmount").value = ""; $("#txNote").value = "";
      save(col("income").add({ amount, source, date, note, cardId, createdAt: Date.now() }), `Added ${money(amount)} income.`);
    } else {
      const category = $("#txCat").value, tripId = $("#txTrip").value;
      $("#txAmount").value = ""; $("#txNote").value = "";
      save(col("expenses").add({ amount, category, date, note, cardId, tripId, createdAt: Date.now() }), `Added ${money(amount)} to ${catName(category)}${tripId && tripById(tripId) ? " on " + tripById(tripId).name : ""}.`);
    }
    if (ymOf(date) !== month){ month = ymOf(date); render(); }
    const a = $("#txAmount"); if (a) a.focus();
  }
  if (f.id === "tripExpForm"){
    const amount = amt($("#teAmount").value); if (!(amount > 0)) return;
    const tripId = f.dataset.trip, category = $("#teCat").value, date = $("#teDate").value || todayISO(), cardId = $("#teCard").value, note = $("#teNote").value.trim();
    $("#teAmount").value = ""; $("#teNote").value = "";
    save(col("expenses").add({ amount, category, date, note, cardId, tripId, createdAt: Date.now() }), `Added ${money(amount)} to the trip.`);
  }
  if (f.id === "tripForm"){
    const name = $("#trName").value.trim(), start = $("#trStart").value, end = $("#trEnd").value < start ? start : $("#trEnd").value;
    if (!name || !start) return;
    const budget = Math.max(0, Number($("#trBudget").value)||0); f.reset();
    save(col("trips").add({ name, start, end, budget, createdAt: Date.now() }), `${name} added.`);
  }
  if (f.id === "tripEdit"){
    const start = $("#teStart").value, end = $("#teEnd").value < start ? start : $("#teEnd").value;
    save(col("trips").doc(f.dataset.trip).update({ name: $("#teName").value.trim() || "Trip", start, end, budget: Math.max(0, Number($("#teBudget").value)||0) }), "Trip saved.");
  }
  if (f.id === "cardForm"){
    const name = $("#ccName").value.trim(); if (!name) return;
    const last4 = ($("#ccLast4").value.match(/\d{4}/) || [""])[0];
    const rec = { name, kind: $("#ccKind").value, last4, limit: Math.max(0, Number($("#ccLimit").value)||0), createdAt: Date.now() };
    f.reset(); save(col("cards").add(rec), `${name} added.`);
  }
  if (f.id === "catForm"){
    const name = $("#catName").value.trim(); if (!name) return;
    let id = slug(name); if (catById(id)) id += "-" + Date.now().toString(36);
    const budget = Math.max(0, Number($("#catBudget").value)||0), group = $("#catGroup").value.trim().slice(0,24) || "Other"; f.reset();
    save(col("categories").doc(id).set({ name, group, budget }), `${name} added to ${group}.`);
  }
  if (f.id === "curForm"){ const sym = $("#curSym").value.trim() || "$"; save(col("settings").doc("main").set({ ...S.settings, currency: sym }), "Currency saved."); }
  if (f.id === "itemForm"){
    const name = $("#itName").value.trim(); if (!name) return;
    const rec = { name, kind: $("#itKind").value, qty: Math.max(0, Number($("#itQty").value)||0), unit: $("#itUnit").value.trim(), minQty: Math.max(0, Number($("#itMin").value)||0), location: $("#itLoc").value.trim(), updatedAt: Date.now() };
    ui.open.add("sup-" + rec.kind); f.reset();
    save(col("inventory").add(rec), `${name} added to supplies.`);
  }
  if (f.dataset.form === "restock"){
    const id = f.dataset.id, it = S.items.find(i=>i.id===id); if (!it) return;
    const n = Math.max(1, Number($("#rsQty").value)||1), cost = amt($("#rsCost").value||0), cat = $("#rsCat").value, cardId = $("#rsCard").value;
    ui.restockOpen = null;
    const bt = fs.batch();
    bt.update(col("inventory").doc(id), { qty: qtyOf(it) + n, updatedAt: Date.now() });
    if (cost > 0) bt.set(col("expenses").doc(), { amount: cost, category: cat, date: todayISO(), note: `Restock: ${it.name} ×${n}`, cardId, tripId: "", createdAt: Date.now() });
    save(bt.commit(), cost > 0 ? `${it.name} restocked and ${money(cost)} logged under ${catName(cat)}.` : `${it.name} restocked.`);
  }
});

$("#fab").onclick = () => openSheet("add");
$("#prevMonth").onclick = () => { month = shiftMonth(month,-1); ui.drillYm = null; render(); };
$("#nextMonth").onclick = () => { month = shiftMonth(month, 1); ui.drillYm = null; render(); };
function route(){ const h = location.hash.slice(1); tab = TABS.includes(h) ? h : "overview"; ui.confirmDel = null; hideTip(); render(); }
window.addEventListener("hashchange", route);

/* ---------- connection, install, offline ---------- */
function net(){ $("#netChip").hidden = navigator.onLine; }
window.addEventListener("online", net); window.addEventListener("offline", net); net();
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("#installBtn").hidden = false; });
$("#installBtn").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#installBtn").hidden = true; };
window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

/* ---------- start ---------- */
buildNav();
route();
if (!configured){ screen = "setup"; render(); }
else auth.onAuthStateChanged(user => {
  authMsg = "";
  if (!user){ stopData(); screen = "signin"; render(); }
  else if (!user.emailVerified){ stopData(); screen = "verify"; render(); }
  else startData();
});
