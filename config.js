// ---------------------------------------------------------------------------
// FILL THESE IN after your admin registers the app in Entra ID (see README.md)
// ---------------------------------------------------------------------------
const CONFIG = {
  // App registration > Overview > "Application (client) ID"
  clientId: "PASTE-CLIENT-ID-HERE",

  // App registration > Overview > "Directory (tenant) ID"
  tenantId: "PASTE-TENANT-ID-HERE",

  // Must exactly match a "Single-page application" redirect URI
  // configured on the app registration (e.g. your GitHub Pages URL).
  redirectUri: window.location.origin + window.location.pathname,

  // The Planner plan to show. Find it by opening the plan in Planner on the
  // web and copying the "planId=" value from the URL (see README.md for the
  // exact steps), or leave blank to use the plan picker on first load.
  planId: "",
};
