import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // host:true so a phone on the LAN can reach the dev server (Capacitor live reload).
    host: true,
    port: 5173,
  },
});
