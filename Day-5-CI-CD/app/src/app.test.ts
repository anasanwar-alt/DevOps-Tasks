import assert from "node:assert/strict";
import { get } from "node:http";
import { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp, greeting } from "./app";

/**
 * Tests use Node 22's BUILT-IN test runner (`node --test`) and built-in
 * assertions — no Jest, no Mocha, no extra dependency to install or audit.
 */

describe("greeting()", () => {
  it("includes the host and pid it was given", () => {
    const out = greeting("abc123", 1);
    assert.match(out, /host abc123/);
    assert.match(out, /pid 1/);
  });

  it("ends with a newline so terminal output is not mangled", () => {
    assert.ok(greeting("h", 2).endsWith("\n"));
  });

  it("is pure — same input, same output", () => {
    assert.equal(greeting("h", 3), greeting("h", 3));
  });
});

describe("HTTP server", () => {
  const server = createApp();
  let base: string;

  // Port 0 = "any free port". Hard-coding 3000 here would make the test suite
  // fail whenever the dev server (or a leftover container) already holds it.
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const fetchText = (path: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      get(`${base}${path}`, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }).on("error", reject);
    });

  it("GET /health returns 200 ok", async () => {
    const res = await fetchText("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body, "ok\n");
  });

  it("GET / returns the greeting", async () => {
    const res = await fetchText("/");
    assert.equal(res.status, 200);
    assert.match(res.body, /Hello World from Docker/);
  });
});