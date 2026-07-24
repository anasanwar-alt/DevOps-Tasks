import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { hostname } from "node:os";
import { Pool } from "pg";

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);

// The `pg` Pool reads PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE from the
// environment automatically. Those are injected by docker-compose (see the app
// service's `environment:` block) — the app itself hard-codes no connection details.
const pool = new Pool({
  max: 5,
  connectionTimeoutMillis: 5000,
});

// Ensure the schema exists, retrying until Postgres is reachable. `depends_on:
// service_healthy` already gates startup on the DB healthcheck, but a short retry
// loop keeps the app robust to transient connection resets during boot.
async function initDb(retries = 15): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS visits (
          id      SERIAL PRIMARY KEY,
          seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          host    TEXT NOT NULL
        )
      `);
      console.log(`db ready — schema ensured (attempt ${attempt})`);
      return;
    } catch (err) {
      console.log(`db not ready (attempt ${attempt}/${retries}): ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("could not reach database after retries");
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    // Lightweight liveness/readiness probe used by the compose healthcheck.
    if (req.url === "/health") {
      await pool.query("SELECT 1");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok\n");
      return;
    }

    // Every other request is a real round-trip to Postgres: write one row, then
    // read the running total back out. This is the "app talks to the DB" proof.
    await pool.query("INSERT INTO visits (host) VALUES ($1)", [hostname()]);
    const { rows } = await pool.query("SELECT count(*)::int AS total FROM visits");
    const total = rows[0].total;
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> visits=${total}`);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Hello from ${hostname()} — this app has recorded ${total} visit(s) in Postgres\n`);
  } catch (err) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end(`db error: ${(err as Error).message}\n`);
  }
});

initDb()
  .then(() => {
    server.listen(PORT, HOST, () =>
      console.log(`listening on http://${HOST}:${PORT} (pid ${process.pid})`),
    );
  })
  .catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });

// Graceful shutdown (see Day 3 §3.1): PID 1 gets no default SIGTERM handler, so
// without this `docker compose stop` would wait the full grace period then SIGKILL.
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
