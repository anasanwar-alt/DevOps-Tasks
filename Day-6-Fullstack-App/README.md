# Training Day 6 — Full-Stack Capstone

> A three-tier task board — React in the browser, an Express REST API, and Postgres — each service
> in its own multi-stage image, orchestrated by one Compose file, and built and published by a
> pipeline that refuses to publish anything that does not lint and pass its tests.
>
> Almost nothing here is a new DevOps idea. Multi-stage builds came from Day 3, Compose with a
> healthchecked Postgres and a named volume from Day 4, and the local registry and GitHub Actions
> from Day 5. Day 6 is the recombination: two services instead of one, a quality gate in front of
> the build, and a reverse proxy that removes CORS from the problem entirely.
>
> Every number and log excerpt below is real output, captured to `evidence/`.

| Task item | Status |
|---|---|
| Express REST API, ≥3 endpoints, persisting to Postgres | ✅ 5 endpoints — see §4 |
| React frontend: list, create, delete | ✅ plus toggle-done — see §5 |
| Separate Dockerfile per service, multi-stage preferred | ✅ both multi-stage — see §6 |
| One compose file: frontend + backend + DB, networking, env vars, volume | ✅ see §7 |
| CI/CD: lint + test, build both images, push to local registry on commit | ✅ see §8 |
| README: architecture, setup, run from a clean clone | ✅ §2 and §3 |

---

## 1. Environment

| Item | Value |
|---|---|
| Docker Engine | 27.1.1, build 6312585 |
| Docker Compose | v2.29.1-desktop.1 |
| Node.js (host, for the local gate) | v22.19.0 |
| Backend runtime | `node:22-alpine`, Express 5, `pg` 8 |
| Frontend build | Vite 6, React 19 |
| Frontend runtime | `nginx:1.27-alpine` |
| Database | `postgres:16-alpine` |
| CI | GitHub Actions (the Day 5 choice), verified locally with `act` |

---

## 2. Architecture

```
                          ┌──────────────────────────────────────────┐
   host :8080  ───────────┤ frontend                                 │
                          │   nginx:1.27-alpine                      │
                          │                                          │
                          │   location /      → /usr/share/nginx/html│
                          │                     (React build output) │
                          │   location /api/  → proxy_pass ──────┐   │
                          └──────────────────────────────────────│───┘
                                                                 │
                                     compose network "day6_default"
                                                                 │
                          ┌──────────────────────────────────────▼───┐
   host :3000  ───────────┤ backend                                  │
   (debug only)           │   node:22-alpine + Express 5             │
                          │   GET/POST/PATCH/DELETE /api/tasks       │
                          │   GET /health                            │
                          └──────────────────┬───────────────────────┘
                                             │ PGHOST=db
                          ┌──────────────────▼───────────────────────┐
                          │ db                                       │
                          │   postgres:16-alpine                     │
                          │   /var/lib/postgresql/data ──► volume    │
                          └──────────────────┬───────────────────────┘
                                             │
                                    ┌────────▼────────┐
                                    │ volume: pgdata  │  survives `down`
                                    └─────────────────┘  dies on `down -v`
```

**The single most important line in that diagram is `location /api/ → proxy_pass`.**

The browser only ever talks to one origin: `http://localhost:8080`. A request for `/api/tasks` goes
to nginx, which forwards it *server-side* to `backend:3000`. As far as the browser is concerned
there is no cross-origin request to permit — so there is no `cors` package in the backend, no
`Access-Control-Allow-Origin` header anywhere, and no API base URL compiled into the JavaScript
bundle. `frontend/src/api.js` uses relative URLs only.

The alternative — publishing the backend on :3000 and having the browser call it directly — needs
CORS configuration, two published ports, and an environment-specific URL baked in at build time.
Proxying costs one `nginx.conf` and removes all three problems.

---

## 3. Running it from a clean clone

Requirements: Docker Engine with the Compose plugin. **Node is not required** — it only makes the
local quality gate available.

```bash
git clone git@github.com:anasanwar-alt/DevOps-Tasks.git
cd DevOps-Tasks/Day-6-Fullstack-App

cp .env.example .env          # compose reads .env automatically; it is gitignored
docker compose up -d --build

docker compose ps             # wait for all three to report (healthy)
```

Then open **<http://localhost:8080>**.

| URL | What it is |
|---|---|
| <http://localhost:8080> | the React app |
| <http://localhost:8080/api/tasks> | the API, through the nginx proxy |
| <http://localhost:8080/health> | backend liveness, through the proxy |
| <http://localhost:3000/api/tasks> | the API directly — debugging convenience only |

