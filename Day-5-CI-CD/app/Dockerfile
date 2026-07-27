# Multi-stage build, carried over from Day 3 and hardened for CI.
#
# Stage 1 (builder) has the full toolchain: node:22 + the TypeScript compiler.
# Stage 2 (runtime) starts FROM a clean node:22-alpine and copies ONLY the
# compiled dist/. The compiler, the dev dependencies, the source and the npm
# cache never exist in the final image.

# ---- Stage 1: build ----
FROM node:22 AS builder
WORKDIR /app

# Dependencies first so editing source does not invalidate the install layer.
# `npm ci` (not `npm install`) installs the EXACT tree in package-lock.json and
# fails if the lock and package.json disagree — the reproducibility a pipeline
# needs. `npm install` would silently resolve new versions on every run.
COPY package.json package-lock.json tsconfig.json tsconfig.test.json ./
RUN npm ci

COPY src ./src
# tsconfig.json excludes *.test.ts, so no test code lands in dist/.
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist ./dist

ENV PORT=3000
EXPOSE 3000

# Run as an unprivileged user (the node image ships a 'node' user).
USER node

# Exec form: node becomes PID 1 directly and receives signals itself.
CMD ["node", "dist/server.js"]