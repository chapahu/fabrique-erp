import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy : en développement, les appels à /api sont transmis à l'API (port 3000).
    // Le navigateur croit parler à un seul serveur : pas de problème de CORS.
    proxy: { "/api": "http://localhost:3000" },
  },
});