Shutting down:

```bash
docker compose down           # removes containers + network, KEEPS the data
docker compose down -v        # also deletes the pgdata volume — data is gone
```

Optional, if Node 22 is installed — the same commands CI runs:

```bash
(cd backend  && npm ci && npm run lint && npm test && npm run build)
(cd frontend && npm ci && npm run lint && npm run build)
```

---

## 4. The backend

Express 5 on Node 22, TypeScript, `pg` for Postgres. Five endpoints against a required minimum of
three.

| Method | Path | Behaviour | Failure |
|---|---|---|---|
| `GET` | `/health` | `SELECT 1` → `200 ok` | `503` if the DB is unreachable |
| `GET` | `/api/tasks` | all tasks, newest first | — |
| `POST` | `/api/tasks` | `{"title": "..."}` → `201` + the created row | `400` on a blank/missing/oversized title |
| `PATCH` | `/api/tasks/:id` | toggles `done` → `200` + the updated row | `404` if no such id |
| `DELETE` | `/api/tasks/:id` | `204 No Content` | `404` if no such id |

### 4.1 The database is a parameter, not an import

`createApp()` in `backend/src/app.ts` takes the database as an argument:

```ts
export function createApp(db: Db): Express { ... }
```

`server.ts` passes the real `pg` Pool. `app.test.ts` passes a three-line stub. That one decision is
why the CI quality gate needs no Postgres service container, no fixtures and no teardown — `npm test`
starts the HTTP layer on an ephemeral port and drives it with `fetch`, and it finishes in about a
second. It is the same app-factory split Day 5 introduced, used for the same reason.

The stub is only valid because **every route issues exactly one query**. `PATCH` in particular does
`SET done = NOT done` inside Postgres rather than reading the row and writing it back — one round
trip, and two concurrent clicks cannot both read the same stale value.

### 4.2 Tests

Node's built-in runner (`node --test`, stable since Node 20). No jest, no mocha, no supertest —
nothing extra to install, audit or keep current.

