// ---------------------------------------------------------------------------
// The only file you edit. Fill in the two IDs your admin gets when they
// register the app in Entra ID (see README.md → "One-time setup"), commit,
// and push to main. Everything else is automatic.
// ---------------------------------------------------------------------------
const CONFIG = {
  // App registration > Overview > "Application (client) ID"
  clientId: "PASTE-CLIENT-ID-HERE",

  // App registration > Overview > "Directory (tenant) ID"
  tenantId: "PASTE-TENANT-ID-HERE",

  // Optional: the Planner plan to show. Paste the "planId=" value from the
  // plan's web URL (README.md has the steps). Leave blank and the app asks
  // for it once on first load, then remembers it on that device.
  planId: "",

  // Leave blank. app.js computes the redirect URI as the page's canonical
  // URL (origin + path, trailing slash, no query or hash) so there is exactly
  // one value to register in Entra and no trailing-slash foot-gun. Set a
  // value here only to force a specific redirect URI.
  redirectUri: "",
};
