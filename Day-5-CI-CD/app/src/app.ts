import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { hostname } from "node:os";

/** The greeting body, kept as a pure function of its inputs. */
export function greeting(host: string, pid: number): string {
  return `Hello World from Docker — pid ${pid}, host ${host}\n`;
}

/** Build the HTTP server without binding a port; the caller owns the lifecycle. */
export function createApp(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // Log to stdout so `docker logs` (which only sees PID 1's streams) captures it.
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok\n");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(greeting(hostname(), process.pid));
  });
}