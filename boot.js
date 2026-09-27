/* 1915 South Smart Scheduler: sign-in, access and data loading.
   Leaders sign in with a one-time email link. Everything the scheduler stores lives in Firestore,
   and firestore.rules decides who can read and write each part. */
(function(){
  const C = window.SS_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const OWNER = String(C.ownerEmail || "").toLowerCase();
  const DOMAIN = String(C.allowedDomain || "").toLowerCase();
  const EMAIL_KEY = "ss-signin-email";

  function gate(html){ $("gate").hidden = false; $("appRoot").hidden = true; $("acctbar").hidden = true; $("gateBody").innerHTML = html; }

  if (!C.firebase || !C.firebase.apiKey || /PASTE/.test(C.firebase.apiKey)){
    gate(`<p><b>Almost set up.</b> Paste your Firebase settings into <code>config.js</code> in the GitHub repository, then reload this page.</p>`);
    return;
  }
  firebase.initializeApp(C.firebase);
  const auth = firebase.auth();
  const fs = firebase.firestore();
  try { fs.settings({ignoreUndefinedProperties:true, merge:true}); } catch(e) {}

  /* ---------- sign in with a one-time email link ---------- */
  function showSignIn(msg, err){
    gate(`<p>Sign in with your work email. We'll send you a one-time link. No password needed.</p>
      <form id="siForm"><input type="email" id="siEmail" required autocomplete="email" placeholder="you@${esc(DOMAIN || "company.com")}">
      <button class="btn" type="submit">Email me a sign-in link</button></form>
      <div class="gmsg ${err ? "err" : ""}" id="siMsg">${esc(msg || "")}</div>`);
    $("siForm").addEventListener("submit", async e => {
      e.preventDefault();
      const email = $("siEmail").value.trim().toLowerCase();
      if (DOMAIN && !email.endsWith("@" + DOMAIN)){ $("siMsg").className = "gmsg err"; $("siMsg").textContent = "Use your @" + DOMAIN + " email."; return; }
      $("siMsg").className = "gmsg"; $("siMsg").textContent = "Sending...";
      try {
        await auth.sendSignInLinkToEmail(email, {url: location.origin + location.pathname, handleCodeInApp: true});
        try { localStorage.setItem(EMAIL_KEY, email); } catch(e2) {}
        gate(`<p><b>Check your email.</b> We sent a sign-in link to <b>${esc(email)}</b>. Open it on this device and you're in.</p><p class="note">It can take a minute. Check junk mail if it doesn't show up.</p>`);
      } catch(err2){ $("siMsg").className = "gmsg err"; $("siMsg").textContent = "Couldn't send the link: " + (err2 && err2.message || err2); }
    });
  }

  async function finishLink(){
    if (!auth.isSignInWithEmailLink(location.href)) return false;
    let email = ""; try { email = localStorage.getItem(EMAIL_KEY) || ""; } catch(e) {}
    if (!email){
      gate(`<p>Confirm your email to finish signing in.</p><form id="cfForm"><input type="email" id="cfEmail" required placeholder="you@${esc(DOMAIN)}"><button class="btn" type="submit">Finish signing in</button></form><div class="gmsg" id="cfMsg"></div>`);
      email = await new Promise(res => $("cfForm").addEventListener("submit", e => { e.preventDefault(); res($("cfEmail").value.trim().toLowerCase()); }));
    }
    try { await auth.signInWithEmailLink(email, location.href); try { localStorage.removeItem(EMAIL_KEY); } catch(e) {} }
    catch(err){ showSignIn("That sign-in link didn't work. It may have expired or already been used. Send a new one.", true); }
    history.replaceState(null, "", location.origin + location.pathname);
    return true;
  }

  /* ---------- access: owner in config.js, everyone else from config/access ---------- */
  let ACCESS = null, ROLE = {owner:false, admin:false, leader:false};
  function roleFor(email){
    const e = String(email || "").toLowerCase(), a = ACCESS || {};
    const owner = !!OWNER && e === OWNER;
    const admin = owner || (a.admins || []).map(x => String(x).toLowerCase()).includes(e);
    const leader = admin || (a.allowDomain && DOMAIN && e.endsWith("@" + DOMAIN)) || (a.leaders || []).map(x => String(x).toLowerCase()).includes(e);
    return {owner, admin, leader};
  }

  /* ---------- the db and user objects the scheduler expects ---------- */
  const mapErr = e => { const code = e && e.code === "permission-denied" ? "invalid_argument" : "unavailable"; const x = new Error(e && e.message || String(e)); x.code = code; return x; };
  const wrapRef = ref => ({
    set: body => ref.set(body).catch(e => { throw mapErr(e); }),
    get: () => ref.get(),
    onSnapshot: (next, err) => ref.onSnapshot(next, e => err && err(mapErr(e))),
    collection: p => wrapQ(ref.collection(p))
  });
  const wrapQ = q => ({
    where: (f, op, v) => wrapQ(q.where(f, op, v)),
    orderBy: (f, d) => wrapQ(q.orderBy(f, d)),
    limit: n => wrapQ(q.limit(n)),
    get: () => q.get(),
    doc: id => wrapRef(q.doc(id)),
    onSnapshot: (next, err) => q.onSnapshot(next, e => err && err(mapErr(e)))
  });
  const DBSHIM = {doc: p => wrapRef(fs.doc(p)), collection: p => wrapQ(fs.collection(p))};
  const nameCache = {};
  function userShim(u){
    return {
      id: async () => u.uid,
      me: async () => ({id:u.uid, name:(u.email || "").split("@")[0], email:u.email}),
      isOwner: async () => ROLE.owner,
      canEdit: async () => ROLE.admin,
      can: async n => n === "data.write" ? ROLE.leader : null,
      profiles: async ids => {
        const out = {};
        await Promise.all(ids.map(async id => {
          if (nameCache[id] == null){ try { const s = await fs.doc("users/" + id).get(); nameCache[id] = s.exists ? (s.data().name || s.data().email || "") : ""; } catch(e){ nameCache[id] = ""; } }
          out[id] = {id, name:nameCache[id]};
        }));
        return out;
      }
    };
  }

  /* ---------- owner: access dialog ---------- */
  function wireAccess(){
    document.querySelectorAll(".accDomain").forEach(el => el.textContent = DOMAIN);
    $("acctAccess").hidden = !ROLE.owner;
    $("acctAccess").onclick = () => {
      const a = ACCESS || {};
      $("accAll").checked = !!a.allowDomain;
      $("accLeaders").value = (a.leaders || []).join("\n");
      $("accAdmins").value = (a.admins || []).join("\n");
      $("accessDlg").showModal();
    };
    $("accCancel").onclick = () => $("accessDlg").close();
    $("accSave").onclick = async () => {
      const list = t => [...new Set(t.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes("@")))];
      const body = {allowDomain:$("accAll").checked, leaders:list($("accLeaders").value), admins:list($("accAdmins").value), updatedAt:new Date().toISOString()};
      try { await fs.doc("config/access").set(body); ACCESS = body; $("accessDlg").close(); }
      catch(e){ alert("Couldn't save: " + e.message); }
    };
  }

  /* ---------- owner: one-time load of the starting data ---------- */
  function showSetup(){
    gate(`<p><b>One-time setup.</b> Load the starting data file (smart-scheduler-starting-data.json). It has the 41 stores, their hours and traffic, team counts, the staffing standard and the calendar.</p>
      <label class="btn" for="seedFile" style="cursor:pointer">Choose the starting data file</label><input type="file" id="seedFile" accept=".json,application/json" hidden>
      <div class="gmsg" id="seedMsg"></div>`);
    $("seedFile").addEventListener("change", e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = async () => {
        let seed; try { seed = JSON.parse(rd.result); } catch(err){ $("seedMsg").className = "gmsg err"; $("seedMsg").textContent = "That file isn't valid JSON."; return; }
        if (!seed || seed.kind !== "1915south-smart-scheduler-seed" || !Array.isArray(seed.stores)){ $("seedMsg").className = "gmsg err"; $("seedMsg").textContent = "That isn't the Smart Scheduler starting data file."; return; }
        $("seedMsg").className = "gmsg"; $("seedMsg").textContent = "Loading...";
        try {
          const writes = seed.stores.map(s => ["stores/" + slugOf(s.name), s]).concat(Object.entries(seed.docs || {}));
          for (let i=0; i<writes.length; i+=400){ const b = fs.batch(); writes.slice(i, i+400).forEach(([p, d]) => b.set(fs.doc(p), d)); await b.commit(); }
          $("seedMsg").textContent = "Done. Opening the scheduler..."; setTimeout(() => location.reload(), 600);
        } catch(err){ $("seedMsg").className = "gmsg err"; $("seedMsg").textContent = "Couldn't load: " + err.message; }
      };
      rd.readAsText(f);
    });
  }
  const slugOf = st => st.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /* ---------- start ---------- */
  let started = false;
  async function start(u){
    if (started) return; started = true;
    $("acctWho").textContent = "Signed in as " + u.email;
    try { await fs.doc("users/" + u.uid).set({email:u.email, name:(u.email || "").split("@")[0], lastSeen:new Date().toISOString()}); } catch(e) {}
    try { const s = await fs.doc("config/access").get(); ACCESS = s.exists ? s.data() : null; } catch(e){ ACCESS = null; }
    ROLE = roleFor(u.email);
    if (ROLE.owner && !ACCESS){ ACCESS = {allowDomain:true, leaders:[], admins:[], updatedAt:new Date().toISOString()}; try { await fs.doc("config/access").set(ACCESS); } catch(e) {} }
    if (!ROLE.leader){
      gate(`<p><b>You're signed in as ${esc(u.email)}, but you don't have access yet.</b></p><p>Ask Frank Pina to add you to the Smart Scheduler.</p><button class="btn ghost" id="soBtn">Sign out</button>`);
      $("soBtn").onclick = () => auth.signOut().then(() => location.reload());
      return;
    }
    let snap;
    try { snap = await fs.collection("stores").get(); }
    catch(e){ gate(`<p class="gmsg err">Couldn't load the scheduler: ${esc(e.message)}</p>`); return; }
    if (snap.empty){
      if (ROLE.owner) return showSetup();
      gate(`<p>The scheduler isn't set up yet. Frank Pina needs to load the starting data first.</p>`); return;
    }
    const stores = snap.docs.map(d => d.data()).sort((a,b) => (a.order ?? 999) - (b.order ?? 999));
    const DATA = {}; stores.forEach(s => { const o = Object.assign({}, s); delete o.name; delete o.order; DATA[s.name] = o; });
    window.SS_DATA = DATA;
    window.claude = {use: async n => n === "db" ? DBSHIM : n === "user" ? userShim(u) : null};
    $("gate").hidden = true; $("appRoot").hidden = false; $("acctbar").hidden = false;
    wireAccess();
    $("acctOut").onclick = () => auth.signOut().then(() => location.reload());
    const sc = document.createElement("script"); sc.src = "app.js?v=" + (C.version || "1"); document.body.appendChild(sc);
  }

  (async () => {
    gate(`<p class="note">Loading...</p>`);
    await finishLink();
    auth.onAuthStateChanged(u => { if (u) start(u); else showSignIn(); });
  })();
})();
