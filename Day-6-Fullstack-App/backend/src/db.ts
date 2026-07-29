import { Pool } from "pg";

// The shape of one row in the `tasks` table.
//
// Written as a `type` alias rather than an `interface` on purpose: only type
// aliases get an implicit index signature, and `pg` constrains its row generic
// to `{ [column: string]: any }`. An `interface` here would fail to satisfy it.
export type TaskRow = {
  id: number;
  title: string;
  done: boolean;
  created_at: Date;
};

// The ONLY thing app.ts is allowed to know about the database.
//
// This is the whole trick that makes the API testable in CI: `createApp()` takes
// a `Db`, not a `Pool`. Production passes the real pool; the tests pass a
// four-line stub. No Postgres container is needed to run `npm test`.
export type Db = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: TaskRow[]; rowCount: number | null }>;
};

// The `pg` Pool reads PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE from the
// environment automatically. Those are injected by docker-compose (see the
// backend service's `environment:` block) — the app hard-codes no connection
// details, which is what lets the same image run against any database.
export const pool = new Pool({
  max: 5,
  connectionTimeoutMillis: 5000,
});

// Ensure the schema exists, retrying until Postgres is reachable.
//
// `depends_on: condition: service_healthy` already gates startup on the DB
// healthcheck (Day 4), but a short retry loop keeps the app robust to transient
// connection resets during boot — and lets it start at all if someone runs it
// outside compose.
export async function initDb(retries = 15): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id         SERIAL PRIMARY KEY,
          title      TEXT NOT NULL,
          done       BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      console.log(`db ready — schema ensured (attempt ${attempt})`);
      return;
    } catch (err) {
      console.log(
        `db not ready (attempt ${attempt}/${retries}): ${(err as Error).message}`,
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("could not reach database after retries");
}
