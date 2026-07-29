import { createApp } from "./app";
import { initDb, pool } from "./db";

const HOST = "0.0.0.0"; // not 127.0.0.1 — a container's loopback is its own
const PORT = Number(process.env.PORT ?? 3000);

// This file owns the two things a test must never do: bind a port and touch a
// real database. Everything else lives in app.ts (Day 5's testability split).
initDb()
  .then(() => {
    const server = createApp(pool).listen(PORT, HOST, () =>
      console.log(`listening on http://${HOST}:${PORT} (pid ${process.pid})`),
    );

    // Graceful shutdown (Day 3 §3.1): as PID 1, node gets no default SIGTERM
    // handler, so without this `docker compose stop` waits the full 10s grace
    // period and then SIGKILLs.
    process.on("SIGTERM", () => {
      console.log("SIGTERM received, shutting down");
      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
    });
  })
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
