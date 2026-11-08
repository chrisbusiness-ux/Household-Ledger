/* Household Ledger — quick-add sheet, receipt scanning and card statement import.
   Loaded before app.js; uses its helpers (S, col, fs, money, catOptions…) at run time. */

const SC = { sheet: null, scan: null, imp: null };

/* ---------- AI (Firebase AI Logic, Gemini Developer API) ---------- */
let aiLib = null;
async function aiModel(schemaFn){
  const V = window.AI_SDK_VERSION || "13.2.0";
  const base = `https://www.gstatic.com/firebasejs/${V}/`;
  if (!aiLib){
    const appMod = await import(base + "firebase-app.js");
    const aiMod = await import(base + "firebase-ai.js");
    const app = appMod.getApps().find(a => a.name === "ledger-ai") || appMod.initializeApp(window.FIREBASE_CONFIG, "ledger-ai");
    if (window.RECAPTCHA_SITE_KEY){
      const ac = await import(base + "firebase-app-check.js");
      ac.initializeAppCheck(app, { provider: new ac.ReCaptchaV3Provider(window.RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
    }
    aiLib = { aiMod, ai: aiMod.getAI(app, { backend: new aiMod.GoogleAIBackend() }) };
  }
  const { aiMod, ai } = aiLib;
  return aiMod.getGenerativeModel(ai, { model: window.AI_MODEL || "gemini-3.8-flash",
    generationConfig: { responseMimeType: "application/json", responseSchema: schemaFn(aiMod.Schema), temperature: 0.1 } });
}
async function aiJSON(schemaFn, prompt, file){
  const model = await aiModel(schemaFn);
  const parts = [prompt]; if (file) parts.push({ inlineData: { data: file.data, mimeType: file.mime } });
  const res = await model.generateContent(parts);
  return JSON.parse(res.response.text());
}
function aiErrorText(e){
  const m = String((e && (e.message || e.code)) || e || "");
  if (/app.?check|appcheck|attestation|recaptcha/i.test(m)) return "The AI service rejected this app's security check. Finish App Check setup (guide, part 9) or turn off App Check enforcement for AI Logic.";
  if (/403|401|permission|not been used|disabled|enable|api-not-enabled|PERMISSION_DENIED/i.test(m)) return "AI isn't switched on for your Firebase project yet. Follow part 9 of the setup guide (AI services → AI Logic → Get started).";
  if (/404|not found|model/i.test(m) && /model/i.test(m)) return "The AI model named in config.js isn't available any more. Update AI_MODEL in config.js (see the guide).";
  if (/429|quota|exhausted|rate/i.test(m)) return "You've hit the free AI limit for now. Try again later, or enter the items by hand.";
  if (/Failed to fetch|import|network|load/i.test(m)) return "Couldn't reach the AI service. Check your internet connection and try again.";
  return "Couldn't read that. Try a clearer, well-lit photo, or enter the details by hand.";
}
async function fileToPart(file){
  if (file.type === "application/pdf"){
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(file); });
    return { data, mime: "application/pdf", preview: "" };
  }
  const bmp = await createImageBitmap(file).catch(async () => { const img = new Image(); img.src = URL.createObjectURL(file); await img.decode(); return img; });
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width*scale); c.height = Math.round(bmp.height*scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.85);
  return { data: url.split(",")[1], mime: "image/jpeg", preview: url };
}

/* ---------- sheets ---------- */
function openSheet(name){ SC.sheet = name; renderSheet(); }
function closeSheet(){ SC.sheet = null; SC.scan = null; SC.imp = null; renderSheet(); }
function sheetWrap(title, body, sub){
  return `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div>
    <div class="head"><div><h2 style="margin:0">${esc(title)}</h2>${sub ? `<div class="muted small">${sub}</div>` : ""}</div><button class="ghost" data-act="sheet-close" aria-label="Close">✕</button></div>${body}</div></div>`;
}
function renderSheet(){
  const root = $("#sheetRoot");
  if (!SC.sheet){ root.innerHTML = ""; document.body.style.overflow = ""; return; }
  document.body.style.overflow = "hidden";
  let html = "";
  if (SC.sheet === "add") html = sheetWrap("Add", `<div class="actions">
      <button data-act="quick" data-q="expense">${ICON.expense}Expense<small>Something you paid for</small></button>
      <button data-act="quick" data-q="income">${ICON.income}Income<small>Pay or money received</small></button>
      <button data-act="scan-start">${ICON.camera}Scan receipt<small>Restock supplies and log the cost</small></button>
      <button data-act="import-start">${ICON.upload}Import statement<small>Card or bank transactions</small></button>
      <button data-act="quick" data-q="trip">${ICON.trips}Plan a trip<small>Dates and a budget</small></button>
      <button data-act="quick" data-q="card">${ICON.cards}Add a card<small>Debit, credit, cash…</small></button></div>`);
  if (SC.sheet === "more") html = sheetWrap("More", `<div class="actions">
      <button data-act="go" data-t="budget">${ICON.budget}Budget<small>Monthly limits by category</small></button>
      <button data-act="go" data-t="cards">${ICON.cards}Cards<small>Accounts and statement import</small></button>
      <button data-act="go" data-t="trips">${ICON.trips}Trips<small>Trip budgets</small></button>
      <button data-act="go" data-t="supplies">${ICON.supplies}Supplies<small>Groceries and household items</small></button></div>`);
  if (SC.sheet === "scan") html = scanSheet();
  if (SC.sheet === "import") html = importSheet();
  root.innerHTML = html;
}

