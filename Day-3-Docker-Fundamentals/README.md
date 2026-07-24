# Training Day 3 — Docker Fundamentals

> This submission covers the hands-on task: a minimal Node.js Hello World HTTP server, containerised, built, run, inspected, exec'd into, then converted to a multi-stage build with a measured size comparison. Every number and log excerpt below is real output, captured to `verification/` during this session.

---

## 1. Environment

All work performed in **WSL2 (Ubuntu 22.04)** on a Windows 11 host, against **Docker Desktop** (WSL2 backend).

| Item | Value |
|---|---|
| Docker CLI / engine | 27.1.1 |
| Engine platform | `linux/x86_64`, storage driver `overlay2`, cgroup v2 |
| Builder | BuildKit v0.15.0 (buildx v0.16.1) |
| Base image | `node:22-alpine` (runtime base of both images; the multi-stage builder uses `node:22`) |
| App | TypeScript HTTP server using only Node's built-in `http` module |

---

## 2. The Dockerfile (single-stage)

`Dockerfile` — the "before" image. The whole app is built **and** run in one image, on
`node:22-alpine`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json ./   # deps manifest first...
RUN npm install                      # ...so this layer caches independently of source
COPY src ./src
RUN npm run build                    # tsc: src/*.ts -> dist/*.js
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
```

### Notes and caveats

- **Containers run as root unless told otherwise.** Without `USER node`, PID 1 is `root`. Root in a container is not root on the host, but it shares the host kernel, so dropping privileges is standard practice. Confirmed in §3: `docker exec … whoami` returns `node`.

---

## 3. Build, run, logs, exec

Built and run (`verification/01-build-output.txt`, `verification/02-logs-and-exec.txt`):

```
$ docker build -t day3-hello:single -f Dockerfile ./app
$ docker run -d -p 3000:3000 --name day3-hello day3-hello:single
  9a8c1e6fbcfd...   (the container shown in screenshots 07 and 08)

$ curl -s http://localhost:3000/
Hello World from Docker — pid 1, host 9a8c1e6fbcfd

$ docker logs day3-hello         # PID 1 stdout only
listening on http://0.0.0.0:3000 (pid 1)
2026-07-23T15:35:04.775Z GET /
2026-07-23T15:35:04.818Z GET /favicon.ico
2026-07-23T15:45:59.093Z GET /health

$ docker exec day3-hello whoami          # USER node took effect
node
$ docker exec day3-hello sh -c 'cat /proc/1/comm'   # what is PID 1?
node
$ docker exec -it day3-hello bash        # alpine has no bash
OCI runtime exec failed: exec: "bash": executable file not found in $PATH
```

- `docker logs` shows the container's stdout/stderr — here, the request lines the app logged.
- `/proc/1/comm` is `node`: the exec-form `CMD` put node directly at PID 1 (not wrapped in a
  shell). This is what makes the signal behaviour in §3.1 possible.

### 3.1 PID 1, signals, and `docker stop`

A container's PID 1 receives **no default signal handlers** from the kernel. The consequence (`verification/03-sigterm-timing.txt`):

```
--- CASE A: PID 1 with NO SIGTERM handler ---
$ docker run -d --name day3-nosig day3-hello:single node -e "setInterval(()=>{},1e9)"
$ time docker stop day3-nosig
  real  10.49s          <- full ~10s grace period elapsed
  exit code 137         <- 137 = 128 + 9  (killed by SIGKILL)

--- CASE B: our server, WITH process.on('SIGTERM', ...) ---
$ docker run -d --name day3-sig day3-hello:single
$ time docker stop day3-sig
  real  0.50s           <- exits immediately on SIGTERM
  exit code 0           <- clean shutdown via process.exit(0)
  last log line: SIGTERM received, shutting down gracefully
```

`docker stop` sends `SIGTERM`, then waits a **10-second grace period** before `SIGKILL`. In **Case A** nothing catches the signal, so the stop takes the full ~10 s and the process is killed. In **Case B** the server's `process.on('SIGTERM', …)` handler closes the HTTP server and exits cleanly in **0.5 s**.

> **Exit-code convention.** A process killed by signal *N* reports exit code **128 + N**. Exit codes are one byte (0–255): 0–127 are a program's own exit status, and the `128` offset pushes signal-deaths into the 128–255 band so the two never collide. The signal numbers are OS constants (`kill -l` lists them): **9** is `SIGKILL`, **15** is `SIGTERM`. Hence **137 = 128 + 9** (SIGKILL) and **143 = 128 + 15** (SIGTERM).

### Notes and caveats

- **Bind to `0.0.0.0`, not `127.0.0.1`.** Inside the container, `127.0.0.1` is the container's *own* loopback namespace; a server bound there is unreachable through `-p` no matter what is published. The app binds `0.0.0.0` for this reason.
- **Alpine comes with `sh`, not `bash`.** `docker exec -it … bash` fails with "executable file not found"; use `sh`.

---

## 4. Multi-stage build and image-size reduction

### 4.1 The multi-stage Dockerfile

`Dockerfile.multi`:

```dockerfile
# ---- Stage 1: build (has the full toolchain) ----
FROM node:22 AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install                       # installs TypeScript (dev dependency)
COPY src ./src
RUN npm run build                     # tsc -> /app/dist

