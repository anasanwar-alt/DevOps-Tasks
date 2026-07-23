import { createServer, IncomingMessage, ServerResponse } from "node:http";

// Bind to 0.0.0.0, NOT 127.0.0.1: inside a container, 127.0.0.1 is the
// container's own loopback interface, unreachable via `docker run -p`.
const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Log to stdout so `docker logs` (which only sees PID 1's stdout/stderr) captures it.
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`Hello World from Docker — pid ${process.pid}, host ${require("node:os").hostname()}\n`);
});

server.listen(PORT, HOST, () => {
  console.log(`listening on http://${HOST}:${PORT} (pid ${process.pid})`);
});

// Handle SIGTERM explicitly. As PID 1 the kernel installs no default handlers,
// so without this `docker stop` waits the full 10s grace period then SIGKILLs (exit 137).
// With it, the process exits promptly on SIGTERM (exit 143).
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => process.exit(0));
});