/* ---------- receipt scanning ---------- */
function startScan(){ SC.scan = { stage: "pick" }; openSheet("scan"); }
function scanSheet(){
  const s = SC.scan;
  if (s.stage === "pick") return sheetWrap("Scan a receipt", `<div class="drop">${ICON.camera}
      <div><b>Take a photo of your shopping receipt</b><div class="muted small">Lay it flat in good light so all the lines are readable.</div></div>
      <label class="btn primary">${ICON.camera}Take or choose a photo<input id="scanFile" type="file" accept="image/*" capture="environment" hidden></label>
      <button class="linkbtn" data-act="scan-manual">Or enter the items by hand</button></div>
      ${s.error ? `<div class="banner" style="margin-top:12px">${esc(s.error)}</div>` : ""}`, "Restocks your supplies and logs what you spent.");
  if (s.stage === "reading") return sheetWrap("Reading your receipt", `<div class="drop">${s.preview ? `<img class="thumb" src="${s.preview}" alt="Your receipt">` : ""}<div class="spinner" role="status" aria-label="Reading"></div><div class="muted">Finding the items and prices…</div></div>`);
  // review
  const opts = sel => {
    const grp = (kind, label) => { const its = S.items.filter(i => (i.kind||"household") === kind).sort((a,b)=>a.name.localeCompare(b.name)); return its.length ? `<optgroup label="${label}">${its.map(i => `<option value="${esc(i.id)}"${i.id===sel?" selected":""}>${esc(i.name)}</option>`).join("")}</optgroup>` : ""; };
    return `<optgroup label="Not in supplies yet"><option value="new-grocery"${sel==="new-grocery"?" selected":""}>Add as new grocery</option><option value="new-household"${sel==="new-household"?" selected":""}>Add as new household item</option><option value="skip"${sel==="skip"?" selected":""}>Don't track</option></optgroup>` + grp("grocery","Your groceries") + grp("household","Your household items");
  };
  const x = s.exp, lines = sum(s.rows.filter(r => r.include), r => Number(r.price||0));
  const tracked = s.rows.filter(r => r.include && r.target !== "skip").length;
  return sheetWrap("Check the items", `
    ${s.preview ? `<img class="thumb" src="${s.preview}" alt="Your receipt" style="float:right;max-height:110px;margin:0 0 8px 12px">` : ""}
    <div class="muted small">Fix anything the scan got wrong. Each item is matched to your supplies so its count goes up; pick "Don't track" for things you don't keep count of.</div>
    <div class="rlines" style="clear:both;margin-top:10px">
    ${s.rows.map((r,i) => `<div class="rline${r.include?"":" off"}">
      <input type="checkbox" class="rc" data-f="r:${i}:include" ${r.include?"checked":""} aria-label="Include ${esc(r.name)}">
      <input class="rn" data-f="r:${i}:name" value="${esc(r.name)}" placeholder="Item name" aria-label="Item name">
      <label class="rq">Qty<input type="number" min="0" step="any" data-f="r:${i}:qty" value="${r.qty}"></label>
      <label class="rp">Price<input type="number" min="0" step="0.01" data-f="r:${i}:price" value="${r.price.toFixed ? r.price.toFixed(2) : r.price}"></label>
      <label class="rt">Supplies<select data-f="r:${i}:target">${opts(r.target)}</select></label>
      <button class="ghost rx" data-act="scan-delrow" data-i="${i}" aria-label="Remove line">✕</button></div>`).join("") || `<div class="empty">No items yet.</div>`}
    </div>
    <button data-act="scan-addrow" style="margin-top:8px">${ICON.plus}Add a line</button>
    <div class="sumbox">
      <label class="check"><input type="checkbox" data-f="x:log" ${x.log?"checked":""}> Log this shopping trip as an expense</label>
      <div class="form">
        <label>Store<input data-f="x:store" value="${esc(x.store)}" placeholder="Store name"></label>
        <label>Receipt total<input type="number" min="0" step="0.01" data-f="x:total" value="${x.total}"></label>
        <label>Date<input type="date" data-f="x:date" value="${esc(x.date)}"></label>
        <label>Paid with<select data-f="x:cardId">${cardOptions(x.cardId)}</select></label>
        <label>Trip<select data-f="x:tripId">${tripOptions(x.tripId)}</select></label>
      </div>
      <label class="check"><input type="checkbox" data-f="x:split" ${x.split?"checked":""}> Split the cost between Groceries and Household supplies by item</label>
      <div class="muted small">Items add up to ${money(lines)}${x.total && Math.abs(lines - x.total) > 0.01 ? `; the difference (tax, fees) is shared out in proportion` : ""}.</div>
    </div>
    <div class="flex" style="margin-top:14px"><span class="muted small">${tracked} item${tracked===1?"":"s"} will update your supplies.</span><button class="primary" data-act="scan-commit">${ICON.supplies}Update supplies${x.log ? " & log expense" : ""}</button></div>`,
    s.store ? esc(s.store) : "");
}
async function readReceipt(file){
  SC.scan = { stage: "reading" }; renderSheet();
  try {
    const part = await fileToPart(file);
    SC.scan.preview = part.preview; renderSheet();
    const inv = S.items.map(i => ({ id: i.id, name: i.name, unit: i.unit || "", kind: i.kind || "household" }));
    const prompt = `You read shopping receipts for a household budgeting app.
Return every purchased line item (ignore subtotals, payments, change, loyalty points and taxes as items).
For each item give: name (clean, readable product name), quantity (number of units bought; use 1 if unclear; for weighed goods use 1),
lineTotal (price paid for that line, after line discounts), kind ("grocery" for food and drink, "household" for cleaning, paper, toiletries and home goods, "other" for anything else),
and matchId: the id of the matching item from the household's supplies list below if it is clearly the same product type (e.g. "Dawn Dish Liquid 450ml" matches "Dish soap"), otherwise an empty string.
Also return store (store name), date (YYYY-MM-DD, empty if not printed) and total (the final amount paid).
Household supplies list: ${JSON.stringify(inv)}`;
    const r = await aiJSON(Sx => Sx.object({ properties: {
      store: Sx.string(), date: Sx.string(), total: Sx.number(),
      items: Sx.array({ items: Sx.object({ properties: { name: Sx.string(), quantity: Sx.number(), lineTotal: Sx.number(), kind: Sx.string(), matchId: Sx.string() }, optionalProperties: ["matchId"] }) })
    }, optionalProperties: ["store","date"] }), prompt, part);
    buildReview(r, part.preview);
  } catch (e){ console.error(e); SC.scan = { stage: "pick", error: aiErrorText(e) }; renderSheet(); }
}
function buildReview(r, preview){
  const ids = new Set(S.items.map(i => i.id));
  const rows = (r.items || []).map(it => {
    const kind = ["grocery","household"].includes(it.kind) ? it.kind : "other";
    const target = it.matchId && ids.has(it.matchId) ? it.matchId : (kind === "other" ? "skip" : "new-" + kind);
    return { include: true, name: it.name || "Item", qty: Math.max(0, Number(it.quantity) || 1), price: Math.round((Number(it.lineTotal)||0)*100)/100, kind, target };
  });
  const d = /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : todayISO();
  const at = activeTrip();
  SC.scan = { stage: "review", preview, store: r.store || "", rows,
    exp: { log: true, split: true, store: r.store || "", total: Math.round((Number(r.total) || sum(rows, x => x.price))*100)/100, date: d, cardId: S.cards.length === 1 ? S.cards[0].id : "", tripId: at && d >= at.start && d <= (at.end||at.start) ? at.id : "" } };
  renderSheet();
}
function rowKind(r){ if (r.target.startsWith("new-")) return r.target.slice(4); const it = S.items.find(i => i.id === r.target); return it ? (it.kind || "household") : r.kind; }
function commitScan(){
  const s = SC.scan, x = s.exp, rows = s.rows.filter(r => r.include);
  const bt = fs.batch(); let n = 0;
  const add = {}; // existing item id -> qty to add
  for (const r of rows){
    if (r.target === "skip") continue;
    const q = Number(r.qty) || 0; if (!q) continue;
    if (r.target.startsWith("new-")){ bt.set(col("inventory").doc(), { name: r.name.trim() || "Item", kind: r.target.slice(4), qty: q, unit: "", minQty: 1, location: "", updatedAt: Date.now() }); n++; }
    else add[r.target] = (add[r.target]||0) + q;
  }
  for (const [id, q] of Object.entries(add)){ const it = S.items.find(i => i.id === id); if (it){ bt.update(col("inventory").doc(id), { qty: qtyOf(it) + q, updatedAt: Date.now() }); n++; } }
  let logged = 0;
  if (x.log && Number(x.total) > 0){
    const total = Math.round(Number(x.total)*100)/100, note = (x.store || "Shopping") + " receipt";
    const catFor = k => k === "grocery" ? (catById("groceries") ? "groceries" : null) : k === "household" ? (catById("household") ? "household" : null) : (catById("other") ? "other" : null);
    const parts = {};
    if (x.split) for (const r of rows){ const c = catFor(rowKind(r)) || catFor("grocery") || (S.cats[0] && S.cats[0].id) || ""; parts[c] = (parts[c]||0) + (Number(r.price)||0); }
    const lineSum = sum(Object.values(parts), v => v);
    if (!x.split || !lineSum){ parts.__one = 1; }
    const entries = parts.__one ? [[catFor("grocery") || (S.cats[0] && S.cats[0].id) || "", total]] : Object.entries(parts).map(([c,v]) => [c, Math.round(v / lineSum * total * 100)/100]);
    const diff = Math.round((total - sum(entries, e => e[1]))*100)/100; if (entries.length && diff) entries.sort((a,b)=>b[1]-a[1])[0][1] = Math.round((entries[0][1] + diff)*100)/100;
    for (const [c, amt] of entries){ if (amt <= 0) continue; bt.set(col("expenses").doc(), { amount: amt, category: c, date: x.date || todayISO(), note: entries.length > 1 ? `${note} · ${catName(c)}` : note, cardId: x.cardId, tripId: x.tripId, receipt: true, createdAt: Date.now() }); logged += amt; }
  }
  save(bt.commit(), `Updated ${n} suppl${n===1?"y":"ies"}${logged ? ` and logged ${money(logged)}` : ""}.`);
  closeSheet();
}

