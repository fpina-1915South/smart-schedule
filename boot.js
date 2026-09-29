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
    gate(`<p>Sign in with your work email and the password Frank gave you.</p>
      <form id="siForm">
        <input type="email" id="siEmail" required autocomplete="username" placeholder="you@${esc(DOMAIN || "company.com")}">
        <input type="password" id="siPass" required autocomplete="current-password" placeholder="Password" style="margin-top:8px">
        <button class="btn" type="submit">Sign in</button>
      </form>
      <div class="gmsg ${err ? "err" : ""}" id="siMsg">${esc(msg || "")}</div>
      <p class="note" style="margin-top:14px">Forgot your password or it stopped working? <a href="#" id="siReset">Email me a link to reset it</a>. Or <a href="#" id="siLink">email me a sign-in link instead</a>.</p>`);
    $("siForm").addEventListener("submit", async e => {
      e.preventDefault();
      const email = $("siEmail").value.trim().toLowerCase(), pass = $("siPass").value;
      if (DOMAIN && !email.endsWith("@" + DOMAIN)){ $("siMsg").className = "gmsg err"; $("siMsg").textContent = "Use your @" + DOMAIN + " email."; return; }
      $("siMsg").className = "gmsg"; $("siMsg").textContent = "Signing in...";
      try { await auth.signInWithEmailAndPassword(email, pass); }
      catch(err2){ $("siMsg").className = "gmsg err"; $("siMsg").textContent = /password|credential|user-not-found|invalid/i.test(err2 && err2.code || "") ? "That email and password don't match. If you've signed in to the Store Visit app with an emailed link, that clears your scheduler password. Click \"Email me a link to reset it\" below to set a new one." : "Couldn't sign in: " + (err2 && err2.message || err2); }
    });
    $("siLink").addEventListener("click", e => { e.preventDefault(); showLinkSignIn(); });
    $("siReset").addEventListener("click", async e => { e.preventDefault();
      const em = ($("siEmail").value || "").trim().toLowerCase();
      if (!em || (DOMAIN && !em.endsWith("@" + DOMAIN))){ $("siMsg").className = "gmsg err"; $("siMsg").textContent = "Type your @" + DOMAIN + " email above first, then click reset."; return; }
      try { await auth.sendPasswordResetEmail(em, {url: location.origin + location.pathname}); $("siMsg").className = "gmsg"; $("siMsg").textContent = "Check your email for a link to set a new password (look in junk too). Then come back and sign in."; }
      catch(err3){ $("siMsg").className = "gmsg err"; $("siMsg").textContent = "Couldn't send the reset email: " + (err3 && err3.message || err3) + " Ask Frank to reset it."; } });
  }
  function showLinkSignIn(msg, err){
    gate(`<p>We'll email you a one-time sign-in link. Use this only if you don't have a password.</p>
      <form id="lnForm"><input type="email" id="lnEmail" required autocomplete="email" placeholder="you@${esc(DOMAIN || "company.com")}">
      <button class="btn" type="submit">Email me a sign-in link</button></form>
      <div class="gmsg ${err ? "err" : ""}" id="lnMsg">${esc(msg || "")}</div>
      <p class="note" style="margin-top:14px"><a href="#" id="lnBack">Back to password sign-in</a></p>`);
    $("lnBack").addEventListener("click", e => { e.preventDefault(); showSignIn(); });
    $("lnForm").addEventListener("submit", async e => {
      e.preventDefault();
      const email = $("lnEmail").value.trim().toLowerCase();
      if (DOMAIN && !email.endsWith("@" + DOMAIN)){ $("lnMsg").className = "gmsg err"; $("lnMsg").textContent = "Use your @" + DOMAIN + " email."; return; }
      $("lnMsg").className = "gmsg"; $("lnMsg").textContent = "Sending...";
      try {
        await auth.sendSignInLinkToEmail(email, {url: location.origin + location.pathname, handleCodeInApp: true});
        try { localStorage.setItem(EMAIL_KEY, email); } catch(e2) {}
        gate(`<p><b>Check your email.</b> We sent a sign-in link to <b>${esc(email)}</b>. Open it on this device and you're in.</p>`);
      } catch(err2){ $("lnMsg").className = "gmsg err"; $("lnMsg").textContent = "Couldn't send the link: " + (err2 && err2.message || err2); }
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
  const CREATE_HTML = "    <hr style=\"border:0;border-top:1px solid var(--line);margin:18px 0 6px\">\n    <h2>Create logins</h2>\n    <p class=\"note\" style=\"margin:0\">Paste leader emails, one per line. Each gets a login with a starting password, and they're asked to set their own the first time they sign in. No emails are sent. <b>Before you click Create, turn on \"Enable create (sign-up)\" in Firebase. Turn it back off when you're done.</b></p>\n    <label for=\"newEmails\">Leader emails</label>\n    <textarea id=\"newEmails\" placeholder=\"gm.batonrouge@1915south.com\"></textarea>\n    <label><input type=\"checkbox\" id=\"newShared\"> Use the same starting password for everyone</label>\n    <input id=\"newSharedPw\" type=\"text\" placeholder=\"Starting password (8+ characters)\" hidden style=\"width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box\">\n    <div class=\"row\"><button class=\"btn\" id=\"newCreate\">Create logins</button></div>\n    <div id=\"newOut\" class=\"note\"></div>";
  function wireAccess(){
    if (!$("newEmails")){ const row = $("accSave").parentNode; row.insertAdjacentHTML("afterend", CREATE_HTML); }
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
    $("newShared").onchange = () => { $("newSharedPw").hidden = !$("newShared").checked; };
    $("newCreate").onclick = createLogins;
    $("accSave").onclick = async () => {
      const list = t => [...new Set(t.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes("@")))];
      const body = {allowDomain:$("accAll").checked, leaders:list($("accLeaders").value), admins:list($("accAdmins").value), updatedAt:new Date().toISOString()};
      try { await fs.doc("config/access").set(body); ACCESS = body; $("accessDlg").close(); }
      catch(e){ alert("Couldn't save: " + e.message); }
    };
  }

  /* ---------- owner: create leader logins in bulk (no emails sent) ---------- */
  const genPw = () => { const w = ["Blue","Navy","Sage","Clay","Dune","Oak","Pine","Bay","Gulf","Delta"], a = new Uint32Array(3); crypto.getRandomValues(a);
    return w[a[0] % w.length] + "-" + String(1000 + a[1] % 9000) + "-" + w[a[2] % w.length]; };
  async function createLogins(){
    const out = $("newOut");
    const emails = [...new Set($("newEmails").value.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes("@")))];
    if (!emails.length){ out.textContent = "Paste at least one email."; return; }
    const bad = emails.filter(e => DOMAIN && !e.endsWith("@" + DOMAIN)); if (bad.length){ out.textContent = "These aren't @" + DOMAIN + ": " + bad.join(", "); return; }
    const shared = $("newShared").checked ? $("newSharedPw").value : "";
    if ($("newShared").checked && shared.length < 8){ out.textContent = "The starting password needs 8+ characters."; return; }
    const app2 = firebase.apps.find(a => a.name === "creator") || firebase.initializeApp(C.firebase, "creator");
    const a2 = app2.auth(); const rows = []; out.textContent = "Creating...";
    for (const e of emails){
      const pw = shared || genPw();
      try {
        const cred = await a2.createUserWithEmailAndPassword(e, pw);
        await fs.doc("users/" + cred.user.uid).set({email:e, name:e.split("@")[0], mustChange:true, createdAt:new Date().toISOString()});
        await a2.signOut();
        rows.push([e, pw, "Created"]);
      } catch(err){
        const c = err && err.code || "";
        rows.push([e, "", c.includes("email-already-in-use") ? "Already has a login" : c.includes("admin-restricted") || c.includes("operation-not-allowed") ? "Blocked: turn on sign-up in Firebase first" : "Error: " + (err.message || c)]);
      }
    }
    try { const a = ACCESS || {}; const leaders = [...new Set((a.leaders || []).concat(rows.filter(r => r[2] === "Created").map(r => r[0])))]; ACCESS = Object.assign({}, a, {leaders, updatedAt:new Date().toISOString()}); await fs.doc("config/access").set(ACCESS); } catch(e) {}
    const made = rows.filter(r => r[2] === "Created");
    const text = made.map(r => `${r[0]}  password: ${r[1]}`).join("\n");
    out.innerHTML = `<p><b>${made.length} created</b>${rows.length > made.length ? `, ${rows.length - made.length} skipped` : ""}. Copy this list now. Passwords aren't shown again.</p>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse">${rows.map(r => `<tr><td style="padding:3px 6px;border-top:1px solid var(--line)">${esc(r[0])}</td><td style="padding:3px 6px;border-top:1px solid var(--line);font-family:monospace">${esc(r[1])}</td><td style="padding:3px 6px;border-top:1px solid var(--line)">${esc(r[2])}</td></tr>`).join("")}</table>
      ${made.length ? `<div class="row" style="justify-content:flex-start"><button class="btn ghost" id="newCopy">Copy list</button></div>` : ""}
      <p><b>Now turn "Enable create (sign-up)" back off in Firebase.</b></p>`;
    const cb = $("newCopy"); if (cb) cb.onclick = () => navigator.clipboard.writeText(text).then(() => { cb.textContent = "Copied"; });
  }

  /* ---------- first sign-in: set your own password ---------- */
  function forcePassword(u){
    return new Promise(done => {
      gate(`<p><b>Welcome, ${esc(u.email)}.</b> Set your own password to finish signing in.</p>
        <form id="fpForm"><input type="password" id="fp1" required autocomplete="new-password" placeholder="New password (8+ characters)">
        <input type="password" id="fp2" required autocomplete="new-password" placeholder="Type it again" style="margin-top:8px">
        <button class="btn" type="submit">Save password</button></form><div class="gmsg" id="fpMsg"></div>`);
      $("fpForm").addEventListener("submit", async e => {
        e.preventDefault(); const p1 = $("fp1").value, p2 = $("fp2").value, m = $("fpMsg");
        if (p1.length < 8){ m.className = "gmsg err"; m.textContent = "Use at least 8 characters."; return; }
        if (p1 !== p2){ m.className = "gmsg err"; m.textContent = "Those don't match."; return; }
        try { await u.updatePassword(p1); await fs.doc("users/" + u.uid).set({mustChange:false}, {merge:true}); done(); }
        catch(err){ m.className = "gmsg err"; m.textContent = "Couldn't save it: " + (err.message || err); }
      });
    });
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
    try { const us = await fs.doc("users/" + u.uid).get(); if (us.exists && us.data().mustChange) await forcePassword(u); } catch(e) {}
    try { await fs.doc("users/" + u.uid).set({email:u.email, name:(u.email || "").split("@")[0], lastSeen:new Date().toISOString()}, {merge:true}); } catch(e) {}
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
    $("acctPass").onclick = async () => {
      const p1 = prompt("New password (at least 8 characters):"); if (!p1) return;
      if (p1.length < 8){ alert("Use at least 8 characters."); return; }
      const p2 = prompt("Type the new password again:"); if (p1 !== p2){ alert("Those didn't match. Nothing changed."); return; }
      try { await auth.currentUser.updatePassword(p1); alert("Password changed."); }
      catch(e){ alert(/recent/i.test(e.code || "") ? "For security, sign out and sign back in, then change your password right away." : "Couldn't change it: " + e.message); }
    };
    const sc = document.createElement("script"); sc.src = "app.js?v=" + (C.version || "1"); document.body.appendChild(sc);
  }

  (async () => {
    gate(`<p class="note">Loading...</p>`);
    await finishLink();
    auth.onAuthStateChanged(u => { if (u) start(u); else showSignIn(); });
  })();
})();