```
$ npm test
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

Twelve tests: six pure (title and id validation) and six driving real HTTP against a running server.

### 4.3 Why the two tsconfigs

`tsconfig.json` **excludes** `**/*.test.ts` and emits to `dist/` — that is what the Dockerfile copies
into the runtime image. `tsconfig.test.json` extends it, un-excludes the tests, and emits to
`dist-test/`. Test code therefore cannot reach a shipped image, and there is exactly one set of
compiler settings to keep in sync.

---

## 5. The frontend

Plain JavaScript React 19, built by Vite, in one component (`frontend/src/App.jsx`) plus a
four-function API module. No router, no state library, no optimistic updates — the app is the
smallest thing that demonstrates list / create / toggle / delete against a real API.

Every mutation re-fetches the list rather than patching a local array. That is one extra round trip
and it is the right trade here: the screen cannot drift from what is actually in Postgres, which is
precisely the thing this exercise needs to be able to demonstrate.

> **The React code contains no hostname, port, or API URL.** `api.js` requests `/api/tasks` —
> relative. In the container, nginx resolves that. In development, `vite.config.js` declares a proxy
> to `localhost:3000` so the *same* source works under `npm run dev`. Neither is compiled into the
> bundle, so the built image is environment-independent: it would work unchanged behind any hostname.

Build output, for scale:

```
dist/index.html                   0.55 kB │ gzip:  0.37 kB
dist/assets/index-D4GVQLRw.css    1.73 kB │ gzip:  0.75 kB
dist/assets/index-kXt5cM_y.js   196.47 kB │ gzip: 61.70 kB
```

~199 kB total, of which nearly all is React itself.

---

## 6. Containerization

Two Dockerfiles, one per service, both multi-stage.

| Image | Builder stage | Runtime stage | Final size |
|---|---|---|---|
| `day6-backend` | `node:22` (**1.13 GB**) | `node:22-alpine` + prod deps | **167 MB** |
| `day6-frontend` | `node:22-alpine` (163 MB) + ~200 MB of `node_modules` | `nginx:1.27-alpine` + 199 kB of static files | **48.4 MB** |

### 6.1 The frontend runtime image contains no Node at all

This is the point worth taking from Day 6, and it goes further than Days 3–5 did.

A React app is not a running program. `npm run build` turns it into plain HTML, CSS and JavaScript.
Those files need a *web server*, not a JavaScript runtime — the JavaScript runs in the visitor's
browser. So the builder stage installs Vite, React and ESLint, produces `dist/`, and is then
discarded in full. The final image is `nginx:1.27-alpine` plus 199 kB of assets: **48.4 MB**, versus
a builder stage well over 350 MB.

The backend's split is less dramatic but the same idea: the builder is full `node:22` (1.13 GB, it
needs the TypeScript compiler), while the runtime is `node:22-alpine` with `npm ci --omit=dev` — no
compiler, no ESLint, no type packages, no source, no npm cache. **167 MB**, a 6.8× reduction.

### 6.2 Details carried over from earlier days

- `npm ci`, not `npm install` — installs the exact tree in `package-lock.json` and fails if the lock
  and `package.json` disagree. `npm install` would silently resolve new versions on every build.
- Dependencies are copied and installed *before* the source, so editing a source file does not
  invalidate the install layer.
- `USER node` on the backend — the image ships an unprivileged user; use it.
- Exec-form `CMD` so node is PID 1 and receives SIGTERM itself (Day 3 §3.1).
- `.dockerignore` excludes `node_modules` in both services. This matters beyond context size: the
  frontend's builder does `COPY . .`, and without it a host `node_modules` built for Windows would
  be copied straight over the Linux one `npm ci` had just installed.

---

## 7. Orchestration

One `docker-compose.yml`, three services, one private network, one named volume.

### 7.1 Networking

Compose creates `day6_default` and gives every service a DNS name equal to its service name. That is
the entire mechanism behind two lines elsewhere in the project:

- `PGHOST: db` in the backend's environment
- `proxy_pass http://backend:3000` in `nginx.conf`

Only the frontend needs to be reachable from outside. The backend's published `3000:3000` is a
debugging and evidence-capture convenience — deleting that block changes nothing about how the
application works, because the browser never uses it.

### 7.2 Environment variables

No connection details are baked into any image. Postgres credentials live in `.env` (gitignored) and
are injected by Compose into both `db` and `backend`. `.env.example` is committed in its place, so
the repo documents *which* variables are required without publishing any values.

> **A missing `.env` does not fail loudly.** Compose warns
> `The "POSTGRES_USER" variable is not set. Defaulting to a blank string.` and then carries on to
> build. Read the warnings — the failure surfaces much later and looks like a credentials problem.

### 7.3 Startup ordering

Both `depends_on` blocks use `condition: service_healthy`, not the bare form. Day 4 established why
for the database. Day 6 adds a second, harder case:

> **nginx resolves `proxy_pass http://backend:3000` once, at startup, and exits if the name does not
> resolve.** With a literal hostname and no `resolver` directive, the lookup is not retried per
> request. So the frontend genuinely cannot start before the backend exists. This is Day 4's
> "started is not ready" lesson reappearing one layer up, with the same fix.

Startup is therefore strictly ordered: `db` healthy → `backend` healthy → `frontend`.

Healthchecks are chosen to use only what each image already contains — `pg_isready` in the postgres
image, a one-line `node -e` HTTP request in the backend (no curl in `node:alpine`), and busybox
`wget` in the nginx image (no curl there either).

### 7.4 Persistence

`pgdata:/var/lib/postgresql/data`, a named volume. The proof is the pair of behaviours, both captured
in `evidence/05-volume-persistence.txt`:

| Command | Containers | Volume | Data after `up` |
|---|---|---|---|
| `docker compose down` | removed | **kept** | still there |
| `docker compose down -v` | removed | **deleted** | empty |

Note that the second case does not crash the backend: `initDb()` runs
`CREATE TABLE IF NOT EXISTS` against the brand-new database and carries on.

---

## 8. CI/CD

`.github/workflows/ci-day6.yml`. GitHub Actions, the Day 5 choice, verified locally with `act`.

Day 5's pipeline built one image and pushed it. Day 6 adds a quality gate in front and a second
image behind it. **The registry mechanics underneath are unchanged** — same `services: registry:2`,
same wait-for-ready poll, same SHA tagging, same `/v2/_catalog` verification.

### 8.1 Two jobs

```
lint-and-test                     build-and-push
  strategy.matrix:                  needs: lint-and-test
    service: [backend, frontend]    services: registry:2 on :5000
  npm ci → lint → test → build      wait for /v2/ → compute SHA tag
                                    for svc in backend frontend: build, push :sha and :latest
                                    curl /v2/_catalog to verify
```

`strategy.matrix` runs `lint-and-test` once per value — two parallel jobs out of one block of YAML,
with `${{ matrix.service }}` naming the current one. `fail-fast: false` is set deliberately: without
it a backend failure would cancel the frontend job mid-run, and you would not learn whether the
frontend was broken too.

`npm test --if-present` lets one step serve both services. The backend has a `test` script; the
frontend does not, and a missing script is not a failure. The frontend's real gate is lint plus a
build that must compile.

The gate runs on the runner's Node directly, not in a container — lint and unit tests need no image,
so building one first would only be slower. `needs: lint-and-test` means nothing is built, let alone
published, unless both matrix legs pass.

### 8.2 Why the build step is a bash loop and not a second matrix

A matrix on `build-and-push` would give each leg **its own registry service container**. Each would
hold exactly one image, and no single `/v2/_catalog` would ever list both. For a step whose entire
purpose is to prove the push landed, that would be actively misleading. One job, one registry, both
images, one catalog that shows them together.

### 8.3 Tagging

Every image is pushed twice from a single build: `:<7-char commit SHA>` and `:latest`. Two `-t`
flags are two pointers to one image, so the second tag costs nothing. The SHA tag is the useful one
— it names the exact revision an image was built from, so a running container traces back to a
commit. `latest` is a moving pointer on top.

### 8.4 Two registries, one build

The task asks for the local registry, and that is what `localhost:5000` satisfies. But the
`services:` registry is created and destroyed with the job — it proves the pipeline works and then
leaves **nothing behind**. There is no artifact to pull, inspect, or point at once the run is over.

So the pipeline also publishes to **GHCR**, which is beyond the brief and is the half that produces
something durable:

| Registry | Lifetime | Purpose |
|---|---|---|
| `localhost:5000` | destroyed with the job | satisfies the task; proves the push mechanics |
| `ghcr.io/<owner>/devops-tasks/day6-<service>` | permanent | a real package you can `docker pull` |

**There is no second build.** One `docker build` per service carries four `-t` flags — two local
names and two GHCR names — because a tag is a pointer, not a copy. The GHCR push step transfers the
*same* image under a second name. The log makes this visible: the second push of any tag reports
`Layer already exists` for every layer and moves zero bytes.

Three GHCR naming traps, all inherited from Day 5 and handled in the `meta` step:

1. The path is **nested** — `ghcr.io/<owner>/<repo>/<image>` — so the package name is
   `devops-tasks/day6-backend`, a name containing a slash.
2. The **entire** reference must be lowercase. GitHub permits capitals in repo names
   (`DevOps-Tasks`); Docker references do not. Folded at runtime rather than hard-coded, so renaming
   or forking the repo does not silently break it.
3. That slash must be **URL-encoded as `%2F`** when the package name appears in a REST API path, or
   the API reads it as extra path segments and returns 404 — which looks exactly like "the package
   does not exist yet".

The `org.opencontainers.image.source` label is what links the published package back to this
repository. That link is not cosmetic: it is what grants the repo's `GITHUB_TOKEN` admin rights over
the package, and what makes the package page show its source.

> **GHCR packages are private by default.** The push will succeed and the package will not be
> publicly visible until its visibility is changed under Package settings. A 404 when pulling
> anonymously means private, not missing.

### 8.5 Running it locally with `act`

The GHCR login, push and verify steps carry `if: ${{ !env.ACT }}`. `act` sets `ACT=true`, and it has
no GHCR credentials, so those steps are skipped locally while the local-registry half still
exercises the entire pipeline. Run one workflow at a time — `act` executes every workflow matching
the event otherwise:

```bash
docker stop registry                                # frees :5000 for the services: container
act push -W .github/workflows/ci-day6.yml
```

---

## 9. Caveats and lessons

1. **`node --test <dir>` does not scan the directory.** Each positional argument is run as a test
   *file*, so `node --test dist-test/` tries to `require()` the folder and dies with
   `MODULE_NOT_FOUND`. The working form is a quoted glob: `node --test "dist-test/**/*.test.js"` —
   quoted so `sh` passes it through and **Node** expands it, because dash does not support `**`.
