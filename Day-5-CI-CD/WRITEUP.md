# Training Day 5 — CI/CD: a local registry and a first pipeline

> This submission runs a **private Docker registry** locally, proves an image round-trips through
> it, and drives a **GitHub Actions pipeline** that builds the image and pushes it to that registry
> **on every commit** — executed entirely locally with [`act`](https://github.com/nektos/act), no
> cloud runner. Every number and log excerpt below is real output, captured to `evidence/`.

| Task item | Status |
|---|---|
| 1. Run a local registry (`registry:2` on port 5000) | ✅ |
| 2. Tag + push the Day 3 image, pull it back to confirm the round-trip | ✅ |
| 3. Minimal pipeline that builds and pushes on every commit | ✅ two commits, two runs, both green |

---

## 1. Environment

| Item | Value |
|---|---|
| Docker | 27.1.1 (Docker Desktop, WSL2 backend) |
| Shell | WSL Ubuntu 22.04, bash 5.1 — everything below was run from Linux |
| Registry | `registry:2`, published on `0.0.0.0:5000` |
| CI tool | GitHub Actions workflow, executed locally by `act` 0.2.89 |
| Runner image | `catthehacker/ubuntu:act-latest` |
| App | Day 3's Node/TypeScript server, multi-stage `Dockerfile` |

---

## 2. The registry

```bash
docker run -d -p 5000:5000 --name registry --restart unless-stopped registry:2
```

`registry:2` is the **Distribution** project — the same open-source codebase behind Docker Hub,
GHCR and ECR. It is a plain HTTP server with a handful of endpoints:

| Endpoint | Meaning |
|---|---|
| `GET /v2/` | "do you speak the registry API?" — the handshake Docker performs first |
| `GET /v2/_catalog` | list repositories |
| `GET /v2/<name>/tags/list` | list a repository's tags |
| `GET /v2/<name>/manifests/<tag>` | the manifest: a JSON list of layer digests + config |
| `GET /v2/<name>/blobs/<digest>` | one layer, addressed by its SHA-256 |

`docker push` uploads each layer blob — skipping any the registry already has, matched by digest —
then the manifest tying them together. `docker pull` walks the same list in reverse.

---

## 3. An image name is an address

Every reference normalises to `<registry-host>[:port]/<namespace>/<repo>:<tag>`, with defaults
filled in silently: host → `docker.io`, namespace → `library`, tag → `latest`. So `day3-hello:multi`
actually means **`docker.io/library/day3-hello:multi`**.

Docker decides whether the first path segment is a registry host by one test:

> does it contain a **`.`** or a **`:`**, or is it exactly **`localhost`**?

| Reference | Routes to |
|---|---|
| `localhost:5000/day3-hello` | the local registry ✅ |
| `registry.example.com/team/app` | that host ✅ |
| `myregistry/day3-hello` | **Docker Hub user `myregistry`** 💥 |

> **Why this is invisible until your first push.** `docker build` and `docker run` never resolve
> the name — the image is already on disk, so the name acts as a local label. `docker push` is the
> first command that treats it as a routing decision. That is why the naming rule ambushes people
> exactly once.

**Consequence:** there is no `--registry` flag on `docker push`. The destination lives *inside* the
image name, so retargeting a registry is always done by **re-tagging**.

---

## 4. The round-trip — `evidence/01`, `evidence/02`

`docker tag` copies nothing:

```
REPOSITORY                  TAG     IMAGE ID       SIZE
day3-hello                  multi   c9d21ea14523   163MB
localhost:5000/day3-hello   multi   c9d21ea14523   163MB   <- same ID
```

One image, two pointers. `docker images` prints one row per *pointer*, which is why SIZE appears to
double-count.

Anyone can claim a push worked; the only proof is destroying every local copy and getting it back:

```
digest BEFORE:  sha256:c9d21ea1452364dabb94a46df00d2199216b5f629ad57c74370b423e35572581

$ docker rmi day3-hello:multi localhost:5000/day3-hello:multi
Untagged: day3-hello:multi
Untagged: localhost:5000/day3-hello:multi
Untagged: localhost:5000/day3-hello@sha256:421f228b05767b0e07af020589c95af4ea48a0d455e05908eb63d7ba4d15b664
Deleted:  sha256:c9d21ea1452364dabb...        <- the image really left the disk

$ docker pull localhost:5000/day3-hello:multi
Digest: sha256:421f228b05767b0e07af020589c95af4ea48a0d455e05908eb63d7ba4d15b664

digest AFTER:   sha256:c9d21ea1452364dabb94a46df00d2199216b5f629ad57c74370b423e35572581
```

**Identical digest.** The registry returned the exact bytes that were pushed. The recovered image
then ran and served a request (`evidence/02`).

> **Both tags had to go.** Deleting a tag deletes a pointer; Docker only evicts the image when the
> *last* pointer disappears. Removing one would have left the image on disk and made the pull a
> silent no-op — the proof would have been fake.

> **Three `Untagged`, one `Deleted`.** The third is a **RepoDigest** (`name@sha256:…`), recorded
> automatically once an image has been pushed or pulled. It is the immutable form — unlike `:multi`,
> which someone can repoint at different bytes tomorrow. That is what you pin to in production.

---

## 5. The pipeline — `.github/workflows/ci.yml`

The deliverable is *"builds the image and pushes it to the local registry on every commit"*, so the
workflow is deliberately minimal: one job, five steps.

```yaml
name: CI

on:
  push:
    branches: [main, Day-5-CI-CD-Docker-Registry-Fundamentals]
  workflow_dispatch:

env:
  REGISTRY: localhost:5000
  IMAGE_NAME: day5-app
  APP_DIR: app

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Compute image tags
        id: tags
        run: |
          SHA_TAG="$(echo "${GITHUB_SHA}" | cut -c1-7)"
          echo "sha_tag=${SHA_TAG}"              >> "$GITHUB_OUTPUT"
          echo "image=${REGISTRY}/${IMAGE_NAME}" >> "$GITHUB_OUTPUT"

      - name: Build the image
        working-directory: ${{ env.APP_DIR }}
        run: |
          docker build \
            -t "${{ steps.tags.outputs.image }}:${{ steps.tags.outputs.sha_tag }}" \
            -t "${{ steps.tags.outputs.image }}:latest" .

      - name: Push to the local registry
        run: |
          docker push "${{ steps.tags.outputs.image }}:${{ steps.tags.outputs.sha_tag }}"
          docker push "${{ steps.tags.outputs.image }}:latest"

      - name: Verify it landed in the registry
        run: |
          curl -sf "http://${REGISTRY}/v2/_catalog"; echo
          curl -sf "http://${REGISTRY}/v2/${IMAGE_NAME}/tags/list"; echo
```

Reading it:

- **`on: push`** — the single line that makes this a pipeline rather than a script. Nobody runs it
  by hand. `workflow_dispatch` additionally gives a manual trigger.
- **`jobs`** — one job. Each job gets a fresh machine and shares nothing with any other.
- **`steps`** — `uses:` pulls in a reusable action from another repo (`actions/checkout` puts your
  code on the runner; without it the machine is empty). `run:` executes shell.
- **`$GITHUB_OUTPUT`** — how a step publishes a value for later steps to read as
  `steps.<id>.outputs.<name>`.
- **Two `-t` flags, one build.** A tag is only a pointer, so the second costs nothing.
- **The commit SHA is the tag.** This is the point of tagging in CI: the tag names the exact source
  revision the image was built from, so any running container traces back to a commit. `latest` is
  a moving convenience pointer on top — never deploy by `latest` alone.

---

## 6. Running it locally — `act`

```bash
act push 2>&1 | tee evidence/04-act-run.txt
```

`act` reads the same YAML GitHub would and executes it locally. Where GitHub gives
`runs-on: ubuntu-latest` a **fresh VM**, act substitutes a **container**:

| | GitHub | act |
|---|---|---|
| machine per job | VM | container |
| image | GitHub's runner image (~30GB) | `catthehacker/ubuntu:act-latest` (~1.2GB) |
| lifetime | destroyed after the job | destroyed after the job |

Same contract, implemented with what a laptop can start in seconds. The `-P` line in `.actrc` is
what maps the label to the image.

First run, all green (`evidence/04`):

```
[CI/build-and-push] 🚀  Start image=catthehacker/ubuntu:act-latest
[CI/build-and-push] ⭐ Run Main actions/checkout@v4
[CI/build-and-push]   ✅  Success - Main actions/checkout@v4 [15.317929709s]
[CI/build-and-push]   | Will build localhost:5000/day5-app:63794af
[CI/build-and-push]   | #15 naming to localhost:5000/day5-app:63794af done
[CI/build-and-push]   | #15 naming to localhost:5000/day5-app:latest done
[CI/build-and-push]   ✅  Success - Main Build the image [44.475638518s]
[CI/build-and-push]   | 63794af: digest: sha256:c1d210ccb64eac6943e1337ad5c1ce068c222576b9fa7c304dc9fff003550398 size: 1572
[CI/build-and-push]   ✅  Success - Main Push to the local registry [705.013329ms]
[CI/build-and-push]   | {"repositories":["day3-hello","day5-app"]}
[CI/build-and-push]   | {"name":"day5-app","tags":["63794af","latest"]}
[CI/build-and-push] 🏁  Job succeeded
```

`Will build …:63794af` matching `git log` is the proof that `GITHUB_SHA` resolved — which is why
the workflow needs a real git repository, not just a folder.

---

## 7. "On every commit" — two commits, two artifacts

A second commit was made and the pipeline re-run (`evidence/05`):

```
$ git commit --allow-empty -m "Trigger for workflow"

[CI/build-and-push]   | Will build localhost:5000/day5-app:cc9c2e2       <- different tag
[CI/build-and-push]   ✅  Success - Main Push to the local registry [230.0488ms]
[CI/build-and-push]   | {"name":"day5-app","tags":["63794af","latest","cc9c2e2"]}
[CI/build-and-push] 🏁  Job succeeded
```

Each commit leaves a distinct, immutable tag; `latest` moves to the newest.

> **A detail worth reading carefully.** The second commit was `--allow-empty` — identical source.
> Asking the registry for each tag's manifest digest:
>
> ```
> 63794af -> sha256:c1d210ccb64eac6943e1337ad5c1ce068c222576b9fa7c304dc9fff003550398
> cc9c2e2 -> sha256:c1d210ccb64eac6943e1337ad5c1ce068c222576b9fa7c304dc9fff003550398
> latest  -> sha256:c1d210ccb64eac6943e1337ad5c1ce068c222576b9fa7c304dc9fff003550398
> ```
>
> **All three are the same image.** Identical input produced identical output, so the registry
> stored one object and added tag pointers to it. That is why the second push took **230ms** versus
> the first one's **705ms** — there was nothing new to upload. Reproducible builds and
> content-addressed storage, visible in one number.

---

## 8. Where a `docker` command actually runs

The most instructive part of the day. The `docker push` step executes **inside** the runner
container, where `localhost` is that container's own loopback — and the registry is not on it. It
worked anyway:

```
Host Docker daemon
├── runner container            ← act creates this to emulate ubuntu-latest
│     └── your steps run here; the `docker` CLI talks BACK to the host daemon
│         through a mounted socket
└── registry container (registry:2)   ← published on the host's port 5000
```

`act` mounts the host's Docker socket into the runner, so the CLI in the container is only a
client — the **host's daemon** performs the build and the push, and resolves `localhost:5000` in
*its* namespace, where the published port lives.

> **The rule: `docker` commands take effect wherever the daemon is, not where you typed them.**
> A visible consequence — after the run, `docker images` on the host shows `localhost:5000/day5-app`
> sitting next to the Day 3 images. On real GitHub the runner VM has its *own* daemon and that image
> would evaporate with the VM, which is exactly why a pipeline must push it somewhere to survive.
> That is what a registry is *for*.

> **Had the socket not been mounted**, `localhost:5000` would have failed and the fix would be
> `host.docker.internal:5000` **plus** an `insecure-registries` entry in the daemon config — because
> Docker permits plain HTTP only for `localhost` and `127.0.0.1`.

---

## 9. Caveats and lessons

1. **A name is an address.** `build` and `run` never resolve it; `push` is the first command that
   does — which is why the naming rule is invisible until your first push.
2. **No `--registry` flag exists.** Retargeting a registry means re-tagging.
3. **A tag is a pointer.** Remove *all* tags or the image stays on disk.
4. **`localhost` is Docker's only hard-coded plain-HTTP exemption.** Any other hostname for the same
   registry is refused until listed in `insecure-registries`.
5. **A pipeline needs a real git repo**, not just a folder — `GITHUB_SHA` comes from it, and here
   the SHA *is* the image tag.
6. **`act` is a smaller machine than GitHub's runner** (1.2GB vs ~30GB). A step relying on a
   preinstalled tool can pass on GitHub and fail locally with `command not found`. That is act's
   main fidelity caveat, not a bug in the workflow.
7. **`docker images --filter reference=` uses path-aware globbing** — `*` never crosses a `/`, so
   `*day3-hello*` will not match `localhost:5000/day3-hello`. Repeated `--filter` flags are OR'd.
8. **Layers reporting "Already exists" is deduplication working**, not a failed transfer — blobs are
   addressed by hash and never sent twice.
9. **This registry has no volume, no TLS and no auth.** Removing the container wipes it, and anyone
   who can reach port 5000 can push to it. Fine for a lab; a real one needs all three.
10. **Scope note:** the task asked for a *minimal* pipeline that builds and pushes on every commit,
    so that is all this one does. A fuller pipeline would add `lint` and `test` as earlier jobs
    chained with `needs:` — cheapest checks first, so a style error fails in seconds instead of
    after a three-minute image build — and a `deploy` job that pulls the pushed image and runs it.
    The registry is what would hand the artifact from `push` to `deploy`.

---

## 10. Evidence index

| File | Contents |
|---|---|
| `evidence/01-registry-roundtrip.txt` | fresh registry → tag → push → API check → delete both tags → pull back → digest match |
| `evidence/02-pulled-image-runs.txt` | the recovered image running and serving a request |
| `evidence/04-act-run.txt` | **full first pipeline run** — build, push, registry verification, job succeeded |
| `evidence/05-act-run-second-commit.txt` | **second run on a new commit** — different SHA tag, three tags in the registry |
| `capture-evidence.sh` | regenerates 01–02 from scratch, so the evidence is reproducible |

Every transcript shows each command as `$ <command>` immediately above its own output, with a
header recording when and on which shell it was captured. All were captured from **WSL bash**, the
same platform a CI runner uses.

---

## 11. Command reference

| Command | Purpose |
|---|---|
| `docker run -d -p 5000:5000 --name registry registry:2` | start a local registry |
| `curl http://localhost:5000/v2/_catalog` | list its repositories |
| `curl http://localhost:5000/v2/<name>/tags/list` | list a repository's tags |
| `docker tag <src> localhost:5000/<name>:<tag>` | point a second name at an image |
| `docker push` / `docker pull localhost:5000/<name>:<tag>` | upload / download it |
| `docker image inspect --format '{{.Id}}' <ref>` | print an image's digest |
| `docker rmi <ref> [<ref>…]` | remove tags; the image goes when the last one does |
| `act --list` | list the jobs act can see, without running them |
| `act -n` | dry run — walk every step, execute nothing |
| `act push` | run everything triggered by `on: push` |
| `act -j <job>` | run a single job |