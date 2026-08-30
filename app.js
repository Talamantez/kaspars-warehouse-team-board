// ---------------------------------------------------------------------------
// Team Board — a touch-friendly Planner board for iPad Safari/Chrome.
//
// Auth: delegated permissions only (Tasks.ReadWrite, User.Read), SPA + PKCE,
// no client secret. This app can only see/do what the signed-in user could
// already do in Planner. See README.md for the one-time Entra ID setup.
// ---------------------------------------------------------------------------

const SCOPES = ["User.Read", "Tasks.ReadWrite"];

const msalConfig = {
  auth: {
    clientId: CONFIG.clientId,
    authority: `https://login.microsoftonline.com/${CONFIG.tenantId}`,
    redirectUri: CONFIG.redirectUri,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

const msalApp = new msal.PublicClientApplication(msalConfig);

let account = null;
let planId = CONFIG.planId || localStorage.getItem("teamboard_planId") || "";
let bucketsCache = [];
let tasksCache = [];

const el = (id) => document.getElementById(id);

// ---- Boot ------------------------------------------------------------

async function init() {
  try {
    const response = await msalApp.handleRedirectPromise();
    if (response && response.account) {
      account = response.account;
    } else {
      const accounts = msalApp.getAllAccounts();
      if (accounts.length > 0) account = accounts[0];
    }
  } catch (e) {
    console.error("handleRedirectPromise failed", e);
  }

  if (account) {
    onSignedIn();
  }
}

el("signInBtn").addEventListener("click", signIn);
el("refreshBtn").addEventListener("click", () => loadBoard());

async function signIn() {
  try {
    const result = await msalApp.loginPopup({ scopes: SCOPES });
    account = result.account;
    onSignedIn();
  } catch (e) {
    console.error(e);
    setStatus("Sign-in failed: " + (e && e.message ? e.message : e));
  }
}

function onSignedIn() {
  el("signInBtn").hidden = true;
  el("refreshBtn").hidden = false;
  el("userLabel").hidden = false;
  el("userLabel").textContent = account.username || account.name || "Signed in";
  ensurePlanIdThenLoad();
}

// ---- Token + Graph helpers --------------------------------------------

async function getToken() {
  const req = { scopes: SCOPES, account };
  try {
    const result = await msalApp.acquireTokenSilent(req);
    return result.accessToken;
  } catch (e) {
    console.warn("Silent token acquisition failed, falling back to popup", e);
    const result = await msalApp.acquireTokenPopup(req);
    return result.accessToken;
  }
}

async function graphGet(path) {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${await safeText(res)}`);
  }
  return res.json();
}

async function graphPatch(path, body, etag) {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "If-Match": etag,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PATCH ${path} failed: ${res.status} ${await safeText(res)}`);
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// ---- Plan selection -----------------------------------------------------

function ensurePlanIdThenLoad() {
  if (planId) {
    loadBoard();
    return;
  }
  el("board").hidden = true;
  el("statusArea").hidden = false;
  el("statusArea").innerHTML = `
    <p>Paste the Planner plan ID to load its board (one-time; saved on this device).</p>
    <p style="font-size:13px;">Find it in the plan's web URL — see README.md for exact steps.</p>
    <input id="planIdInput" placeholder="e.g. xQ7bfgIhq0-a1b2c3d4e5"
      style="font-size:15px;padding:10px;width:280px;max-width:70vw;border-radius:8px;border:1px solid var(--border);background:var(--card-bg);color:var(--text);" />
    <button id="planIdSubmit">Load</button>
  `;
  el("planIdSubmit").addEventListener("click", () => {
    const val = el("planIdInput").value.trim();
    if (!val) return;
    planId = val;
    localStorage.setItem("teamboard_planId", val);
    loadBoard();
  });
}

function setStatus(text) {
  el("statusArea").hidden = !text;
  el("statusArea").innerHTML = text ? `<p id="statusText">${escapeHtml(text)}</p>` : "";
}

// ---- Loading + rendering -------------------------------------------------

async function loadBoard() {
  setStatus("Loading board…");
  el("board").hidden = true;
  try {
    const [bucketsRes, tasksRes] = await Promise.all([
      graphGet(`/planner/plans/${planId}/buckets`),
      graphGet(`/planner/plans/${planId}/tasks`),
    ]);
    bucketsCache = bucketsRes.value.sort((a, b) =>
      (a.orderHint || "").localeCompare(b.orderHint || "")
    );
    tasksCache = tasksRes.value;
    renderBoard();
    setStatus("");
    el("board").hidden = false;
  } catch (e) {
    console.error(e);
    setStatus(
      "Couldn't load the board (" + e.message + "). Check the plan ID and try Refresh."
    );
  }
}

function renderBoard() {
  const board = el("board");
  board.innerHTML = "";

  for (const bucket of bucketsCache) {
    const tasks = tasksCache
      .filter((t) => t.bucketId === bucket.id)
      .sort((a, b) => (a.orderHint || "").localeCompare(b.orderHint || ""));

    const col = document.createElement("div");
    col.className = "column";
    col.innerHTML = `
      <div class="column-header">
        <span>${escapeHtml(bucket.name)}</span>
        <span class="column-count">${tasks.length}</span>
      </div>
      <div class="column-tasks"></div>
    `;
    board.appendChild(col);

    const list = col.querySelector(".column-tasks");
    if (tasks.length === 0) {
      list.innerHTML = `<div class="empty-column">No tasks</div>`;
      continue;
    }
    for (const task of tasks) {
      list.appendChild(renderTaskCard(task));
    }
  }
}

function renderTaskCard(task) {
  const done = (task.percentComplete || 0) >= 100;
  const card = document.createElement("div");
  card.className = "task-card" + (done ? " done" : "");

  const due = task.dueDateTime ? new Date(task.dueDateTime) : null;
  const overdue = !!(due && !done && due < new Date());

  const bucketOptions = bucketsCache
    .map(
      (b) =>
        `<option value="${b.id}" ${b.id === task.bucketId ? "selected" : ""}>${escapeHtml(
          b.name
        )}</option>`
    )
    .join("");

  card.innerHTML = `
    <div class="task-title-row">
      <input type="checkbox" ${done ? "checked" : ""} />
      <div class="task-title ${done ? "done" : ""}">${escapeHtml(task.title || "(untitled)")}</div>
    </div>
    <div class="task-meta">
      <span class="task-due ${overdue ? "overdue" : ""}">${due ? due.toLocaleDateString() : ""}</span>
      <select class="move-select">${bucketOptions}</select>
    </div>
  `;

  card
    .querySelector('input[type="checkbox"]')
    .addEventListener("change", (e) => toggleComplete(task, e.target.checked));
  card
    .querySelector(".move-select")
    .addEventListener("change", (e) => moveTaskToBucket(task, e.target.value));

  return card;
}

async function toggleComplete(task, checked) {
  try {
    await graphPatch(
      `/planner/tasks/${task.id}`,
      { percentComplete: checked ? 100 : 0 },
      task["@odata.etag"]
    );
    await loadBoard();
  } catch (e) {
    console.error(e);
    alert("Couldn't update that task — it may have just changed. Refreshing…");
    await loadBoard();
  }
}

async function moveTaskToBucket(task, newBucketId) {
  if (newBucketId === task.bucketId) return;
  try {
    await graphPatch(`/planner/tasks/${task.id}`, { bucketId: newBucketId }, task["@odata.etag"]);
    await loadBoard();
  } catch (e) {
    console.error(e);
    alert("Couldn't move that task — it may have just changed. Refreshing…");
    await loadBoard();
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

init();