# ---- Stage 2: runtime (clean, minimal) ----
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist  # copy ONLY the compiled output
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
```

A **multi-stage build** uses more than one `FROM`. Each begins a new stage with its own filesystem. `COPY --from=builder` lifts *only* the named files out of an earlier stage; everything else in it — the compiler, the dev dependencies, the source, the npm cache — is **discarded** and never reaches the final image.

### 4.2 Measured sizes — before and after

Both images ship from the **same** `node:22-alpine` base, so the only thing that differs is the build strategy. That makes the comparison a clean isolation of what multi-stage alone does (`verification/04-image-size-table.txt`):

| Image | Runtime base | Build strategy | Size |
|---|---|---|---|
| `day3-hello:single` | `node:22-alpine` | single-stage | **220 MB** — before |
| `day3-hello:multi` | `node:22-alpine` | multi-stage | **163 MB** — after |

```
before  220 MB ──(multi-stage: discard tsc + dev deps + npm cache)──►  163 MB   saves ~57 MB
                                                                       ───────
                                                            220 MB → 163 MB  =  26% smaller
```

Because the base is identical on both sides, `docker history` (`verification/05-docker-history.txt`) shows the single difference between them:

```
# day3-hello:single — the install layer multi-stage removes
57.5MB    RUN npm install          <-- TypeScript + @types/node + npm cache

# day3-hello:multi — the app's entire contribution to the final image
1.23kB    COPY /app/dist ./dist    <-- only the compiled output crosses over
```

The single-stage image carries the 57.5 MB `npm install` layer even though the compiler is never used at runtime; the multi-stage image leaves it in the discarded builder and ships only the **1.23 kB** of compiled `dist/`. Its 163 MB is therefore essentially the `node:22-alpine` base itself — the 57 MB saved is exactly the build toolchain.

### 4.3 Advantage of multi-stage

From this exercise, multi-stage delivers:

1. **The build toolchain never ships.** The TypeScript compiler and dev dependencies stay in the builder stage. Measured here as the removed 57.5 MB `npm install` layer.
2. **A cleaner, reproducible boundary** — the runtime image doesn't carry redundant build-time state.

### 4.4 The trade-off

`node:22-alpine` already has no `bash` (§3); a *distroless* final stage would have **no shell at all**, so `docker exec … sh` fails outright — there is nothing to exec into. **Smaller image <-> harder to debug live.** For this reason the graceful-shutdown handling of §3.1 matters more on a minimal image: you cannot shell in to clean up a process that ignored `SIGTERM`.

---

## 5. Evidence index

| File | Contents |
|---|---|
| `verification/01-build-output.txt` | full BuildKit output of the single-stage build |
| `verification/02-logs-and-exec.txt` | `run`, `ps`, HTTP response, `logs`, `exec whoami/node -v`, no-bash |
| `verification/03-sigterm-timing.txt` | `docker stop` timing: 10.49 s/137 (no handler) vs 0.50 s/0 (handler) |
| `verification/04-image-size-table.txt` | the single-stage (220 MB) vs multi-stage (163 MB) comparison |
| `verification/05-docker-history.txt` | per-layer sizes; the 57.5 MB install layer vs the 1.23 kB dist copy |
| `verification/06-docker-desktop-images.png` | Docker Desktop → Images: `single` (220 MB, in use) and `multi` (163 MB) |
| `verification/07-docker-desktop-container.png` | Docker Desktop → Containers: the running container, `3000:3000`, Exec into `/app` |
| `verification/08-browser-hello.png` | browser at `localhost:3000` — the served response (`host 9a8c1e6fbcfd`) |

---

## 6. Command reference

| Command | Purpose |
|---|---|
| `docker build -t name:tag -f Dockerfile ./app` | build an image from a context directory |
| `docker run -d -p 3000:3000 --name n img` | create + start a container, publish a port |
| `docker ps` / `docker ps -a` | list running / all containers |
| `docker logs [-f] n` | container stdout/stderr |
| `docker exec -it n sh` | shell into a running container |
| `docker stop n` | SIGTERM, then SIGKILL after the grace period |
| `docker inspect n --format '{{.State.ExitCode}}'` | a stopped container's exit code |
| `docker images` | image sizes |
| `docker history img` | per-layer sizes and the instruction that made each |
| `docker rm -f n` / `docker rmi img` | remove a container / image |
