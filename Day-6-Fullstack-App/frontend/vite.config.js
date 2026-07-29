import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  // The `server:` block affects `npm run dev` ONLY. It is not in the container
  // image — `npm run build` produces static files and nginx serves them there.
  server: {
    host: true,
    port: 5173,
    // A development-time mirror of what nginx.conf does in production. Both
    // exist so that src/api.js can use relative URLs like "/api/tasks" and work
    // unchanged in dev and in the container. Nothing in the React code ever
    // names a host or a port.
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
