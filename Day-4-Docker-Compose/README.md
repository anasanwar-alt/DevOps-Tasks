# Training Day 4 — Docker Compose

> This submission extends Day 3's Node.js app with a **PostgreSQL** database and runs both
> together with **Docker Compose**. The app reads from and writes to the database on every
> request; the stack has healthchecks, a startup dependency, a named volume for the data, and a
> restart policy. Every number and log excerpt below is real output, captured to `verification/`.

---

## 1. Environment

| Item | Value |
|---|---|
| Docker / Compose | Docker 27.1.1, Compose v2 (Docker Desktop, WSL2 backend) |
| App image | Day 3's multi-stage build (`node:22` builder → `node:22-alpine` runtime), now with `pg` as a runtime dependency |
| Database | `postgres:16-alpine` |
| Project name | `day4` (containers `day4-app-1`, `day4-db-1`) |

---

## 2. The stack — `docker-compose.yml`

The whole deliverable is one file describing **two services** and how they fit together:

```yaml
name: day4

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data       # data survives container removal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 5s
    restart: unless-stopped

  app:
    build: ./app
    environment:
      PGHOST: db            # the app reaches the DB by service name, not an IP
      PGPORT: "5432"
      PGUSER: ${POSTGRES_USER}
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: ${POSTGRES_DB}
      PORT: "3000"
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy   # wait until the DB is READY, not just started
    healthcheck:
      # Node is guaranteed present (it's a node image); no curl/wget dependency.
      test:
        - "CMD"
        - "node"
        - "-e"
        - "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s
    restart: unless-stopped

volumes:
  pgdata:
```

Reading it:

- **`services`** — two containers, `db` and `app`, that Compose starts and wires together.
- **`environment` + `${...}`** — values come from a `.env` file next to the compose file, so no
  passwords are hard-coded in the YAML. Compose substitutes them at load time.
- **`ports: "3000:3000"`** — publishes the app to the host. The database has **no** published
  port; only the app (on the internal network) can reach it.
- **`volumes: pgdata`** — a named volume holding the database's files (see §5).
- **`depends_on ... condition: service_healthy`** — startup ordering (see §4).
- **`healthcheck`** — how Compose decides each service is "healthy" (see §6).
- **`restart: unless-stopped`** — automatic recovery (see §7).

The app addresses the database as the hostname **`db`** — Compose creates a private network for
the project and provides DNS, so the service name resolves to the database container. No IP
addresses anywhere.

---

## 3. The app change — reading and writing the database

Day 3's app just said hello. Day 4's app (`app/src/server.ts`) does a real round-trip to
Postgres on every request:

- On startup it ensures a `visits` table exists (`CREATE TABLE IF NOT EXISTS`), retrying until
  the database is reachable.
- Each `GET /` **inserts** one row and **reads back** the running total, returning e.g.
  *"Hello from … — this app has recorded 7 visit(s) in Postgres"*.
- `GET /health` runs a trivial `SELECT 1` — used by the healthcheck to confirm the app can
  actually reach the DB.

Connection details are read from the `PG*` environment variables (injected by Compose), so the
image contains **no** hard-coded host, user, or password.

---

## 4. Startup ordering — `depends_on` + healthcheck

Bringing the stack up (`verification/02-stack-up-healthy.txt`):

```
$ docker compose ps
NAME         IMAGE                SERVICE   STATUS         PORTS
day4-app-1   day4-app             app       Up (healthy)   0.0.0.0:3000->3000/tcp
day4-db-1    postgres:16-alpine   db        Up (healthy)   5432/tcp

$ docker compose logs app | head -2
db ready — schema ensured (attempt 1)
listening on http://0.0.0.0:3000 (pid 1)
```

The app reached the database on its **first attempt** — no retries — because
`depends_on: condition: service_healthy` held the app back until the database's healthcheck
passed.

> **Caveat — `depends_on` alone is not enough.** A plain `depends_on: [db]` only waits for the
> database *container to start*, not for Postgres to be *ready to accept connections*. The app
> would then race the database and fail its first queries. `condition: service_healthy` is what
> makes the wait meaningful, and it only works because the `db` service defines a healthcheck.

---

## 5. The app talks to the database — evidence

Each request writes and reads (`verification/03-app-db-roundtrip.txt`):

```
$ curl http://localhost:3000/    (called 3 times)
Hello from 642dc419d5eb — this app has recorded 5 visit(s) in Postgres
Hello from 642dc419d5eb — this app has recorded 6 visit(s) in Postgres
Hello from 642dc419d5eb — this app has recorded 7 visit(s) in Postgres
```

The rows are really in Postgres — confirmed by querying the database directly
(`verification/04-data-in-postgres.txt`):

```
$ docker compose exec db psql -U appuser -d appdb -c "SELECT id, seen_at, host FROM visits ORDER BY id;"
 id |            seen_at            |     host
----+-------------------------------+--------------
  1 | 2026-07-24 12:00:57.986581+00 | 642dc419d5eb
  2 | 2026-07-24 12:00:58.09267+00  | 642dc419d5eb
  ...
```

Also visible in a browser (`verification/08-browser-visits.png`) and in Docker Desktop's Containers
view showing both services running together (`verification/07-compose-containers.png`).

---

## 6. Named volume — the data persists

The database's files live in the named volume `day4_pgdata`
(`verification/09-volume.png` shows its contents). Because the data is in the volume rather than the
container, it survives the containers being destroyed and recreated
(`verification/05-volume-persistence.txt`):