2. **Bare `node --test` is not a safe fallback either.** Node 22.18+ strips TypeScript types by
   default, so default discovery finds `src/app.test.ts` *in addition to* the compiled
   `dist-test/app.test.js` and fails on the raw source.
3. **`&&`-chaining `cd` is a trap.** `cd backend && … && cd ..` leaves you inside `backend/` when a
   middle command fails, and every subsequent command runs in the wrong directory. The failures that
   follow look unrelated — here, a missing `.env` that presented as a Postgres credentials warning.
   Use `(cd backend && …)` subshells.
4. **Compose walks up parent directories looking for a compose file.** Running `docker compose up`
   from `backend/` silently used the parent's `docker-compose.yml`. Convenient until it picks up a
   file you did not mean.
5. **`@types/express` 5 types `req.params.id` as `string | string[]`**, because a pattern like
   `/:id+` can match repeatedly. Worth handling rather than casting: `Number(["7"])` is `7`, since JS
   stringifies a one-element array first, so blind coercion would silently accept input the route was
   never meant to take. `parseId` takes `unknown` and guards on `typeof`.
6. **Suppressing a lint warning that never fires is itself a warning.** Flat config enables
   `reportUnusedDisableDirectives` by default, so a pre-emptive
   `// eslint-disable-next-line react-hooks/exhaustive-deps` became the only finding in the run.
