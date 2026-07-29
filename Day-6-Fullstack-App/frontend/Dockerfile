# Multi-stage build, taken one step further than Days 3-5: the runtime stage
# contains NO NODE AT ALL.
#
# A React app is not a running program — `npm run build` turns it into plain
# HTML/CSS/JS files. Those need a web server, not a JavaScript runtime. So the
# builder produces static files and then gets thrown away entirely, and the
# final image is nginx plus a folder of assets.
#
# Compare the two `docker images` sizes after building: this is the largest
# builder-vs-runtime gap in the whole week.

# ---- Stage 1: build the static bundle ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Vite writes the compiled bundle to /app/dist — hashed filenames, minified,
# tree-shaken. Nothing here is needed again after this line.
RUN npm run build

# ---- Stage 2: serve it ----
#
# BASE IMAGE AGE IS A SECURITY PROPERTY. This started as nginx:1.27-alpine,
# which Trivy scored at 37 HIGH/CRITICAL findings — including 2 CRITICALs in
# openssl (CVE-2026-31789, libcrypto3/libssl3 3.3.3-r0). None of them were
# nginx bugs; 1.27 is simply built on Alpine 3.21.3, and that base has aged.
#
# Measured across the candidate tags:
#   nginx:1.27-alpine   alpine 3.21.3   37  (35 HIGH, 2 CRITICAL)
#   nginx:1.29-alpine   alpine 3.23.4   13  (13 HIGH, 0 CRITICAL)
#   nginx:1.30-alpine   alpine 3.24.1    0
#   nginx:alpine        alpine 3.24.1    0   (mainline 1.31.x, floating tag)
#
# 1.30 is the stable branch, on the same Alpine 3.24.1 as node:22-alpine, and
# clean. Pinned to the MINOR rather than a floating tag, matching node:22-alpine
# and postgres:16-alpine — reproducible builds still matter.
#
# But note what just happened: the 1.27 pin was equally deliberate, and it
# rotted. A pin does not stop CVEs being discovered, it only stops you finding
# out. THE SCANNER IS THE PROCESS THAT TELLS YOU WHEN TO BUMP — which is the
# whole argument for having it in the pipeline rather than pinning and hoping.
FROM nginx:1.30-alpine

# The static bundle, into nginx's default document root.
COPY --from=builder /app/dist /usr/share/nginx/html

# Our server block replaces the image's default one. It does two jobs: serve the
# SPA, and reverse-proxy /api/* to the backend. See nginx.conf.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# The nginx image already sets an appropriate CMD (`nginx -g 'daemon off;'`),
# which keeps it in the foreground so Docker can supervise it.
