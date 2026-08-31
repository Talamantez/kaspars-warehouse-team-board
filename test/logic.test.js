"use strict";

// Unit tests for the pure logic in app.js. No dependencies — Node's built-in
// runner only:  node --test   (or  npm test).
//
// Requiring app.js in Node pulls in only the exported logic object; the
// browser-wiring block at the bottom of app.js is guarded by `typeof window`
// and never runs here.

const test = require("node:test");
const assert = require("node:assert/strict");

const T = require("../app.js");

// ---- isDone ---------------------------------------------------------------

test("isDone: true at or above 100, false otherwise", () => {
  assert.equal(T.isDone({ percentComplete: 100 }), true);
  assert.equal(T.isDone({ percentComplete: 150 }), true);
  assert.equal(T.isDone({ percentComplete: 99 }), false);
  assert.equal(T.isDone({ percentComplete: 0 }), false);
  assert.equal(T.isDone({}), false);
  assert.equal(T.isDone({ percentComplete: null }), false);
});

// ---- isOverdue ----------------------------------------------------------

test("isOverdue: past due and not done", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  assert.equal(T.isOverdue({ dueDateTime: "2026-08-29T00:00:00Z" }, now), true);
});

test("isOverdue: future due date is not overdue", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  assert.equal(T.isOverdue({ dueDateTime: "2026-09-05T00:00:00Z" }, now), false);
});

test("isOverdue: a completed task is never overdue", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  assert.equal(
    T.isOverdue({ dueDateTime: "2026-08-29T00:00:00Z", percentComplete: 100 }, now),
    false
  );
});

test("isOverdue: no due date is not overdue", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  assert.equal(T.isOverdue({ percentComplete: 0 }, now), false);
  assert.equal(T.isOverdue({}, now), false);
});

// ---- sortByOrderHint / tasksForBucket ---------------------------------

test("sortByOrderHint: ascending by orderHint, input not mutated", () => {
  const input = [{ orderHint: "b" }, { orderHint: "a" }, { orderHint: "c" }];
  const out = T.sortByOrderHint(input);
  assert.deepEqual(out.map((x) => x.orderHint), ["a", "b", "c"]);
  assert.deepEqual(input.map((x) => x.orderHint), ["b", "a", "c"]);
});

test("sortByOrderHint: missing hint sorts as empty string (first)", () => {
  const out = T.sortByOrderHint([{ orderHint: "a" }, {}, { orderHint: "b" }]);
  assert.deepEqual(out.map((x) => x.orderHint), [undefined, "a", "b"]);
});

test("sortByOrderHint: tolerates undefined input", () => {
  assert.deepEqual(T.sortByOrderHint(undefined), []);
});

test("tasksForBucket: filters by bucketId then sorts", () => {
  const tasks = [
    { id: "1", bucketId: "x", orderHint: "b" },
    { id: "2", bucketId: "y", orderHint: "a" },
    { id: "3", bucketId: "x", orderHint: "a" },
  ];
  assert.deepEqual(T.tasksForBucket(tasks, "x").map((t) => t.id), ["3", "1"]);
  assert.deepEqual(T.tasksForBucket(tasks, "z"), []);
  assert.deepEqual(T.tasksForBucket(undefined, "x"), []);
});

// ---- planPath ---------------------------------------------------------

test("planPath: encodes the plan id into the path", () => {
  assert.equal(T.planPath("abc123", "buckets"), "/planner/plans/abc123/buckets");
  assert.equal(
    T.planPath("a/b?c d", "tasks"),
    "/planner/plans/a%2Fb%3Fc%20d/tasks"
  );
});

// ---- canonicalRedirectUri --------------------------------------------

test("canonicalRedirectUri: already canonical is unchanged", () => {
  assert.equal(
    T.canonicalRedirectUri("https://x.github.io/repo/"),
    "https://x.github.io/repo/"
  );
});

test("canonicalRedirectUri: adds the missing trailing slash", () => {
  assert.equal(
    T.canonicalRedirectUri("https://x.github.io/repo"),
    "https://x.github.io/repo/"
  );
});

test("canonicalRedirectUri: strips index.html / index.htm", () => {
  assert.equal(
    T.canonicalRedirectUri("https://x.github.io/repo/index.html"),
    "https://x.github.io/repo/"
  );
  assert.equal(
    T.canonicalRedirectUri("https://x.github.io/repo/index.htm"),
    "https://x.github.io/repo/"
  );
});

test("canonicalRedirectUri: drops query string and hash", () => {
  assert.equal(
    T.canonicalRedirectUri("https://x.github.io/repo/?code=abc&state=1#/board"),
    "https://x.github.io/repo/"
  );
});

test("canonicalRedirectUri: keeps port, host at root stays '/'", () => {
  assert.equal(
    T.canonicalRedirectUri("http://localhost:8080/index.html"),
    "http://localhost:8080/"
  );
});

// ---- isConfigured ---------------------------------------------------------

test("isConfigured: false for the shipped placeholders / blanks", () => {
  assert.equal(
    T.isConfigured({ clientId: "PASTE-CLIENT-ID-HERE", tenantId: "PASTE-TENANT-ID-HERE" }),
    false
  );
  assert.equal(T.isConfigured({ clientId: "", tenantId: "" }), false);
  assert.equal(T.isConfigured({ clientId: "abc", tenantId: "" }), false);
  assert.equal(T.isConfigured(null), false);
});

