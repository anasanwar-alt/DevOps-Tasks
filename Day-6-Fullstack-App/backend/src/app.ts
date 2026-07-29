import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Db } from "./db";
import { HttpError, parseId, validateTitle } from "./validate";

// Every column the API is willing to expose. Listing them beats `SELECT *`:
// adding a column to the table later cannot silently leak it through the API.
const COLUMNS = "id, title, done, created_at";

/**
 * Builds the Express application.
 *
 * The database is a PARAMETER, not an import. server.ts passes the real pool;
 * app.test.ts passes a stub. That single decision is why `npm test` needs no
 * Postgres container in CI.
 *
 * Note on error handling: these handlers are `async` and do not try/catch.
 * Express 5 forwards a rejected handler promise to the error middleware
 * automatically — in Express 4 it would have hung instead.
 */
export function createApp(db: Db): Express {
  const app = express();

  // Parses `Content-Type: application/json` bodies into req.body. Without this,
  // req.body is undefined and every POST looks like a missing title.
  app.use(express.json());

  // --- Health --------------------------------------------------------------
  // Handles its own errors rather than delegating, because the compose
  // healthcheck needs 503 ("I am up but my dependency is not"), not 500.
  app.get("/health", async (_req: Request, res: Response) => {
    try {
      await db.query("SELECT 1");
      res.type("text/plain").send("ok\n");
    } catch (err) {
      res
        .status(503)
        .type("text/plain")
        .send(`db error: ${(err as Error).message}\n`);
    }
  });

  // --- Read ----------------------------------------------------------------
  app.get("/api/tasks", async (_req: Request, res: Response) => {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM tasks ORDER BY id DESC`,
    );
    res.json(rows);
  });

  // --- Create --------------------------------------------------------------
  app.post("/api/tasks", async (req: Request, res: Response) => {
    const title = validateTitle((req.body as { title?: unknown })?.title);
    // $1 is a bound parameter, sent to Postgres separately from the SQL text.
    // Never build SQL by concatenating user input — that is SQL injection.
    const { rows } = await db.query(
      `INSERT INTO tasks (title) VALUES ($1) RETURNING ${COLUMNS}`,
      [title],
    );
    // 201 Created, and the body is the row as stored (with its real id).
    res.status(201).json(rows[0]);
  });

  // --- Update (toggle done) ------------------------------------------------
  // `SET done = NOT done` flips it inside Postgres, so this is one round trip
  // and two concurrent clicks cannot read-then-write a stale value.
  app.patch("/api/tasks/:id", async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    const { rows } = await db.query(
      `UPDATE tasks SET done = NOT done WHERE id = $1 RETURNING ${COLUMNS}`,
      [id],
    );
    if (rows.length === 0) {
      throw new HttpError(404, `no task with id ${id}`);
    }
    res.json(rows[0]);
  });

  // --- Delete --------------------------------------------------------------
  app.delete("/api/tasks/:id", async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    const { rowCount } = await db.query("DELETE FROM tasks WHERE id = $1", [id]);
    if (rowCount === 0) {
      throw new HttpError(404, `no task with id ${id}`);
    }
    // 204 No Content: it worked, and there is deliberately nothing to return.
    res.status(204).end();
  });

  // --- Unknown routes ------------------------------------------------------
  // Registered after the routes and before the error handler, so it only sees
  // requests nothing above matched.
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `no route for ${req.method} ${req.path}` });
  });

  // --- Errors --------------------------------------------------------------
  // Express recognises error middleware by its FOUR arguments. `_next` is
  // unused but must stay, or Express treats this as an ordinary handler and
  // never calls it. (The `argsIgnorePattern: "^_"` ESLint rule exists for
  // exactly this case.)
  app.use(
    (err: Error, _req: Request, res: Response, _next: NextFunction) => {
      const status = err instanceof HttpError ? err.status : 500;
      // Client mistakes (4xx) are not incidents; only log the real failures.
      if (status >= 500) {
        console.error(err);
      }
      res.status(status).json({ error: err.message });
    },
  );

  return app;
}
