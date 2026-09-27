# 1915 South Smart Scheduler

Scheduling tool for all 41 stores. It covers:

- hot zones and 1-to-1 staffing
- a leader in the store every hour
- the talent mix (High, Middle and Low performers)
- work-life balance
- holidays and tentpoles
- schedule grades and weekly actual traffic

The page is hosted on GitHub Pages. Sign-in and shared data run on Google Firebase.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: sign-in screen and scheduler layout |
| `app.js` | The scheduler itself (all the rules, grading and screens) |
| `boot.js` | Sign-in, access and loading data from Firebase |
| `config.js` | Your Firebase settings, owner email and company domain |
| `firestore.rules` | Who can read and write what (paste into Firebase) |
| `firebase.json` | Only used if you ever test locally with the Firebase tools |

The starting data file (`smart-scheduler-starting-data.json`) is **not** in this repository on purpose. It holds store traffic. You load it once through the app after signing in.

## One-time setup (about 30 minutes)

### 1. Firebase project
1. Go to console.firebase.google.com and click **Create a project**. Name it something like `smart-scheduler-1915`. You can skip Google Analytics.
2. Click **Upgrade** and switch to the **Blaze (pay as you go)** plan. The free plan only sends 5 sign-in emails a day, and 41 leaders need more than that on day one. At this size the monthly cost should be tiny. Set a budget alert (for example $10) so there are no surprises.

### 2. Sign-in
1. Go to **Build > Authentication > Get started > Sign-in method**.
2. Turn on **Email/Password**, and inside it turn on **Email link (passwordless sign-in)**. Save.
3. Go to **Authentication > Settings > Authorized domains** and add `YOUR-GITHUB-USERNAME.github.io`.

### 3. Database
1. Go to **Build > Firestore Database > Create database**. Pick **production mode** and a US location.
2. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.

### 4. Connect the page
1. Click the **gear (Project settings)**, scroll to **Your apps**, and click the web icon **</>**. Register the app as "Smart Scheduler". You don't need Firebase Hosting.
2. Copy the values from `firebaseConfig` into `config.js`: apiKey, authDomain, projectId, storageBucket, messagingSenderId and appId.

### 5. GitHub Pages
1. Create a new repository named `smart-scheduler`. Public is fine, because no store data lives in these files.
2. Click **Add file > Upload files**, drag in every file from this folder, and click **Commit**.
3. Go to **Settings > Pages**. Set the source to **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After a minute the scheduler is live at `https://YOUR-GITHUB-USERNAME.github.io/smart-scheduler/`.

### 6. First sign-in (owner)
1. Open the page and sign in with `fpina@1915south.com`. Open the email link on the same device.
2. The page asks for the starting data file. Choose `smart-scheduler-starting-data.json`.
3. Click **Access** in the top bar. Either leave "Anyone with an @1915south.com email" on, or turn it off and list the leaders. Add admins, for example whoever uploads weekly traffic.
4. Send leaders the link.

## Who can do what

| Person | Can do |
|---|---|
| Owner (fpina@1915south.com) | Everything, including the staffing standard, holidays and tentpoles, and access |
| Admins (set in Access) | Everything a leader can do, plus upload weekly traffic |
| Leaders (domain or list) | Build, edit and post schedules, change team counts, rate performance |
| Anyone else | Nothing. They see "you don't have access yet." |

This is enforced by `firestore.rules`. If you change the owner email, change it in **both** `config.js` and `firestore.rules`, then publish the rules again.

## Making changes later
- **With Claude Code:** clone this repository on your PC, ask for the change, and let it commit and push. GitHub Pages updates in about a minute.
- **By hand:** edit the file on github.com and commit.
- **After changing `app.js`:** bump `version` in `config.js` so browsers load the new copy.
