import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // 開發時 API 與客戶分享頁都轉給 Node API
    proxy: { "/api": api, "/s/": api },
  },
});
