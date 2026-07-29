# Multi-stage build — Day 3's pattern, extended for a service that has real
# runtime dependencies (express, pg) rather than none.
#
# Stage 1 (builder) has the full toolchain: node:22 + TypeScript + every dev
# dependency. Stage 2 starts FROM a clean node:22-alpine and copies only the
# compiled dist/ plus production node_modules. The compiler, the dev
# dependencies, the source and the npm cache never exist in the final image.

# ---- Stage 1: build ----
FROM node:22 AS builder
WORKDIR /app

# Dependencies first so editing source does not invalidate the install layer.
# `npm ci` (not `npm install`) installs the EXACT tree in package-lock.json and
# fails if the lock and package.json disagree — the reproducibility a pipeline
# needs. `npm install` would silently resolve new versions on every run.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:22-alpine
WORKDIR /app

# Unlike Day 3 (which had zero dependencies), this service needs express and pg
# at runtime. `--omit=dev` skips typescript, eslint and the type packages, which
# are build-time only. Same move as Day 4's runtime stage.
#
# ...and then npm itself is deleted. npm is a BUILD tool: `CMD ["node", ...]`
# never invokes it and the healthcheck is `node -e`. Leaving it in the image
# ships its ~200 bundled dependencies as runtime attack surface for no benefit.
#
# This is not housekeeping — it is the difference between a clean scan and a
# failing one. Trivy found CVE-2026-59873 (CRITICAL, node-tar gzip bomb) in
# usr/local/lib/node_modules/npm/node_modules/tar, plus three HIGHs in npm's
# brace-expansion, picomatch and sigstore. Every one of them arrived with npm,
# not with this application: `npm audit` on the production tree reports 0
# vulnerabilities, because it reads OUR dependency tree while Trivy reads the
# whole image.
#
# MEASURED RESULT: 167 MB -> 166.86 MB. Essentially nothing, and that is worth
# understanding rather than glossing over.
#
# npm arrives in the node:22-alpine BASE LAYER, not in the layer created by
# `npm ci` above. Layers are additive and immutable: a `rm -rf` can never
# reclaim bytes from a layer beneath it, it only writes "whiteout" entries that
# hide those paths. The npm files are still inside the base layer blob and are
# still pushed and pulled with the image.
#
# So what did this actually buy?
#   - The FLATTENED filesystem no longer contains npm. That is what a running
#     container sees, so nothing at runtime can execute it.
#   - It is also what Trivy scans, which is why the CRITICAL disappeared:
#     zero HIGH/CRITICAL findings after this change, four before.
#   - It did NOT reduce image size, and it did not remove the bytes from the
#     layer blob. Genuinely deleting them needs a base image that never had
#     npm — distroless, or copying just the node binary into a scratch stage.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/lib/node_modules/corepack \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
              /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=builder /app/dist ./dist

ENV PORT=3000
EXPOSE 3000

# Run as an unprivileged user (the node image ships a 'node' user).
USER node

# Exec form: node becomes PID 1 directly and receives signals itself, so the
# SIGTERM handler in server.ts actually fires.
CMD ["node", "dist/server.js"]
