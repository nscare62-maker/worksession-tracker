import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/auth": "http://localhost:4000",
      "/sessions": "http://localhost:4000",
      "/locations": "http://localhost:4000",
      "/manager": "http://localhost:4000",
      "/tasks": "http://localhost:4000",
      "/activity": "http://localhost:4000",
    },
  },
});
