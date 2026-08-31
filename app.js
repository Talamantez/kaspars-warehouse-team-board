// ---------------------------------------------------------------------------
// Team Board — a touch-friendly Planner board for iPad Safari/Chrome.
//
// Auth: delegated permissions only (Tasks.ReadWrite, User.Read), SPA + PKCE,
// no client secret. This app can only see/do what the signed-in user could
// already do in Planner. See README.md for the one-time Entra ID setup.
//
// Sign-in uses the *redirect* flow (not popup): popups don't complete in iOS
// standalone / "Add to Home Screen" mode, which is exactly how the README
// tells people to run this.
// ---------------------------------------------------------------------------

// ===== Pure logic ==========================================================
// Kept free of DOM / network / globals so it can be unit-tested under Node
// (`npm test`) and reused by the browser wiring below. It is exported via
// module.exports for the test runner, and attached to window.TeamBoard when
// loaded as a plain <script> from index.html.

(function (root) {
  "use strict";

  const SCOPES = ["User.Read", "Tasks.ReadWrite"];

  function isDone(task) {
    return (task && task.percentComplete ? task.percentComplete : 0) >= 100;
  }

  function isOverdue(task, now) {
    if (!task || !task.dueDateTime || isDone(task)) return false;
    return new Date(task.dueDateTime) < (now || new Date());
  }

  function byOrderHint(a, b) {
    return String((a && a.orderHint) || "").localeCompare(
      String((b && b.orderHint) || "")
    );
  }

  // Non-mutating sort — callers pass arrays straight off a Graph response.
  function sortByOrderHint(items) {
    return (items || []).slice().sort(byOrderHint);
  }

  function tasksForBucket(tasks, bucketId) {
    return sortByOrderHint((tasks || []).filter((t) => t.bucketId === bucketId));
  }

  // planId comes from user input / config — encode it so a stray "/" or "?"
  // can't reshape the request path.
  function planPath(planId, sub) {
    return `/planner/plans/${encodeURIComponent(planId)}/${sub}`;
  }

  function escapeHtml(str) {
    return (str == null ? "" : String(str))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Replace a task in the cache by id with a server-returned copy (which
  // carries a fresh @odata.etag). Returns a new array; inputs untouched.
  function mergeUpdatedTask(tasks, updated) {
    return (tasks || []).map((t) => (t.id === updated.id ? updated : t));
  }

  // Optimistic local patch — only used as a fallback when the server doesn't
  // hand back the updated entity.
  function applyTaskPatch(tasks, taskId, patch) {
    return (tasks || []).map((t) =>
      t.id === taskId ? Object.assign({}, t, patch) : t
    );
  }

  // Follow @odata.nextLink so big plans don't silently truncate at one page.
  // `get` is an async fn taking a path OR an absolute URL and returning the
  // parsed JSON page.
  async function collectPages(pathOrUrl, get) {
    let out = [];
    let next = pathOrUrl;
    while (next) {
      const page = await get(next);
      out = out.concat((page && page.value) || []);
      next = (page && page["@odata.nextLink"]) || null;
    }
    return out;
  }

  function columnHtml(bucket, taskCount) {
    return (
      `<div class="column-header">` +
      `<span>${escapeHtml(bucket.name)}</span>` +
      `<span class="column-count">${taskCount}</span>` +
      `</div>` +
      `<div class="column-tasks"></div>`
    );
  }

  function taskCardHtml(task, buckets, now) {
    const done = isDone(task);
    const due = task.dueDateTime ? new Date(task.dueDateTime) : null;
    const overdue = isOverdue(task, now);
    const bucketOptions = (buckets || [])
      .map(
        (b) =>
          `<option value="${escapeHtml(b.id)}"${
            b.id === task.bucketId ? " selected" : ""
          }>${escapeHtml(b.name)}</option>`
      )
      .join("");
    return (
      `<div class="task-title-row">` +
      `<input type="checkbox"${done ? " checked" : ""} />` +
      `<div class="task-title ${done ? "done" : ""}">${escapeHtml(
        task.title || "(untitled)"
      )}</div>` +
      `</div>` +
      `<div class="task-meta">` +
      `<span class="task-due ${overdue ? "overdue" : ""}">${
        due ? escapeHtml(due.toLocaleDateString()) : ""
      }</span>` +
      `<select class="move-select">${bucketOptions}</select>` +
      `</div>`
    );
  }

  const api = {
    SCOPES,
    isDone,
    isOverdue,
    byOrderHint,
    sortByOrderHint,
    tasksForBucket,
    planPath,
    escapeHtml,
    mergeUpdatedTask,
    applyTaskPatch,
    collectPages,
    columnHtml,
    taskCardHtml,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TeamBoard = api;
})(typeof self !== "undefined" ? self : this);

// ===== Browser wiring ======================================================
// Skipped entirely under Node (no `window`), so requiring this file in tests
// pulls in only the pure logic above.

if (typeof window !== "undefined" && typeof document !== "undefined") {
  (function () {
    "use strict";

    const {
      SCOPES,
      isDone,
      sortByOrderHint,
      tasksForBucket,
      planPath,
      escapeHtml,
      mergeUpdatedTask,
      collectPages,
      columnHtml,
      taskCardHtml,
    } = window.TeamBoard;

    const el = (id) => document.getElementById(id);

    function fatal(msg) {
      const area = el("statusArea");
      if (!area) return;
      area.hidden = false;
      area.innerHTML = `<p>${escapeHtml(msg)}</p>`;
    }

    // If a managed network blocks the MSAL CDN, `msal` is undefined and the
    // app would otherwise render a blank page with no clue why.
    if (typeof msal === "undefined") {
      fatal(
        "Couldn't load the Microsoft sign-in library (msal-browser). If you're " +
          "on a managed network, https://alcdn.msauth.net may be blocked — ask " +
          "IT to allow it, or host that script alongside these files."
      );
      return;
    }

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

      if (account) onSignedIn();
    }

    el("signInBtn").addEventListener("click", signIn);
    el("refreshBtn").addEventListener("click", () => loadBoard());

    function signIn() {
      // Full-page redirect — see file header for why this isn't loginPopup.
      msalApp.loginRedirect({ scopes: SCOPES }).catch((e) => {
        console.error(e);
        fatal("Sign-in failed: " + (e && e.message ? e.message : e));
      });
    }

    function onSignedIn() {
      el("signInBtn").hidden = true;
      el("refreshBtn").hidden = false;
      el("userLabel").hidden = false;
      el("userLabel").textContent =
        account.username || account.name || "Signed in";
      ensurePlanIdThenLoad();
    }

    // ---- Token + Graph helpers ----------------------------------------

    async function getToken() {
      const req = { scopes: SCOPES, account };
      try {
        const result = await msalApp.acquireTokenSilent(req);
        return result.accessToken;
      } catch (e) {
        console.warn("Silent token acquisition failed, redirecting to sign in", e);
        setStatus("Redirecting to sign in…");
        await msalApp.acquireTokenRedirect(req); // navigates away
        throw new Error("redirecting for authentication");
      }
    }

    function graphUrl(pathOrUrl) {
      return pathOrUrl.startsWith("http")
        ? pathOrUrl
        : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
    }

    async function graphGet(pathOrUrl) {
      const token = await getToken();
      const res = await fetch(graphUrl(pathOrUrl), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(
          `GET ${pathOrUrl} failed: ${res.status} ${await safeText(res)}`
        );
      }
      return res.json();
    }

    async function graphPatch(path, body, etag) {
      const token = await getToken();
      const res = await fetch(graphUrl(path), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "If-Match": etag,
          // Ask Graph to return the updated task so we pick up its new etag
          // without a second round-trip.
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(
          `PATCH ${path} failed: ${res.status} ${await safeText(res)}`
        );
      }
      if (res.status === 204) return null;
      try {
        return await res.json();
      } catch {
        return null;
      }
    }

    async function safeText(res) {
      try {
        return await res.text();
      } catch {
        return "";
      }
    }

    // ---- Plan selection ---------------------------------------------------

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
      el("statusArea").innerHTML = text
        ? `<p id="statusText">${escapeHtml(text)}</p>`
        : "";
    }

    // ---- Scroll preservation -------------------------------------------
    // A re-render blows away and rebuilds the board DOM. Without this the
    // user is yanked back to the top-left on every Refresh and every task
    // edit — a real annoyance on a touch device.

    function captureScroll() {
      const board = el("board");
      const cols = {};
      board.querySelectorAll(".column").forEach((c) => {
        const list = c.querySelector(".column-tasks");
        if (c.dataset.bucketId && list) cols[c.dataset.bucketId] = list.scrollTop;
      });
      return { left: board.scrollLeft, cols };
    }

    function restoreScroll(snap) {
      if (!snap) return;
      const board = el("board");
      board.scrollLeft = snap.left;
      board.querySelectorAll(".column").forEach((c) => {
        const list = c.querySelector(".column-tasks");
        const saved = snap.cols[c.dataset.bucketId];
        if (list && saved != null) list.scrollTop = saved;
      });
    }

    // ---- Loading + rendering -------------------------------------------

    async function loadBoard() {
      const snap = captureScroll();
      setStatus("Loading board…");
      el("board").hidden = true;
      try {
        const [buckets, tasks] = await Promise.all([
          collectPages(planPath(planId, "buckets"), graphGet),
          collectPages(planPath(planId, "tasks"), graphGet),
        ]);
        bucketsCache = sortByOrderHint(buckets);
        tasksCache = tasks;
        renderBoard();
        setStatus("");
        el("board").hidden = false;
        restoreScroll(snap);
      } catch (e) {
        console.error(e);
        setStatus(
          "Couldn't load the board (" +
            e.message +
            "). Check the plan ID and try Refresh."
        );
      }
    }

    function renderBoard() {
      const board = el("board");
      board.innerHTML = "";

      for (const bucket of bucketsCache) {
        const tasks = tasksForBucket(tasksCache, bucket.id);

        const col = document.createElement("div");
        col.className = "column";
        col.dataset.bucketId = bucket.id;
        col.innerHTML = columnHtml(bucket, tasks.length);
        board.appendChild(col);

        const list = col.querySelector(".column-tasks");
        if (tasks.length === 0) {
          list.innerHTML = `<div class="empty-column">No tasks</div>`;
          continue;
        }
        for (const task of tasks) list.appendChild(renderTaskCard(task));
      }
    }

    function renderTaskCard(task) {
      const card = document.createElement("div");
      card.className = "task-card" + (isDone(task) ? " done" : "");
      card.innerHTML = taskCardHtml(task, bucketsCache, new Date());

      card
        .querySelector('input[type="checkbox"]')
        .addEventListener("change", (e) => toggleComplete(task, e.target.checked));
      card
        .querySelector(".move-select")
        .addEventListener("change", (e) => moveTaskToBucket(task, e.target.value));

      return card;
    }

    // Patch one task, refresh just that task in the cache, and re-render in
    // place — no full board reload, no "Loading…" flash, scroll preserved.
    async function updateTaskLocally(task, patch) {
      let updated = await graphPatch(
        `/planner/tasks/${task.id}`,
        patch,
        task["@odata.etag"]
      );
      if (!updated) updated = await graphGet(`/planner/tasks/${task.id}`);
      tasksCache = mergeUpdatedTask(tasksCache, updated);
      const snap = captureScroll();
      renderBoard();
      restoreScroll(snap);
    }

    async function toggleComplete(task, checked) {
      try {
        await updateTaskLocally(task, { percentComplete: checked ? 100 : 0 });
      } catch (e) {
        console.error(e);
        alert("Couldn't update that task — it may have just changed. Refreshing…");
        await loadBoard();
      }
    }

    async function moveTaskToBucket(task, newBucketId) {
      if (newBucketId === task.bucketId) return;
      try {
        await updateTaskLocally(task, { bucketId: newBucketId });
      } catch (e) {
        console.error(e);
        alert("Couldn't move that task — it may have just changed. Refreshing…");
        await loadBoard();
      }
    }

    init();
  })();
}