test("isConfigured: true once both IDs are real", () => {
  assert.equal(
    T.isConfigured({
      clientId: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
    }),
    true
  );
});

// ---- escapeHtml -----------------------------------------------------------

test("escapeHtml: escapes the five HTML-significant characters", () => {
  assert.equal(
    T.escapeHtml("<script>\"x\"&'y'"),
    "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;"
  );
});

test("escapeHtml: null/undefined become empty string, 0 is kept", () => {
  assert.equal(T.escapeHtml(null), "");
  assert.equal(T.escapeHtml(undefined), "");
  assert.equal(T.escapeHtml(0), "0");
});

// ---- mergeUpdatedTask / applyTaskPatch -------------------------------

test("mergeUpdatedTask: swaps the match, keeps others by identity, immutable", () => {
  const a = { id: "1", v: 1 };
  const b = { id: "2", v: 1 };
  const tasks = [a, b];
  const out = T.mergeUpdatedTask(tasks, { id: "2", v: 2 });
  assert.notEqual(out, tasks);
  assert.equal(out[0], a);
  assert.deepEqual(out[1], { id: "2", v: 2 });
  assert.equal(b.v, 1);
});

test("mergeUpdatedTask: unknown id leaves contents unchanged", () => {
  assert.deepEqual(T.mergeUpdatedTask([{ id: "1" }], { id: "9" }), [{ id: "1" }]);
});

test("applyTaskPatch: merges the patch onto the matching task only", () => {
  const tasks = [
    { id: "1", a: 1 },
    { id: "2", a: 1 },
  ];
  const out = T.applyTaskPatch(tasks, "2", { a: 9, b: 2 });
  assert.deepEqual(out, [
    { id: "1", a: 1 },
    { id: "2", a: 9, b: 2 },
  ]);
  assert.equal(tasks[1].a, 1);
});

// ---- collectPages ------------------------------------------------------

test("collectPages: single page returned as-is", async () => {
  const get = async () => ({ value: [1, 2, 3] });
  assert.deepEqual(await T.collectPages("/p", get), [1, 2, 3]);
});

test("collectPages: follows @odata.nextLink and concatenates in order", async () => {
  const calls = [];
  const pages = {
    "/start": { value: [1, 2], "@odata.nextLink": "https://g/next1" },
    "https://g/next1": { value: [3, 4], "@odata.nextLink": "https://g/next2" },
    "https://g/next2": { value: [5] },
  };
  const get = async (url) => {
    calls.push(url);
    return pages[url];
  };
  assert.deepEqual(await T.collectPages("/start", get), [1, 2, 3, 4, 5]);
  assert.deepEqual(calls, ["/start", "https://g/next1", "https://g/next2"]);
});

test("collectPages: tolerates a page with no value array", async () => {
  const get = async () => ({});
  assert.deepEqual(await T.collectPages("/p", get), []);
});

// ---- columnHtml -----------------------------------------------------------

test("columnHtml: escapes the bucket name and shows the count", () => {
  const html = T.columnHtml({ name: "R&D <urgent>" }, 4);
  assert.match(html, /R&amp;D &lt;urgent&gt;/);
  assert.match(html, /column-count">4</);
  assert.match(html, /class="column-tasks"/);
});

// ---- taskCardHtml ---------------------------------------------------------

test("taskCardHtml: done task renders checked + struck-through", () => {
  const html = T.taskCardHtml(
    { title: "Ship it", percentComplete: 100, bucketId: "b1" },
    [{ id: "b1", name: "Doing" }]
  );
  assert.match(html, /type="checkbox" checked/);
  assert.match(html, /task-title done/);
});

test("taskCardHtml: not-done task renders unchecked", () => {
  const html = T.taskCardHtml(
    { title: "x", percentComplete: 0, bucketId: "b1" },
    [{ id: "b1", name: "Doing" }]
  );
  assert.doesNotMatch(html, /checked/);
});

test("taskCardHtml: escapes the title and falls back to (untitled)", () => {
  assert.match(
    T.taskCardHtml({ title: "<img src=x>", bucketId: "b" }, []),
    /&lt;img src=x&gt;/
  );
  assert.match(T.taskCardHtml({ bucketId: "b" }, []), /\(untitled\)/);
});

test("taskCardHtml: marks the task's current bucket option selected", () => {
  const buckets = [
    { id: "b1", name: "To do" },
    { id: "b2", name: "Done" },
  ];
  const html = T.taskCardHtml({ title: "t", bucketId: "b2" }, buckets);
  assert.match(html, /<option value="b2" selected>Done<\/option>/);
  assert.match(html, /<option value="b1">To do<\/option>/);
});

test("taskCardHtml: overdue class only when past due and not done", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  assert.match(
    T.taskCardHtml(
      { title: "t", bucketId: "b", dueDateTime: "2026-08-01T00:00:00Z" },
      [],
      now
    ),
    /task-due overdue/
  );
  assert.doesNotMatch(
    T.taskCardHtml(
      {
        title: "t",
        bucketId: "b",
        dueDateTime: "2026-08-01T00:00:00Z",
        percentComplete: 100,
      },
      [],
      now
    ),
    /overdue/
  );
});
