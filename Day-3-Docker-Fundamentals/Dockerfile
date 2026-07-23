# Single-stage build on node:22-alpine.
#
# This is the "before" image: the app is built AND run in one image. The
# TypeScript compiler and dev dependencies that `npm install` pulls in stay
# in the final image even though they are only needed at build time.
# Dockerfile.multi fixes exactly that (see WRITEUP §5).

FROM node:22-alpine
WORKDIR /app

# Dependencies first, so editing source does not invalidate the install layer.
COPY package.json tsconfig.json ./
RUN npm install

# Then the source, then the build (tsc: src/*.ts -> dist/*.js).
COPY src ./src
RUN npm run build

ENV PORT=3000
EXPOSE 3000

# Run as an unprivileged user (the node image ships a 'node' user).
USER node

# Exec form: node becomes PID 1 directly and receives signals itself.
CMD ["node", "dist/server.js"]
