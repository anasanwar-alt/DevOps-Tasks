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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

ENV PORT=3000
EXPOSE 3000

# Run as an unprivileged user (the node image ships a 'node' user).
USER node

# Exec form: node becomes PID 1 directly and receives signals itself, so the
# SIGTERM handler in server.ts actually fires.
CMD ["node", "dist/server.js"]