```
Total BEFORE restart:
Hello from 642dc419d5eb — this app has recorded 10 visit(s) in Postgres

$ docker compose down     (removes both containers and the network; keeps the data volume)
$ docker compose up -d    (recreate everything from scratch)

Total AFTER a full restart -- it continues instead of resetting to 1, so the data survived:
Hello from 0bf3e643e10c — this app has recorded 11 visit(s) in Postgres
```

Note the app's hostname **changed** (`642dc419d5eb` → `0bf3e643e10c`): a brand-new container,
yet the count continued from 10 to 11. The data was never in the container.

> `docker compose down` keeps named volumes. `docker compose down -v` would **delete** them —
> that is the command that wipes the database.

---

## 7. Healthchecks

Each service reports "healthy" only when a probe succeeds:

- **db** — `pg_isready`, which ships with the Postgres image, checks the server is accepting
  connections. (`$$` in the compose file escapes Compose's own variable substitution so the
  shell inside the container expands `$POSTGRES_USER` itself.)
- **app** — a tiny inline Node script requests `/health` and exits 0 on HTTP 200. Node is used
  deliberately: the `node:22-alpine` image has **no `curl` or `wget`** guaranteed, but it always
  has `node`.

The `(healthy)` status in `docker compose ps` (§4) is these probes passing.

---

## 8. Restart policy — and two gotchas worth knowing

`restart: unless-stopped` tells Docker to bring a container back automatically if its process
exits on its own. Demonstrated in `verification/06-restart-policy.txt`:

```
Start time BEFORE:   2026-07-24T12:23:28Z
$ docker exec day4-app-1 kill -TERM 1      (tell the app process to stop)
Start time AFTER:    2026-07-24T12:23:41Z   <- later = Docker started a fresh run
$ docker compose ps app                     -> Up 10 seconds (healthy)
$ docker compose logs app | grep -c "listening on"
2                                            <- app started twice in one container
```

Getting this demonstration right surfaced two genuine gotchas:

> **Gotcha 1 — `docker stop` / `docker kill` do NOT trigger the restart policy.** Docker treats
> those as *you* deliberately stopping the container, so `unless-stopped` intentionally leaves it
> down. The policy only acts when the container's process ends *on its own*. Our first attempt
> used `docker kill` and the container stayed dead — correctly.

> **Gotcha 2 — `kill -9 1` from inside the container is silently ignored.** PID 1 (the app) only
> receives a signal from within its own container if it has a *handler* for that signal. `SIGKILL`
> (`kill -9`) can never have a handler, so it is not delivered to PID 1 — the process doesn't die,
> and nothing restarts. We instead send **`SIGTERM`** (`kill -TERM 1`), which the app *does*
> handle (its graceful-shutdown code from Day 3); the app exits cleanly and Docker starts a fresh
> run. This is the same PID-1 signal rule from Day 3, seen from the other side.

> **Note — `RestartCount` was unreliable here.** In Docker Desktop, `docker inspect`'s
> `RestartCount` stayed `0` even after a genuine policy restart. The trustworthy signal is
> `StartedAt` advancing (and a second startup in the logs), which is what the evidence uses.

---

## 9. Caveats and lessons (consolidated)

1. **`depends_on` waits for *start*, not *readiness*.** Add `condition: service_healthy` (and a
   healthcheck on the dependency) or the app races the database.
2. **`docker stop`/`docker kill` are exempt from the restart policy** — only an unexpected exit
   is restarted.
3. **`kill -9 1` inside a container does nothing** — PID 1 only gets signals it has a handler for;
   use a handled signal (or a real crash) to test restart behaviour.
4. **Named volumes persist across `compose down`; `compose down -v` deletes them.**
5. **The database publishes no host port** — only the app (on the project's private network) can
   reach it. Smaller attack surface.
6. **Alpine has no `curl`/`wget` guaranteed** — the app healthcheck uses `node` instead.
7. **Secrets in `.env`** are fine for a lab but must be kept out of version control. `.env` is
   git-ignored; `.env.example` is committed in its place so the stack stays reproducible
   (`cp .env.example .env`). A real project would inject these from a secrets manager.
8. **The app hard-codes no connection details** — everything comes from environment variables, so
   the same image runs against any database.

---

## 10. Evidence index

| File | Contents |
|---|---|
| `verification/01-compose-config.txt` | the full resolved Compose configuration (after `.env` substitution) |
| `verification/02-stack-up-healthy.txt` | both services `healthy`; the app reaching the DB on its first try |
| `verification/03-app-db-roundtrip.txt` | the visit count climbing as each request writes + reads the DB |
| `verification/04-data-in-postgres.txt` | the saved rows, seen directly inside Postgres |
| `verification/05-volume-persistence.txt` | the count surviving a full `down`/`up` (named volume) |
| `verification/06-restart-policy.txt` | the app auto-restarting after its process exits |
| `verification/07-compose-containers.png` | Docker Desktop: the `day4` group, both services running |
| `verification/08-browser-visits.png` | browser at `localhost:3000` showing the DB-backed count |
| `verification/09-volume.png` | Docker Desktop: the `day4_pgdata` volume holding the database files |

---

## 11. Command reference

| Command | Purpose |
|---|---|
| `docker compose up -d --build` | build images and start the whole stack in the background |
| `docker compose ps` | list the stack's services and their health |
| `docker compose logs [-f] <svc>` | view a service's logs |
| `docker compose exec <svc> <cmd>` | run a command inside a running service (e.g. `psql`) |
| `docker compose config` | show the final configuration after `.env` substitution |
| `docker compose down` | stop and remove containers + network (keeps named volumes) |
| `docker compose down -v` | as above, and **delete** named volumes (wipes the data) |
| `docker compose restart <svc>` | restart one service |
