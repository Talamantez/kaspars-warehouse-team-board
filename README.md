# Team Board — a touch-friendly Planner board for iPad

A small standalone web app that reads/writes a single Planner plan via
Microsoft Graph and renders it as a board with buckets as columns —
built specifically so scrolling actually works on iPad Safari/Chrome,
which the native Planner web UI doesn't do reliably.

**Why this is low-friction for IT:** no backend server, no client
secret, no app-only/tenant-wide permissions. It's a "single-page app"
registration using PKCE, and every action it takes uses the signed-in
employee's own delegated permissions — the app can only see or change
what that person could already do in Planner themselves. Nothing new
is added to Teams, and no new licenses are required.

---

## 1. One-time setup: register the app in Entra ID

Someone with permission to create app registrations (usually a
Microsoft 365 admin) does this once, in the
[Entra admin center](https://entra.microsoft.com) → **App registrations** → **New registration**:

1. **Name:** anything recognizable, e.g. `Team Board (iPad)`.
2. **Supported account types:** *Accounts in this organizational directory
   only* (single tenant) — no need for multi-tenant.
3. **Redirect URI:** platform type **Single-page application (SPA)**,
   value = the exact URL you'll host this at (e.g.
   `https://yourname.github.io/team-board/`). You can add more than
   one redirect URI later if you host it somewhere else too.
   *Trailing slash matters:* register the URL exactly as people will
   open it. If you host at `.../team-board/` but someone opens
   `.../team-board`, sign-in fails with a redirect-URI mismatch — so
   either register both forms or always link the trailing-slash URL.
4. Click **Register**.
5. Go to **API permissions** → **Add a permission** → **Microsoft
   Graph** → **Delegated permissions**, and add:
   - `Tasks.ReadWrite`
   - `User.Read` (usually already present by default)
6. If your tenant requires admin consent for delegated permissions,
   click **Grant admin consent**. Many tenants allow users to consent
   to these two scopes themselves on first sign-in, in which case this
   step isn't needed.
7. Copy two values from the **Overview** page:
   - **Application (client) ID**
   - **Directory (tenant) ID**

No client secret is created — SPA apps use PKCE instead, so there's
nothing secret to store or leak.

## 2. Find the Planner plan ID

Quickest way: open the plan at [planner.cloud.microsoft](https://planner.cloud.microsoft/),
select it, and look at the URL — it contains `.../plan/<PLAN_ID>/view...`.
Copy the ID between `plan/` and `/view`.

(Backup method: sign in at [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer),
run a `GET` on `https://graph.microsoft.com/v1.0/me/planner/plans`, and
copy the `id` for the plan by its title.)

You can also leave this blank and paste it into the app itself the
first time it loads — it'll remember it on that device after that.

## 3. Fill in `config.js`

Open `config.js` and set:

```js
clientId: "the Application (client) ID from step 1",
tenantId: "the Directory (tenant) ID from step 1",
planId: "the plan ID from step 2, or leave as \"\" to enter it in-app",
```

Leave `redirectUri` as-is unless you're hosting at a sub-path — it
auto-detects the URL it's running at, but it must still exactly match
what you registered in step 1.

## 4. Host it

This is just static files — `index.html`, `config.js`, `app.js`,
`styles.css` — no server, no build step. Pick whichever is easiest to
get approved:

- **GitHub Pages** (free, no new vendor if GitHub is already used):
  push this folder to a repo, enable Pages on it, and the URL it gives
  you is what goes in the redirect URI above.
- **Azure Static Web Apps** (free tier): if the organization already
  has an Azure subscription, this keeps everything inside infrastructure
  IT already manages.
- Any other static host works the same way — Netlify, S3 + CloudFront,
  an internal web server, etc.

Once it's live, open the URL on the iPad and add it to the home screen
(Safari share icon → **Add to Home Screen**) so it opens full-screen
like a native app.

## 5. Using it

- **Sign in** with the same work account used in Planner. This does a
  full-page redirect to Microsoft and back (not a popup) — popups don't
  complete when the app runs full-screen from the iPad home screen.
- Buckets render as horizontally-scrollable columns; each column's
  tasks scroll independently — both use native touch scrolling, so
  this is the part that actually fixes the original iPad problem.
- Tap the checkbox to mark a task complete.
- Use the small dropdown on a task to move it to a different bucket
  (a tap-based move instead of drag-and-drop, since drag gestures are
  what conflict with scrolling on touch in the first place).
- **Refresh** re-pulls the latest from Planner — useful if someone
  else edited the plan elsewhere.

## Development / tests

The pure logic in `app.js` (sorting, filtering, overdue calculation,
HTML escaping, Graph pagination, card markup) is covered by unit tests
that need only Node 18+ — no `npm install`, no dependencies:

```bash
npm test
```

(or `node --test` directly). The browser-wiring half of `app.js` is
skipped automatically when the file is loaded under Node, so the same
file serves both the page and the tests.

## Notes / limitations

- This is read/write on one plan at a time, chosen by plan ID — it
  doesn't try to be a full Planner replacement, just a board that
  works on iPad.
- Buckets and tasks are fetched with pagination followed, so large
  plans load fully rather than stopping at the first page.
- The app pulls one script from a CDN (`alcdn.msauth.net`, Microsoft's
  MSAL library, integrity-pinned). On a locked-down network that host
  must be reachable, or the app shows a "couldn't load the sign-in
  library" message instead of a blank page.
- Task ordering within a column is approximated from Planner's
  `orderHint` field; it'll be close to the real Planner order but
  isn't guaranteed to be pixel-identical.
- If two people edit the same task at nearly the same moment, Graph
  will reject the older write (a 412 conflict) — the app just reloads
  and asks you to try again, since Planner's own web/app clients would
  hit the same conflict.
