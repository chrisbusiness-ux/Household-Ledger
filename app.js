/* Household Ledger — spending, budgets and household supplies, synced with Firebase. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const ymOf = d => (d || "").slice(0,7);

let month = todayISO().slice(0,7);
let tab = "overview";
let screen = "loading";      // loading | setup | signin | verify | notmember | error | app
let authMode = "signin";     // signin | signup | reset
let authMsg = "";
let H = null;                // Firestore reference to the household document
let unsubs = [];
const S = { expenses: [], cats: [], items: [], settings: { currency: "$" }, got: { e:false, c:false, i:false }, confirmedEmpty: false };
const ui = { restockOpen: null, confirmDel: null, supplyFilter: "all", msg: "" };
const pendingQty = {}; const qtyTimers = {};

/* ---------- Firebase ---------- */
const CFG = window.FIREBASE_CONFIG || {};
const configured = CFG.apiKey && !String(CFG.apiKey).startsWith("PASTE");
let auth = null, fs = null;
if (configured) {
  firebase.initializeApp(CFG);
  auth = firebase.auth();
  fs = firebase.firestore();
  fs.enablePersistence({ synchronizeTabs: true }).catch(() => {}); // offline copy on this device
}

/* ---------- helpers ---------- */
function money(n){
  const c = S.settings.currency || "$";
  const v = Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  return (n < 0 ? "−" : "") + c + v;
}
function monthName(ym){ const [y,m] = ym.split("-").map(Number); return new Date(y, m-1, 1).toLocaleString(undefined,{month:"long",year:"numeric"}); }
function shiftMonth(ym, d){ let [y,m] = ym.split("-").map(Number); m += d; while(m<1){m+=12;y--} while(m>12){m-=12;y++} return `${y}-${pad(m)}`; }
function catName(id){ const c = S.cats.find(c => c.id === id); return c ? c.name : (id ? "Other" : "Uncategorized"); }
function qtyOf(it){ return pendingQty[it.id] ?? it.qty ?? 0; }
function stockState(it){ const q = qtyOf(it), m = Number(it.minQty ?? 1); return q <= 0 ? "out" : (q <= m ? "low" : "ok"); }
function lowItems(){ return S.items.filter(it => stockState(it) !== "ok"); }
function monthExpenses(){ return S.expenses.filter(e => ymOf(e.date) === month).sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.createdAt||0)-(a.createdAt||0)); }
function spentBy(list){ const m = {}; for (const e of list) m[e.category] = (m[e.category]||0) + Number(e.amount||0); return m; }
function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60) || ("c-" + Date.now()); }
function flash(t){ ui.msg = t; render(); clearTimeout(flash.t); flash.t = setTimeout(()=>{ ui.msg=""; render(); }, 3500); }
function col(name){ return H.collection(name); }
// Writes apply on this phone straight away and sync when there's a connection, so we don't wait for the server.
function save(p, okMsg){
  if (okMsg) flash(okMsg);
  Promise.resolve(p).catch(e => flash(e && e.code === "permission-denied" ? "This account isn't allowed to change the household's data." : "That change didn't save. Try again."));
}
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

