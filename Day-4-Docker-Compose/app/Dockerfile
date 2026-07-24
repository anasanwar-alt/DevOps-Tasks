# Multi-stage build (carried over from Day 3, now with a real runtime dependency).
#
# Stage 1 compiles the TypeScript with the full node:22 toolchain.
# Stage 2 is a minimal node:22-alpine image that installs ONLY production
# dependencies (pg) and copies in the compiled output. The TypeScript compiler
# and dev dependencies never reach the final image.

# ---- Stage 1: build ----
FROM node:22 AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:22-alpine
WORKDIR /app

# Install production deps only (pg), then discard npm's cache.
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Bring in the compiled JS from the builder stage.
COPY --from=builder /app/dist ./dist

ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