/* ---------- statement import ---------- */
function startImport(cardId){ SC.imp = { stage: "pick", cardId: cardId || (S.cards.length === 1 ? S.cards[0].id : "") }; openSheet("import"); }
function importSheet(){
  const s = SC.imp;
  if (s.stage === "pick") return sheetWrap("Import a statement", `
    <div class="form" style="margin-bottom:12px"><label>Which card or account is this statement for?<select data-f="i:cardId">${cardOptions(s.cardId)}</select></label></div>
    <div class="drop">${ICON.upload}
      <div><b>Choose your statement</b><div class="muted small">A CSV file from online banking gives the best results. PDF statements and photos are read with AI.</div></div>
      <label class="btn primary">${ICON.upload}Choose file<input id="impFile" type="file" accept=".csv,text/csv,application/pdf,image/*" hidden></label></div>
    ${s.error ? `<div class="banner" style="margin-top:12px">${esc(s.error)}</div>` : ""}
    <p class="status">Tip: in your bank's app or website, look for "Download" or "Export" on the transactions page and pick CSV.</p>`, "Brings card transactions into your ledger, categorised.");
  if (s.stage === "reading") return sheetWrap("Reading your statement", `<div class="drop"><div class="spinner" role="status" aria-label="Reading"></div><div class="muted">Finding transactions…</div></div>`);
  if (s.stage === "map"){
    const c = s.csv, hs = c.headers, sel = (f, allowNone) => `<select data-f="m:${f}">${allowNone?`<option value="-1">— none —</option>`:""}${hs.map((h,i)=>`<option value="${i}"${c.map[f]===i?" selected":""}>${esc(h || "Column " + (i+1))}</option>`).join("")}</select>`;
    return sheetWrap("Match the columns", `<div class="muted small" style="margin-bottom:10px">We guessed which column is which. Check them against the sample rows below.</div>
      <div class="form">
        <label>Date column${sel("date")}</label>
        <label>Description column${sel("desc")}</label>
        <label>Amount format<select data-f="m:mode"><option value="single"${c.map.mode==="single"?" selected":""}>One amount column</option><option value="split"${c.map.mode==="split"?" selected":""}>Separate money out / money in columns</option></select></label>
        ${c.map.mode === "single" ? `<label>Amount column${sel("amount")}</label>
          <label>Spending shows as<select data-f="m:sign"><option value="neg"${c.map.sign==="neg"?" selected":""}>Negative numbers (−25.00)</option><option value="pos"${c.map.sign==="pos"?" selected":""}>Positive numbers (25.00)</option></select></label>`
        : `<label>Money out column${sel("debit", true)}</label><label>Money in column${sel("credit", true)}</label>`}
        <label>Date format<select data-f="m:dfmt">${[["DMY","Day/Month/Year"],["MDY","Month/Day/Year"],["YMD","Year-Month-Day"]].map(([k,l])=>`<option value="${k}"${c.map.dfmt===k?" selected":""}>${l}</option>`).join("")}</select></label>
      </div>
      <div class="tablewrap" style="margin-top:12px"><table><thead><tr>${hs.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${c.rows.slice(0,4).map(r=>`<tr>${hs.map((_,i)=>`<td class="small">${esc(r[i]||"")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${s.error ? `<div class="banner" style="margin-top:12px">${esc(s.error)}</div>` : ""}
      <div class="flex" style="margin-top:14px"><span class="muted small">${c.rows.length} rows found</span><button class="primary" data-act="imp-preview">Preview transactions</button></div>`);
  }
  // review
  const inc = s.rows.filter(r => r.include && r.dir === "in"), out = s.rows.filter(r => r.include && r.dir === "out"), dups = s.rows.filter(r => r.dup).length;
  return sheetWrap("Check before importing", `
    <div class="totals"><span>${out.length} expenses <b class="num">${money(sum(out))}</b></span><span>${inc.length} income <b class="num pos">${money(sum(inc))}</b></span>${dups ? `<span>${dups} already in your ledger (unticked)</span>` : ""}</div>
    <div class="tablewrap review"><table><thead><tr><th></th><th>Date</th><th>Description</th><th class="r">Amount</th><th>Category</th></tr></thead><tbody>
    ${s.rows.map((r,i) => `<tr${r.dup?' style="opacity:.6"':""}><td><input type="checkbox" data-f="t:${i}:include" ${r.include?"checked":""} aria-label="Import this row"></td>
      <td class="small num" style="white-space:nowrap">${esc(fmtDay(r.date,{day:"numeric",month:"short",year:"2-digit"}))}</td>
      <td class="small" style="min-width:150px">${esc(r.desc)}${r.dup?' <span class="pill plain">Already added</span>':""}</td>
      <td class="r num ${r.dir==="in"?"pos":""}" style="white-space:nowrap">${r.dir==="in"?"+":"−"}${money(r.amount)}</td>
      <td>${r.dir === "in" ? `<span class="pill ok">Income</span>` : `<select data-f="t:${i}:category" aria-label="Category">${catOptions(r.category)}</select>`}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="flex" style="margin-top:14px"><button data-act="imp-back">Back</button><button class="primary" data-act="imp-commit" ${out.length+inc.length?"":"disabled"}>Import ${out.length+inc.length} transaction${out.length+inc.length===1?"":"s"}</button></div>`,
    s.cardId && cardById(s.cardId) ? esc(cardById(s.cardId).name) : "No card selected");
}

function parseCSV(text){
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/).find(l => l.trim()) || "";
  const delim = [",",";","\t"].sort((a,b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim){ row.push(cur.trim()); cur = ""; }
    else if (ch === "\n" || ch === "\r"){ if (ch === "\r" && text[i+1] === "\n") i++; row.push(cur.trim()); cur = ""; if (row.some(c => c !== "")) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur.trim()); if (row.some(c => c !== "")) rows.push(row);
  // header = first row with at least 2 text cells and a date-ish or description-ish name
  let hi = rows.findIndex(r => r.filter(c => /[a-z]/i.test(c)).length >= 2 && r.some(c => /date|desc|amount|debit|credit|detail|narr|merchant|payee/i.test(c)));
  if (hi < 0) hi = 0;
  return { headers: rows[hi] || [], rows: rows.slice(hi + 1).filter(r => r.length >= 2) };
}
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
function parseDate(s, fmt){
  s = String(s||"").trim(); if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})/); if (m && MONTHS[m[2].toLowerCase().slice(0,3)]) return iso(yr(m[3]), MONTHS[m[2].toLowerCase().slice(0,3)], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/); if (m && MONTHS[m[1].toLowerCase().slice(0,3)]) return iso(yr(m[3]), MONTHS[m[1].toLowerCase().slice(0,3)], +m[2]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); if (m) return fmt === "MDY" ? iso(yr(m[3]), +m[1], +m[2]) : iso(yr(m[3]), +m[2], +m[1]);
  return null;
  function yr(y){ y = +y; return y < 100 ? 2000 + y : y; }
  function iso(y, mo, d){ if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null; return `${y}-${pad(mo)}-${pad(d)}`; }
}
function parseAmount(s){
  s = String(s||"").trim(); if (!s) return null;
  let neg = /^\(.*\)$/.test(s) || /^[^\d]*-/.test(s) || /-\s*$/.test(s) || /\bDR\b/i.test(s);
  if (/\bCR\b/i.test(s)) neg = false;
  let n = s.replace(/[^\d.,-]/g, "").replace(/-/g, "");
  if (/,\d{2}$/.test(n) && !/\.\d{2}$/.test(n)) n = n.replace(/\./g, "").replace(",", "."); else n = n.replace(/,/g, "");
  const v = parseFloat(n); if (isNaN(v)) return null;
  return neg ? -v : v;
}
function guessMap(c){
  const find = re => c.headers.findIndex(h => re.test(h));
  const map = { date: Math.max(0, find(/date|posted|trans.*dt/i)), desc: find(/desc|detail|narr|merchant|payee|memo|particular|reference|name/i), amount: find(/^amount|amt|value|^sum/i),
    debit: find(/debit|withdraw|money out|paid out|out$/i), credit: find(/credit|deposit|money in|paid in|in$/i), mode: "single", sign: "neg", dfmt: "DMY" };
  if (map.desc < 0) map.desc = c.headers.findIndex((_,i) => i !== map.date && c.rows.slice(0,5).every(r => /[a-z]/i.test(r[i]||"")));
  if (map.desc < 0) map.desc = map.date === 0 ? 1 : 0;
  if (map.amount < 0 && map.debit >= 0) map.mode = "split";
  if (map.amount < 0) map.amount = c.headers.findIndex((h,i) => !/balance/i.test(h) && i !== map.date && c.rows.slice(0,5).every(r => parseAmount(r[i]) !== null));
  if (map.mode === "single" && map.amount >= 0){ const vals = c.rows.map(r => parseAmount(r[map.amount])).filter(v => v !== null); map.sign = vals.filter(v => v < 0).length >= vals.filter(v => v > 0).length ? "neg" : "pos"; }
  const firsts = c.rows.slice(0,30).map(r => String(r[map.date]||"").match(/^(\d{1,2})[-/.](\d{1,2})[-/.]/)).filter(Boolean);
  if (c.rows.some(r => /^\d{4}[-/]/.test(r[map.date]||""))) map.dfmt = "YMD";
  else if (firsts.some(m => +m[2] > 12)) map.dfmt = "MDY";
  else if (firsts.some(m => +m[1] > 12)) map.dfmt = "DMY";
  else map.dfmt = (navigator.language || "").toLowerCase() === "en-us" ? "MDY" : "DMY";
  return map;
}
function rowsFromCSV(){
  const c = SC.imp.csv, m = c.map, out = [];
  for (const r of c.rows){
    const date = parseDate(r[m.date], m.dfmt); if (!date) continue;
    let amt;
    if (m.mode === "single"){ const v = parseAmount(r[m.amount]); if (v === null || v === 0) continue; amt = m.sign === "neg" ? v : -v; }
    else { const d = m.debit >= 0 ? parseAmount(r[m.debit]) : null, cr = m.credit >= 0 ? parseAmount(r[m.credit]) : null;
      if (d) amt = -Math.abs(d); else if (cr) amt = Math.abs(cr); else continue; }
    out.push({ date, desc: (r[m.desc] || "").replace(/\s+/g, " ").trim() || "Card transaction", amount: Math.round(Math.abs(amt)*100)/100, dir: amt < 0 ? "out" : "in" });
  }
  return out;
}

/* categorising: your own past choices first, then common keywords */
const CAT_RULES = [
  [/supermarket|grocer|market|mart\b|foods?\b|hi-?lo|megamart|pricesmart|walmart|costco|tesco|aldi|lidl|sainsbury|kroger|whole ?foods|bakery|butcher/i, "groceries"],
  [/restaurant|cafe|coffee|kfc|mcdonald|burger|pizza|domino|subway|wendy|starbucks|juici|bar & grill|grill|takeaway|uber ?eats|doordash|deliveroo|eat/i, "eating-out"],
  [/shell|texaco|esso|total ?energies|rubis|petro|fuel|gas station|bp\b|chevron|exxon|mobil/i, "fuel"],
  [/uber|lyft|bolt|taxi|bus|metro|rail|train|transit|parking|toll/i, "transport"],
  [/electric|power|jps|light & power|water|nwc|utility|utilities|sewer|gas bill/i, "utilities"],
  [/digicel|flow\b|lime\b|internet|broadband|mobile|phone|telecom|wifi|data plan|verizon|at&t|vodafone/i, "internet"],
  [/netflix|spotify|apple\.com|icloud|google\s?(storage|one)|youtube|prime|disney|hulu|subscription|adobe|microsoft|openai|chatgpt/i, "subscriptions"],
  [/pharma|drug ?store|clinic|hospital|doctor|dental|medical|health|optic/i, "health"],
  [/cinema|movie|theatre|ticket|steam|playstation|xbox|nintendo|game/i, "entertainment"],
  [/airline|airways|air |flight|hotel|airbnb|booking\.com|expedia|resort|travel/i, "travel"],
  [/rent\b|landlord|mortgage|housing/i, "rent"],
  [/clothing|apparel|fashion|shoe|zara|h&m|nike|adidas/i, "clothing"],
  [/hardware|home ?depot|ikea|cleaning|household/i, "household"]
];
function descKey(d){ return String(d||"").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(w => w.length > 2).slice(0,2).join(" "); }
function guessCategory(desc){
  const k = descKey(desc);
  if (k){ const prev = S.expenses.filter(e => e.note && descKey(e.note) === k).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0]; if (prev && catById(prev.category)) return prev.category; }
  for (const [re, id] of CAT_RULES) if (re.test(desc) && catById(id)) return id;
  return catById("other") ? "other" : (S.cats[0] ? S.cats[0].id : "");
}
function markRows(rows){
  const cardId = SC.imp.cardId;
  return rows.map(r => {
    const pool = r.dir === "in" ? S.income : S.expenses;
    const dup = pool.some(e => e.date === r.date && Math.abs(Number(e.amount) - r.amount) < 0.005 && (!cardId || !e.cardId || e.cardId === cardId));
    return { ...r, dup, include: !dup, category: r.dir === "out" ? (r.category && catById(r.category) ? r.category : guessCategory(r.desc)) : "" };
  }).sort((a,b) => b.date.localeCompare(a.date));
}
async function readStatement(file){
  const imp = SC.imp; imp.error = "";
  if (/\.csv$/i.test(file.name) || file.type === "text/csv" || file.type === "application/vnd.ms-excel"){
    const c = parseCSV(await file.text());
    if (!c.headers.length || !c.rows.length){ imp.error = "That file doesn't look like a statement with rows of transactions."; return renderSheet(); }
    c.map = guessMap(c); imp.csv = c; imp.stage = "map"; return renderSheet();
  }
  imp.stage = "reading"; renderSheet();
  try {
    const part = await fileToPart(file);
    const cats = S.cats.map(c => ({ id: c.id, name: c.name }));
    const r = await aiJSON(Sx => Sx.object({ properties: { transactions: Sx.array({ items: Sx.object({ properties: {
        date: Sx.string(), description: Sx.string(), amount: Sx.number(), direction: Sx.string(), category: Sx.string() }, optionalProperties: ["category"] }) }) } }),
      `You read bank and card statements for a household budgeting app. Extract every individual transaction (not balances, totals or interest summaries).
For each: date as YYYY-MM-DD (infer the year from the statement period), description (merchant or payee, cleaned up), amount as a positive number,
direction "out" for purchases, fees and withdrawals or "in" for deposits, refunds and payments received, and for "out" rows the best category id from this list: ${JSON.stringify(cats)}.`, part);
    const rows = (r.transactions || []).filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number(t.amount) > 0)
      .map(t => ({ date: t.date, desc: t.description || "Card transaction", amount: Math.round(Number(t.amount)*100)/100, dir: t.direction === "in" ? "in" : "out", category: t.category }));
    if (!rows.length){ imp.stage = "pick"; imp.error = "No transactions were found in that file. Try a CSV export, or a clearer photo."; return renderSheet(); }
    imp.rows = markRows(rows); imp.stage = "review"; renderSheet();
  } catch (e){ console.error(e); imp.stage = "pick"; imp.error = aiErrorText(e); renderSheet(); }
}
function commitImport(){
  const s = SC.imp, rows = s.rows.filter(r => r.include);
  const chunks = []; for (let i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));
  const jobs = chunks.map(ch => { const bt = fs.batch(); for (const r of ch){
    if (r.dir === "in") bt.set(col("income").doc(), { amount: r.amount, source: /salary|payroll|wage/i.test(r.desc) ? "Salary" : "Card credit", note: r.desc, date: r.date, cardId: s.cardId, imported: true, createdAt: Date.now() });
    else bt.set(col("expenses").doc(), { amount: r.amount, category: r.category, note: r.desc, date: r.date, cardId: s.cardId, tripId: "", imported: true, createdAt: Date.now() });
  } return bt.commit(); });
  save(Promise.all(jobs), `Imported ${rows.length} transaction${rows.length===1?"":"s"}.`);
  closeSheet();
}

/* ---------- events (called from app.js) ---------- */
function scanClick(act, b, ev){
  switch (act){
    case "scrim": if (ev.target === b) closeSheet(); return true;
    case "sheet-close": closeSheet(); return true;
    case "go": closeSheet(); location.hash = b.dataset.t; return true;
    case "quick": { const q = b.dataset.q; closeSheet();
      if (q === "expense" || q === "income"){ ui.txType = q; location.hash = "money"; render(); setTimeout(() => { const a = $("#txAmount"); if (a) a.focus(); }, 60); }
      if (q === "trip"){ ui.tripOpen = null; location.hash = "trips"; setTimeout(() => { const a = $("#trName"); if (a) a.focus(); }, 60); }
      if (q === "card"){ location.hash = "cards"; setTimeout(() => { const a = $("#ccName"); if (a) a.focus(); }, 60); }
      return true; }
    case "scan-start": startScan(); return true;
    case "scan-manual": SC.scan = { stage: "review", rows: [{ include: true, name: "", qty: 1, price: 0, kind: "household", target: "new-household" }], exp: { log: true, split: true, store: "", total: 0, date: todayISO(), cardId: S.cards.length === 1 ? S.cards[0].id : "", tripId: "" } }; renderSheet(); return true;
    case "scan-addrow": SC.scan.rows.push({ include: true, name: "", qty: 1, price: 0, kind: "household", target: "new-household" }); renderSheet(); return true;
    case "scan-delrow": SC.scan.rows.splice(Number(b.dataset.i), 1); renderSheet(); return true;
    case "scan-commit": commitScan(); return true;
    case "import-start": startImport(b.dataset.id); return true;
    case "imp-preview": { const rows = rowsFromCSV(); if (!rows.length){ SC.imp.error = "No transactions could be read with these settings. Check the date and amount columns."; renderSheet(); return true; } SC.imp.rows = markRows(rows); SC.imp.stage = "review"; renderSheet(); return true; }
    case "imp-back": SC.imp.stage = SC.imp.csv ? "map" : "pick"; renderSheet(); return true;
    case "imp-commit": commitImport(); return true;
  }
  return false;
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && SC.sheet) closeSheet(); });
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "scanFile" && t.files[0]) return readReceipt(t.files[0]);
  if (t.id === "impFile" && t.files[0]) return readStatement(t.files[0]);
  const f = t.dataset && t.dataset.f; if (!f) return;
  const v = t.type === "checkbox" ? t.checked : t.value;
  const [k, a, b] = f.split(":");
  if (k === "r"){ const r = SC.scan.rows[+a]; r[b] = (b === "qty" || b === "price") ? Number(v) || 0 : v; if (b !== "name") renderSheet(); }
  if (k === "x"){ SC.scan.exp[a] = a === "total" ? Number(v) || 0 : v; renderSheet(); }
  if (k === "i"){ SC.imp[a] = v; }
  if (k === "m"){ const m = SC.imp.csv.map; m[a] = ["mode","sign","dfmt"].includes(a) ? v : Number(v); renderSheet(); }
  if (k === "t"){ SC.imp.rows[+a][b] = v; if (b === "include") renderSheet(); }
});