/* ---------- render ---------- */
function render(){
  const inApp = screen === "app";
  $("#tabs").hidden = !inApp; $("#monthNav").hidden = !inApp;
  $("#monthLabel").textContent = monthName(month);
  document.querySelectorAll("#tabs a").forEach(a => { if (a.dataset.tab === tab) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  const low = lowItems().length; const dot = $("#lowDot"); dot.hidden = !low || !inApp; dot.textContent = low;
  const v = $("#view");
  let html;
  if (screen === "app") {
    html = "";
    if (ui.msg) html += `<div class="banner" role="status">${esc(ui.msg)}</div>`;
    if (!(S.got.e && S.got.c && S.got.i)) html += `<div class="panel empty">Loading your household…</div>`;
    else html += ({overview:viewOverview, expenses:viewExpenses, budget:viewBudget, supplies:viewSupplies})[tab]();
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
}

function viewAuth(){
  if (screen === "loading") return `<div class="panel empty">Loading…</div>`;
  if (screen === "setup") return `<div class="auth panel"><h2>Almost ready</h2><p>This app isn't connected to your Firebase project yet. Open <b>config.js</b> and paste in the settings from your Firebase project, then reload this page.</p></div>`;
  if (screen === "error") return `<div class="auth panel"><h2>Can't load your household</h2><p>${esc(authMsg || "Check your internet connection and reload.")}</p><button data-act="signout">Sign out</button></div>`;
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

function catOptions(sel){
  const opts = S.cats.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c => `<option value="${esc(c.id)}"${c.id===sel?" selected":""}>${esc(c.name)}</option>`).join("");
  return opts || `<option value="">Add a category in Budget first</option>`;
}
function barClass(p){ return p > 1 ? "bad" : (p >= .8 ? "warn" : ""); }

function viewOverview(){
  const list = monthExpenses();
  const spent = list.reduce((s,e)=>s+Number(e.amount||0),0);
  const budget = S.cats.reduce((s,c)=>s+Number(c.budget||0),0);
  const left = budget - spent;
  const by = spentBy(list);
  const low = lowItems();
  let h = "";
  if (!S.cats.length && !S.items.length && S.confirmedEmpty) h += `<div class="banner"><span>Your ledger is empty. Start with suggested categories (Groceries, Utilities…) and common supplies (tissues, dish soap…)? You can change or delete any of them.</span><button class="primary" data-act="seed">Add suggestions</button></div>`;
  h += `<section class="stats" aria-label="This month">
    <div class="stat"><div class="k">Spent</div><div class="v num">${money(spent)}</div></div>
    <div class="stat"><div class="k">Monthly budget</div><div class="v num">${money(budget)}</div></div>
    <div class="stat"><div class="k">${left<0?"Over budget":"Left to spend"}</div><div class="v num ${left<0?"bad":"good"}">${money(Math.abs(left))}</div></div>
    <div class="stat"><div class="k">Supplies to buy</div><div class="v num ${low.length?"bad":""}">${low.length}</div></div>
  </section>`;
  const cats = S.cats.slice().sort((a,b)=>(by[b.id]||0)-(by[a.id]||0));
  const stray = Object.keys(by).filter(k => !S.cats.some(c=>c.id===k));
  h += `<div class="two"><section class="panel"><h2>Budget by category</h2>`;
  if (!cats.length && !stray.length) h += `<div class="empty">No categories yet. Add them on the Budget tab.</div>`;
  for (const c of cats){
    const s = by[c.id]||0, b = Number(c.budget||0), p = b ? s/b : (s?2:0);
    h += `<div class="catrow"><div class="h"><span>${esc(c.name)}</span><span class="num">${money(s)} <span class="muted">/ ${money(b)}</span></span></div><div class="bar"><i class="${barClass(p)}" style="width:${Math.min(100,p*100).toFixed(1)}%"></i></div></div>`;
  }
  for (const k of stray) h += `<div class="catrow"><div class="h"><span>${esc(catName(k))}</span><span class="num">${money(by[k])} <span class="muted">/ no budget</span></span></div></div>`;
  h += `</section><section class="panel"><h2>Shopping list</h2>`;
  if (!low.length) h += `<div class="empty">Everything is stocked.</div>`;
  else h += `<div class="list">` + low.map(it => `<div class="row"><div class="grow"><div class="t">${esc(it.name)}</div><div class="s">${qtyOf(it)} ${esc(it.unit||"")} left · restock at ${Number(it.minQty??1)}</div></div><span class="pill ${stockState(it)}">${stockState(it)==="out"?"Out":"Low"}</span><button data-act="goto-restock" data-id="${esc(it.id)}">Restock</button></div>`).join("") + `</div>`;
  h += `</section></div>`;
  h += `<section class="panel"><div class="flex"><h2>Recent expenses</h2><a class="btn" href="#expenses">Add expense</a></div>`;
  h += list.length ? `<div class="list">` + list.slice(0,5).map(expRow).join("") + `</div>` : `<div class="empty">Nothing spent in ${esc(monthName(month))} yet.</div>`;
  return h + `</section>`;
}

function expRow(e){
  const del = ui.confirmDel === "e:"+e.id;
  return `<div class="row"><div class="grow"><div class="t">${esc(e.note || catName(e.category))}</div><div class="s">${esc(catName(e.category))} · ${esc(new Date(e.date+"T12:00").toLocaleDateString(undefined,{month:"short",day:"numeric"}))}</div></div><span class="num">${money(Number(e.amount||0))}</span>${del?`<button class="danger" data-act="del-exp" data-id="${esc(e.id)}">Delete?</button>`:`<button class="ghost" data-act="ask-del" data-key="e:${esc(e.id)}" aria-label="Delete expense">✕</button>`}</div>`;
}

function viewExpenses(){
  const list = monthExpenses();
  const total = list.reduce((s,e)=>s+Number(e.amount||0),0);
  const defDate = month === todayISO().slice(0,7) ? todayISO() : month + "-01";
  let h = `<section class="panel"><h2>Add an expense</h2><form class="form" id="expForm">
    <label>Amount<input id="exAmount" type="number" step="0.01" min="0" inputmode="decimal" required placeholder="0.00"></label>
    <label>Category<select id="exCat">${catOptions(S.cats.find(c=>c.id==="groceries")?"groceries":"")}</select></label>
    <label>Date<input id="exDate" type="date" value="${defDate}" required></label>
    <label>What was it?<input id="exNote" type="text" maxlength="80" placeholder="e.g. Weekly groceries"></label>
    <button class="primary" type="submit">Add expense</button></form></section>`;
  h += `<section class="panel"><div class="flex"><h2>${esc(monthName(month))}</h2><span class="num">${money(total)} total</span></div>`;
  if (!list.length) h += `<div class="empty">No expenses this month. Add your first one above.</div>`;
  else {
    let last = ""; h += `<div class="list">`;
    for (const e of list){
      if (e.date !== last){ last = e.date; h += `<div class="daygroup">${esc(new Date(e.date+"T12:00").toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"}))}</div>`; }
      h += expRow(e);
    }
    h += `</div>`;
  }
  return h + `</section>`;
}

function viewBudget(){
  const by = spentBy(monthExpenses());
  const cats = S.cats.slice().sort((a,b)=>a.name.localeCompare(b.name));
  let total = 0, totalSpent = 0;
  let h = `<section class="panel"><h2>Monthly budget</h2><p class="muted" style="margin:0 0 10px">Set how much you plan to spend each month. Changes save when you leave the box.</p><div class="tablewrap"><table><thead><tr><th>Category</th><th class="r">Budget</th><th class="r">Spent (${esc(monthName(month))})</th><th class="r">Left</th><th></th></tr></thead><tbody>`;
  for (const c of cats){
    const b = Number(c.budget||0), s = by[c.id]||0; total += b; totalSpent += s;
    const del = ui.confirmDel === "c:"+c.id;
    h += `<tr><td>${esc(c.name)}</td><td class="r"><input id="bud-${esc(c.id)}" class="num" type="number" min="0" step="1" inputmode="decimal" value="${b}" data-act="budget" data-id="${esc(c.id)}" aria-label="Budget for ${esc(c.name)}"></td><td class="r num">${money(s)}</td><td class="r num" style="color:var(--${b-s<0?"bad":"ink"})">${money(b-s)}</td><td class="r">${del?`<button class="danger" data-act="del-cat" data-id="${esc(c.id)}">Delete?</button>`:`<button class="ghost" data-act="ask-del" data-key="c:${esc(c.id)}" aria-label="Delete ${esc(c.name)}">✕</button>`}</td></tr>`;
  }
  h += `</tbody><tfoot><tr><th>Total</th><th class="r num">${money(total)}</th><th class="r num">${money(totalSpent)}</th><th class="r num">${money(total-totalSpent)}</th><th></th></tr></tfoot></table></div></section>`;
  h += `<section class="panel"><h2>Add a category</h2><form class="form" id="catForm"><label>Name<input id="catName" type="text" maxlength="40" required placeholder="e.g. Kids"></label><label>Monthly budget<input id="catBudget" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></label><button class="primary" type="submit">Add category</button></form></section>`;
  h += `<section class="panel"><h2>Currency</h2><form class="form" id="curForm"><label>Symbol shown before amounts<input id="curSym" type="text" maxlength="4" value="${esc(S.settings.currency||"$")}"></label><button type="submit">Save currency</button></form></section>`;
  h += `<section class="panel acct"><span class="muted">Signed in as <b>${esc(auth.currentUser ? auth.currentUser.email : "")}</b></span><button data-act="signout">Sign out</button></section>`;
  return h;
}

function viewSupplies(){
  const f = ui.supplyFilter;
  let items = S.items.slice().sort((a,b)=>{ const o={out:0,low:1,ok:2}; return o[stockState(a)]-o[stockState(b)] || a.name.localeCompare(b.name); });
  if (f === "low") items = items.filter(it => stockState(it) !== "ok");
  let h = `<section class="panel"><div class="flex"><h2>Household supplies</h2><div class="seg" role="group" aria-label="Filter"><button data-act="filter" data-f="all" aria-pressed="${f==="all"}">All</button><button data-act="filter" data-f="low" aria-pressed="${f==="low"}">Need to buy (${lowItems().length})</button></div></div>`;
  if (!items.length) h += `<div class="empty">${f==="low"?"Nothing needs restocking.":"No supplies yet. Add tissues, dish soap and the rest below."}</div>`;
  else h += `<div class="list">` + items.map(itemRow).join("") + `</div>`;
  h += `</section>`;
  h += `<section class="panel"><h2>Add a supply</h2><form class="form" id="itemForm">
    <label>Item<input id="itName" type="text" maxlength="50" required placeholder="e.g. Dish soap"></label>
    <label>How many now<input id="itQty" type="number" min="0" step="1" value="1"></label>
    <label>Unit<input id="itUnit" type="text" maxlength="15" placeholder="bottles, rolls, boxes"></label>
    <label>Buy more when at or below<input id="itMin" type="number" min="0" step="1" value="1"></label>
    <label>Where it's kept<input id="itLoc" type="text" maxlength="30" placeholder="Kitchen"></label>
    <button class="primary" type="submit">Add supply</button></form></section>`;
  return h;
}

function itemRow(it){
  const st = stockState(it), open = ui.restockOpen === it.id, del = ui.confirmDel === "i:"+it.id;
  const defCat = S.cats.find(c=>c.id==="household") ? "household" : (S.cats[0]?.id || "");
  let h = `<div class="row item"><div class="grow"><div class="t">${esc(it.name)}</div><div class="s">${esc(it.location||"")}${it.location?" · ":""}restock at ${Number(it.minQty??1)} ${esc(it.unit||"")}</div></div>
    <span class="pill ${st}">${st==="out"?"Out":st==="low"?"Low":"Stocked"}</span>
    <div class="qty"><button class="icon" data-act="qty" data-id="${esc(it.id)}" data-d="-1" aria-label="Used one ${esc(it.name)}">−</button><span class="n" aria-label="Quantity">${qtyOf(it)}</span><button class="icon" data-act="qty" data-id="${esc(it.id)}" data-d="1" aria-label="Add one ${esc(it.name)}">+</button></div>
    <button data-act="restock" data-id="${esc(it.id)}" aria-expanded="${open}">Restock</button>
    ${del?`<button class="danger" data-act="del-item" data-id="${esc(it.id)}">Delete?</button>`:`<button class="ghost" data-act="ask-del" data-key="i:${esc(it.id)}" aria-label="Delete ${esc(it.name)}">✕</button>`}`;
  if (open) h += `<form class="restock" data-form="restock" data-id="${esc(it.id)}"><div class="form">
      <label>How many did you buy?<input id="rsQty" type="number" min="1" step="1" value="${Math.max(1, Number(it.minQty??1)*2 - qtyOf(it))}" required></label>
      <label>Total cost<input id="rsCost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label>
      <label>Log cost under<select id="rsCat">${catOptions(defCat)}</select></label>
      <button class="primary" type="submit">Save restock</button></div>
      <span class="status">If you enter a cost, it's added to Expenses for today, so your budget stays up to date.</span></form>`;
  return h + `</div>`;
}

/* ---------- data ---------- */
function stopData(){ unsubs.forEach(u => u()); unsubs = []; S.got = {e:false,c:false,i:false}; S.confirmedEmpty = false; S.expenses = []; S.cats = []; S.items = []; }
function startData(){
  stopData();
  H = fs.collection("households").doc("home");
  const map = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const fail = e => { stopData(); screen = e && e.code === "permission-denied" ? "notmember" : "error"; authMsg = e && e.message || ""; render(); };
  let fresh = { c:false, i:false };
  const checkEmpty = () => { S.confirmedEmpty = fresh.c && fresh.i && !S.cats.length && !S.items.length; };
  unsubs.push(col("expenses").onSnapshot({ includeMetadataChanges: false }, s => { S.expenses = map(s); S.got.e = true; render(); }, fail));
  unsubs.push(col("categories").onSnapshot({ includeMetadataChanges: true }, s => { S.cats = map(s); S.got.c = true; if (!s.metadata.fromCache) fresh.c = true; checkEmpty(); render(); }, fail));
  unsubs.push(col("inventory").onSnapshot({ includeMetadataChanges: true }, s => { S.items = map(s); S.got.i = true; if (!s.metadata.fromCache) fresh.i = true; checkEmpty(); render(); }, fail));
  unsubs.push(col("settings").doc("main").onSnapshot(s => { if (s.exists) S.settings = { currency: "$", ...s.data() }; render(); }, () => {}));
  screen = "app"; render();
}

function seed(){
  const b = fs.batch();
  const cats = [["groceries","Groceries",400],["household","Household supplies",80],["utilities","Utilities",150],["transport","Transport",120],["eating-out","Eating out",60],["other","Other",50]];
  for (const [id,name,budget] of cats) b.set(col("categories").doc(id), { name, budget });
  const items = [["toilet-paper","Toilet paper",6,"rolls",4,"Bathroom"],["tissues","Tissues",2,"boxes",2,"Living room"],["dish-soap","Dish soap",1,"bottles",1,"Kitchen"],["hand-soap","Hand soap",2,"bottles",1,"Bathroom"],["laundry-detergent","Laundry detergent",1,"bottles",1,"Laundry"],["paper-towels","Paper towels",3,"rolls",2,"Kitchen"],["trash-bags","Trash bags",1,"boxes",1,"Kitchen"]];
  for (const [id,name,qty,unit,minQty,location] of items) b.set(col("inventory").doc(id), { name, qty, unit, minQty, location, updatedAt: Date.now() });
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
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-act]"); if (!b || b.tagName === "INPUT") return;
  const act = b.dataset.act, id = b.dataset.id;
  // account actions
  if (act === "mode"){ authMode = b.dataset.m; authMsg = ""; return render(); }
  if (act === "signout"){ stopData(); await auth.signOut(); return; }
  if (act === "resend"){ try { await auth.currentUser.sendEmailVerification(); authMsg = "Link sent again."; } catch(e){ authMsg = authError(e); } return render(); }
  if (act === "verified"){
    await auth.currentUser.reload(); await auth.currentUser.getIdToken(true);
    if (auth.currentUser.emailVerified) startData(); else { authMsg = "Not confirmed yet. Open the link in the email first."; render(); }
    return;
  }
  if (act === "retry"){ await auth.currentUser.getIdToken(true); return startData(); }
  if (screen !== "app") return;
  // ledger actions
  if (act !== "ask-del" && !act.startsWith("del")) ui.confirmDel = null;
  if (act === "seed") return seed();
  if (act === "qty") return setQty(id, Number(b.dataset.d));
  if (act === "restock"){ ui.restockOpen = ui.restockOpen === id ? null : id; return render(); }
  if (act === "goto-restock"){ ui.restockOpen = id; ui.supplyFilter = "all"; location.hash = "supplies"; return; }
  if (act === "filter"){ ui.supplyFilter = b.dataset.f; return render(); }
  if (act === "ask-del"){ ui.confirmDel = b.dataset.key; return render(); }
  if (act === "del-exp"){ ui.confirmDel = null; return save(col("expenses").doc(id).delete(), "Expense deleted."); }
  if (act === "del-item"){ ui.confirmDel = null; return save(col("inventory").doc(id).delete(), "Supply removed."); }
  if (act === "del-cat"){ ui.confirmDel = null; return save(col("categories").doc(id).delete(), "Category deleted. Its past expenses now show as Other."); }
});

document.addEventListener("change", ev => {
  const el = ev.target;
  if (screen === "app" && el.dataset && el.dataset.act === "budget"){
    const v = Math.max(0, Number(el.value)||0), c = S.cats.find(c=>c.id===el.dataset.id);
    if (c && Number(c.budget||0) !== v) save(col("categories").doc(c.id).update({ budget: v }), `${c.name} budget saved.`);
  }
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
  const by = (auth.currentUser && auth.currentUser.email || "").split("@")[0];
  if (f.id === "expForm"){
    const amount = Math.round(Number($("#exAmount").value)*100)/100; if (!(amount > 0)) return;
    const cat = $("#exCat").value, date = $("#exDate").value || todayISO(), note = $("#exNote").value.trim();
    $("#exAmount").value = ""; $("#exNote").value = "";
    save(col("expenses").add({ amount, category: cat, date, note, by, createdAt: Date.now() }), `Added ${money(amount)} to ${catName(cat)}.`);
    if (ymOf(date) !== month){ month = ymOf(date); render(); }
    const a = $("#exAmount"); if (a) a.focus();
  }
  if (f.id === "catForm"){
    const name = $("#catName").value.trim(); if (!name) return;
    let id = slug(name); if (S.cats.some(c=>c.id===id)) id += "-" + Date.now().toString(36);
    const budget = Math.max(0, Number($("#catBudget").value)||0); f.reset();
    save(col("categories").doc(id).set({ name, budget }), `${name} added.`);
  }
  if (f.id === "curForm"){
    const sym = $("#curSym").value.trim() || "$";
    save(col("settings").doc("main").set({ ...S.settings, currency: sym }), "Currency saved.");
  }
  if (f.id === "itemForm"){
    const name = $("#itName").value.trim(); if (!name) return;
    const rec = { name, qty: Math.max(0, Number($("#itQty").value)||0), unit: $("#itUnit").value.trim(), minQty: Math.max(0, Number($("#itMin").value)||0), location: $("#itLoc").value.trim(), updatedAt: Date.now() };
    f.reset();
    save(col("inventory").add(rec), `${name} added to supplies.`);
  }
  if (f.dataset.form === "restock"){
    const id = f.dataset.id, it = S.items.find(i=>i.id===id); if (!it) return;
    const n = Math.max(1, Number($("#rsQty").value)||1), cost = Math.round(Number($("#rsCost").value||0)*100)/100, cat = $("#rsCat").value;
    ui.restockOpen = null;
    const b = fs.batch();
    b.update(col("inventory").doc(id), { qty: qtyOf(it) + n, updatedAt: Date.now() });
    if (cost > 0) b.set(col("expenses").doc(), { amount: cost, category: cat, date: todayISO(), note: `Restock: ${it.name} ×${n}`, by, createdAt: Date.now() });
    save(b.commit(), cost > 0 ? `${it.name} restocked and ${money(cost)} logged under ${catName(cat)}.` : `${it.name} restocked.`);
  }
});

$("#prevMonth").onclick = () => { month = shiftMonth(month,-1); render(); };
$("#nextMonth").onclick = () => { month = shiftMonth(month, 1); render(); };
function route(){ const h = location.hash.slice(1); tab = ["overview","expenses","budget","supplies"].includes(h) ? h : "overview"; ui.confirmDel = null; render(); }
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
route();
if (!configured){ screen = "setup"; render(); }
else auth.onAuthStateChanged(user => {
  authMsg = "";
  if (!user){ stopData(); screen = "signin"; render(); }
  else if (!user.emailVerified){ stopData(); screen = "verify"; render(); }
  else startData();
});
