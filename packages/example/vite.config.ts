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
    alias: [
      {
        find: "@file-ud.js/core/uploader",
        replacement: path.resolve(__dirname, "../core/src/uploader/index.ts"),
      },
      {
        find: "@file-ud.js/core/downloader",
        replacement: path.resolve(__dirname, "../core/src/downloader/index.ts"),
      },
      {
        find: "@file-ud.js/core/utils",
        replacement: path.resolve(__dirname, "../core/src/utils/index.ts"),
      },
      {
        find: "@file-ud.js/core",
        replacement: path.resolve(__dirname, "../core/src/index.ts"),
      },
      {
        find: "@file-ud.js/plugins/uploader",
        replacement: path.resolve(__dirname, "../plugins/src/uploader/index.ts"),
      },
      {
        find: "@file-ud.js/plugins/downloader",
        replacement: path.resolve(
          __dirname,
          "../plugins/src/downloader/index.ts",
        ),
      },
      {
        find: "@file-ud.js/plugins/retry",
        replacement: path.resolve(__dirname, "../plugins/src/retry/index.ts"),
      },
      {
        find: "@file-ud.js/plugins",
        replacement: path.resolve(__dirname, "../plugins/src/index.ts"),
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
    ],
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
