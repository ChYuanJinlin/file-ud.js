import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    extensions: [
      ".mjs",
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
      ".less",
      ".css",
      ".html",
    ],
    alias: {
      "@": path.resolve(__dirname, "./src"), // 确保指向项目的 src 目录
    },
  },
  server: {
    open: false,
    cors: true,
    port: 6677,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
    hmr: {
      overlay: false,
    },
    host: "0.0.0.0",
  },
});
