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
FROM nginx:1.27-alpine

# The static bundle, into nginx's default document root.
COPY --from=builder /app/dist /usr/share/nginx/html

# Our server block replaces the image's default one. It does two jobs: serve the
# SPA, and reverse-proxy /api/* to the backend. See nginx.conf.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# The nginx image already sets an appropriate CMD (`nginx -g 'daemon off;'`),
# which keeps it in the foreground so Docker can supervise it.
