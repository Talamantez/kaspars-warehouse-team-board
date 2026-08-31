// ---------------------------------------------------------------------------
// FILL THESE IN after your admin registers the app in Entra ID (see README.md)
// ---------------------------------------------------------------------------
const CONFIG = {
  // App registration > Overview > "Application (client) ID"
  clientId: "PASTE-CLIENT-ID-HERE",

  // App registration > Overview > "Directory (tenant) ID"
  tenantId: "PASTE-TENANT-ID-HERE",

  // Must EXACTLY match a "Single-page application" redirect URI on the app
  // registration — protocol, host, path, and trailing slash all included.
  // This auto-detects the URL the app is served from. Gotcha: if you register
  // ".../team-board/" but someone opens ".../team-board" (no trailing slash),
  // window.location.pathname differs and sign-in fails with a redirect-URI
  // mismatch. Register both forms, or always link people to the trailing-slash
  // URL (and on GitHub Pages, index.html is served at the trailing-slash URL).
  redirectUri: window.location.origin + window.location.pathname,

  // The Planner plan to show. Find it by opening the plan in Planner on the
  // web and copying the "planId=" value from the URL (see README.md for the
  // exact steps), or leave blank to use the plan picker on first load.
  planId: "",
};
