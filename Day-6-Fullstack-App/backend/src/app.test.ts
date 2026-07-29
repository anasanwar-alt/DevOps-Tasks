// Tests using Node's BUILT-IN test runner (`node --test`, stable since Node 20).
// No jest, no mocha, no supertest — zero extra dependencies to install, audit or
// keep up to date. `npm test` compiles this to dist-test/ and runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { createApp } from "./app";
import type { Db, TaskRow } from "./db";
import { HttpError, parseId, validateTitle } from "./validate";

// Every route in app.ts issues EXACTLY ONE query, so a stub that returns the
// same canned result for any SQL is a valid double. If a route ever needs two
// queries, this stub must grow — that is a deliberate design constraint.
function stubDb(rows: TaskRow[], rowCount: number = rows.length): Db {
  return {
    query: () => Promise.resolve({ rows, rowCount }),
  };
}

const sample: TaskRow = {
  id: 1,
  title: "write the Dockerfile",
  done: false,
  created_at: new Date("2026-07-29T09:00:00Z"),
};

/**
 * Boots the app on an OS-assigned free port (`listen(0)`), runs the test
 * against it, and always closes it. Port 0 means parallel test runs — and CI
 * runners with other things listening — can never collide.
 */
async function withServer(
  db: Db,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const asJson = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// --- Pure validation (no server, no database) ------------------------------

test("validateTitle trims surrounding whitespace", () => {
  assert.equal(validateTitle("  buy milk  "), "buy milk");
});

test("validateTitle rejects a whitespace-only title", () => {
  assert.throws(() => validateTitle("   "), HttpError);
});

test("validateTitle rejects a non-string", () => {
  assert.throws(() => validateTitle(42), HttpError);
});

test("parseId accepts a positive integer string", () => {
  assert.equal(parseId("7"), 7);
});

test("parseId rejects an array, rather than coercing it", () => {
  // Express 5 can hand a string[] to a param. Number(["7"]) would be 7 —
  // this asserts we reject it instead of silently accepting it.
  assert.throws(() => parseId(["7"]), HttpError);
});

test("parseId rejects non-numeric and non-positive ids", () => {
  assert.throws(() => parseId("abc"), HttpError);
  assert.throws(() => parseId("0"), HttpError);
  assert.throws(() => parseId("1.5"), HttpError);
});

// --- The HTTP layer, driven with the global fetch built into Node 22 --------

test("GET /health returns 200 when the database answers", async () => {
  await withServer(stubDb([]), async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.text()).trim(), "ok");
  });
});

test("GET /api/tasks returns the rows as JSON", async () => {
  await withServer(stubDb([sample]), async (base) => {
    const res = await fetch(`${base}/api/tasks`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as TaskRow[];
    assert.equal(body.length, 1);
    assert.equal(body[0].title, "write the Dockerfile");
  });
});

test("POST /api/tasks returns 201 and the created row", async () => {
  await withServer(stubDb([sample]), async (base) => {
    const res = await fetch(
      `${base}/api/tasks`,
      asJson({ title: "write the Dockerfile" }),
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as TaskRow;
    assert.equal(body.id, 1);
  });
});

test("POST /api/tasks with a blank title returns 400, not 500", async () => {
  await withServer(stubDb([]), async (base) => {
    const res = await fetch(`${base}/api/tasks`, asJson({ title: "   " }));
    assert.equal(res.status, 400);
  });
});

test("DELETE /api/tasks/:id returns 404 when no row was removed", async () => {
  // rowCount 0 is how Postgres reports "the WHERE clause matched nothing".
  await withServer(stubDb([], 0), async (base) => {
    const res = await fetch(`${base}/api/tasks/999`, { method: "DELETE" });
    assert.equal(res.status, 404);
  });
});

test("an unknown route returns 404 JSON", async () => {
  await withServer(stubDb([]), async (base) => {
    const res = await fetch(`${base}/api/nope`);
    assert.equal(res.status, 404);
  });
});