7. **A React app has no server-side runtime.** The instinct to ship it on Node is wrong; `npm run
   build` produces files, and files need a file server. That instinct is what the 48.4 MB vs 350 MB+
   gap measures.
8. **A SPA needs `try_files $uri $uri/ /index.html`.** Without it, any path other than `/` returns
   404 for a file that was never meant to exist on disk — the app owns its own routing, so the server
   must hand it `index.html` and let it decide.
9. **The proxy is what removes CORS**, not a backend setting. Same-origin is a property of the
   deployment topology, not of the application code.
10. **The `services:` registry and a long-running host registry both want host port 5000.** Under
    `act`, `docker stop registry` first, or accept `Bind for 0.0.0.0:5000 failed: port is already
    allocated`. Carried over from Day 5 unchanged.
11. **`SELECT` without `ORDER BY` has no guaranteed order, and an `UPDATE` will prove it.** Reading
    the table directly with `SELECT * FROM tasks;` returned the rows in one order, and after toggling
    a row's `done` flag the *same* query returned them in a different one. Nothing sorted anything:
    Postgres returns rows in heap order, and under MVCC an `UPDATE` does not edit in place — it
    writes a new row version at the end of the table and marks the old one dead, so the updated row
    physically moved. `GET /api/tasks` is immune because it says `ORDER BY id DESC` explicitly.
    Captured in `evidence/04-api-crud.txt` §7.
12. **The local `npm install` is not redundant with the container build.** It generates the
    `package-lock.json` that `npm ci` requires and that has to be committed; and it turns a
    43-second failed `docker build` into a 3-second `tsc` error. The Dockerfile is for shipping, not
    for developing.

---

## 10. Evidence index

| File | Contents |
|---|---|
| `evidence/01-lint-test-build.txt` | ESLint, `node --test` and `tsc`/Vite builds for both services; proof that `dist/` contains no test code |
| `evidence/02-image-sizes.txt` | `docker images` for both services and their bases; `docker history` for the frontend |
| `evidence/03-compose-up-healthy.txt` | resolved `compose config`, all three services healthy, the compose network and its members, backend startup logs |
| `evidence/04-api-crud.txt` | full CRUD through the nginx proxy on :8080, SPA fallback, error cases (400/404), and the rows read directly out of Postgres |
| `evidence/05-volume-persistence.txt` | `down` → `up` (data survives) vs `down -v` → `up` (data gone) |
| `evidence/06-ci-act-run.txt` | complete `act push` run: gate, then both images built and pushed |
| `evidence/07-registry-contents.txt` | `/v2/_catalog` and per-repository tag lists showing both images |

Regenerate everything with `bash capture-evidence.sh` from this directory.

> **`capture-evidence.sh` runs `docker compose down -v`** as part of section 05. That destruction is
> the persistence proof — do not run it against data you want to keep.

---

## 11. Command reference

| Command | Purpose |
|---|---|
| `cp .env.example .env` | supply the Postgres credentials Compose interpolates |
| `docker compose config` | print the resolved file — catches unset variables before they bite |
| `docker compose up -d --build` | build both images and start all three services |
| `docker compose ps` | service status, including health |
| `docker compose logs -f backend` | follow one service's logs |
| `docker compose exec db psql -U day6 -d day6` | a SQL prompt inside the database container |
| `docker compose down` / `down -v` | stop, keeping / destroying the data volume |
| `npm run lint` / `npm test` / `npm run build` | the quality gate, identical to what CI runs |
| `npm run dev` (in `frontend/`) | Vite dev server with hot reload, proxying `/api` to :3000 |
| `curl -s localhost:5000/v2/_catalog` | what the local registry holds |
| `act push` | run the workflow locally against the host Docker daemon |
