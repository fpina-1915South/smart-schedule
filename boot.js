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

  /* ---------- sign in with email + password (same accounts as Order Verification) ----------
     First time: create an account and confirm the email once. After that: email + password.
     No emailed sign-in links: the free Firebase plan only allows 5 of those a day. */
  const APP_URL = () => location.origin + location.pathname;
  const okDomain = e => !DOMAIN || e.endsWith("@" + DOMAIN);
  function say(text, err){ const m = $("siMsg"); if (m){ m.className = "gmsg" + (err ? " err" : ""); m.textContent = text || ""; } }
  function friendly(err){
    const c = err && err.code || "";
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return "That email and password don't match. Try again, or click Forgot password.";
    if (/too-many-requests/.test(c)) return "Too many tries. Wait a few minutes, or click Forgot password.";
    if (/weak-password/.test(c)) return "Pick a longer password (at least 8 characters).";
    if (/invalid-email/.test(c)) return "That doesn't look like an email address.";
    if (/network/.test(c)) return "No internet connection. Check Wi-Fi and try again.";
    return (err && err.message) || String(err);
  }
  const lnk = (id, text) => `<a href="#" id="${id}">${text}</a>`;
  function showSignIn(msg, err, email){
    gate(`<p>Sign in with your 1915 South email and password. It's the same login as Order Verification.</p>
      <form id="siForm">
        <input type="email" id="siEmail" required autocomplete="username" placeholder="you@${esc(DOMAIN || "company.com")}">
        <input type="password" id="siPass" required autocomplete="current-password" placeholder="Password" style="margin-top:8px">
        <button class="btn" type="submit">Sign in</button>
      </form>
      <div class="gmsg" id="siMsg"></div>
      <p class="note" style="margin-top:10px;text-align:right">${lnk("goForgot", "Forgot password?")}</p>
      <p class="note" style="margin-top:14px"><b>First time here?</b> ${lnk("goCreate", "Create your account")}</p>`);
    if (email) $("siEmail").value = email;
    say(msg, err);
    $("goCreate").onclick = e => { e.preventDefault(); showCreate("", false, $("siEmail").value.trim()); };
    $("goForgot").onclick = e => { e.preventDefault(); showForgot($("siEmail").value.trim()); };
    $("siForm").addEventListener("submit", async e => {
      e.preventDefault();
      const em = $("siEmail").value.trim().toLowerCase(), pass = $("siPass").value;
      if (!okDomain(em)){ say("Use your @" + DOMAIN + " email.", true); return; }
      say("Signing in...");
      try { await auth.signInWithEmailAndPassword(em, pass); } catch(err2){ say(friendly(err2), true); }
    });
  }
  function showCreate(msg, err, email){
    gate(`<p><b>Create your account.</b> Use your 1915 South email and pick a password (at least 8 characters). We'll send one email to confirm it's you. After that, you just sign in.</p>
      <form id="crForm">
        <input type="email" id="crEmail" required autocomplete="username" placeholder="you@${esc(DOMAIN || "company.com")}">
        <input type="password" id="crPass" required autocomplete="new-password" placeholder="Create a password" style="margin-top:8px">
        <input type="password" id="crPass2" required autocomplete="new-password" placeholder="Type it again" style="margin-top:8px">
        <button class="btn" type="submit">Create account</button>
      </form>
      <div class="gmsg" id="siMsg"></div>
      <p class="note" style="margin-top:14px">${lnk("goSignIn", "Already have an account? Sign in")}</p>`);
    if (email) $("crEmail").value = email;
    say(msg, err);
    $("goSignIn").onclick = e => { e.preventDefault(); showSignIn("", false, $("crEmail").value.trim()); };
    $("crForm").addEventListener("submit", async e => {
      e.preventDefault();
      const em = $("crEmail").value.trim().toLowerCase(), p1 = $("crPass").value, p2 = $("crPass2").value;
      if (!okDomain(em)){ say("Use your @" + DOMAIN + " email.", true); return; }
      if (p1.length < 8){ say("Pick a password with at least 8 characters.", true); return; }
      if (p1 !== p2){ say("The two passwords don't match.", true); return; }
      say("Creating your account...");
      try {
        const res = await auth.createUserWithEmailAndPassword(em, p1);
        if (!(await isApproved(res.user))){ try { await sendConfirmOnce(res.user); } catch(e2) {} }
      } catch(err2){
        if (err2 && err2.code === "auth/email-already-in-use") showForgot(em, "You already have an account (maybe from Order Verification or an older sign-in). Click the button below and we'll email you a link to set your password.");
        else say(friendly(err2), true);
      }
    });
  }
  function showForgot(email, note){
    gate(`<p>${esc(note || "Enter your 1915 South email and we'll send a link to set a new password.")}</p>
      <form id="fgForm"><input type="email" id="fgEmail" required autocomplete="username" placeholder="you@${esc(DOMAIN || "company.com")}">
      <button class="btn" type="submit">Email me a password link</button></form>
      <div class="gmsg" id="siMsg"></div>
      <p class="note" style="margin-top:14px">${lnk("goSignIn2", "Back to sign in")}</p>`);
    if (email) $("fgEmail").value = email;
    $("goSignIn2").onclick = e => { e.preventDefault(); showSignIn("", false, $("fgEmail").value.trim()); };
    $("fgForm").addEventListener("submit", async e => {
      e.preventDefault();
      const em = $("fgEmail").value.trim().toLowerCase();
      if (!okDomain(em)){ say("Use your @" + DOMAIN + " email.", true); return; }
      say("Sending...");
      try { await auth.sendPasswordResetEmail(em, {url: APP_URL()}); } catch(err2){ if (!/user-not-found/.test(err2 && err2.code || "")){ say(friendly(err2), true); return; } }
      showSignIn("If that email has an account, a password link is on its way. Set your password, then sign in here. Check junk mail if you don't see it.", false, em);
    });
  }
  /* Approved without the confirmation email: on Frank's approved list (shared with Order Verification) or on the scheduler's Access list. */
  async function isApproved(u){
    const em = String(u.email || "").toLowerCase();
    try { const d = await fs.doc("ovApproved/" + em).get(); if (d.exists) return true; } catch(e) {}
    try { const a = await fs.doc("config/access").get(); const x = a.exists ? a.data() : {};
      if ([].concat(x.leaders || [], x.admins || []).map(v => String(v).toLowerCase()).includes(em)) return true; } catch(e) {}
    return !!OWNER && em === OWNER;
  }
  const SENT_KEY = "ss-confirm-sent";
  async function sendConfirmOnce(u, force){
    let last = 0; try { last = +localStorage.getItem(SENT_KEY + ":" + u.email) || 0; } catch(e) {}
    if (Date.now() - last < 864e5) return force ? "wait" : "skipped";
    await u.sendEmailVerification({url: APP_URL()});
    try { localStorage.setItem(SENT_KEY + ":" + u.email, String(Date.now())); } catch(e) {}
    return "sent";
  }
  function showVerify(u){
    return new Promise(done => {
      gate(`<p><b>One last step.</b> We sent an email to <b>${esc(u.email)}</b>. Open it and click the link to confirm it's you, then come back and click the button below.</p>
        <button class="btn" type="button" id="vfDone">I've confirmed my email</button>
        <div class="gmsg" id="siMsg"></div>
        <p class="note" style="margin-top:14px">${lnk("vfResend", "Send it again")} · ${lnk("vfOut", "Use a different email")}</p>
        <p class="note">Check junk mail if you don't see it. No email? Ask Frank to add you to the approved list, then click the button above.</p>`);
      $("vfDone").onclick = async () => {
        say("Checking...");
        try { await u.reload(); const cur = auth.currentUser || u;
          if (cur.emailVerified || await isApproved(cur)){ await cur.getIdToken(true); done(); }
          else say("Not confirmed yet. Click the link in the email first (it can take a minute to arrive).", true);
        } catch(e){ say(friendly(e), true); }
      };
      $("vfResend").onclick = async e => { e.preventDefault();
        try { const r = await sendConfirmOnce(u, true); say(r === "wait" ? "We already sent one in the last 24 hours. Check junk mail, or ask Frank to add you to the approved list." : "Sent. Check your email (and junk mail).", r === "wait"); }
        catch(err2){ say(/too-many|quota|exceeded/i.test((err2 && err2.code || "") + (err2 && err2.message || "")) ? "Today's email limit is used up. Try tomorrow, or ask Frank to add you to the approved list." : friendly(err2), true); } };
      $("vfOut").onclick = e => { e.preventDefault(); auth.signOut().then(() => location.reload()); };
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
    catch(err){ showSignIn("That old sign-in link didn't work. Sign in with your email and password instead (first time? click Create your account).", true, email); }
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
    if (!u.emailVerified && !(await isApproved(u))){ try { await sendConfirmOnce(u); } catch(e) {} await showVerify(u); u = auth.currentUser || u; }
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
    /* Always load the newest app: read the version fresh from config.js so a cached copy never holds back an update. */
    let ver = C.version || "1";
    try { const t = await (await fetch("config.js?nc=" + Date.now(), {cache:"no-store"})).text(); const m = t.match(/version:\s*"([^"]+)"/); if (m) ver = m[1]; } catch(e) {}
    const sc = document.createElement("script"); sc.src = "app.js?v=" + ver; document.body.appendChild(sc);
  }

  (async () => {
    gate(`<p class="note">Loading...</p>`);
    await finishLink();
    auth.onAuthStateChanged(u => { if (u) start(u); else showSignIn(); });
  })();
})();
