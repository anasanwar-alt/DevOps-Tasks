import { createApp } from "./app";

// Bind to 0.0.0.0, NOT 127.0.0.1: inside a container, 127.0.0.1 is the
// container's own loopback interface, unreachable via `docker run -p`.
const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);

const server = createApp();

server.listen(PORT, HOST, () => {
  console.log(`listening on http://${HOST}:${PORT} (pid ${process.pid})`);
});

// Handle SIGTERM explicitly. As PID 1 the kernel installs no default handlers,
// so without this `docker stop` waits the full 10s grace period then SIGKILLs
// (exit 137). With it, the process exits promptly on SIGTERM (exit 143).
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => process.exit(0));
});