import { defineConfig } from "vitepress";

// GitHub Pages 项目站点需要 base 路径（如 /repo-name/）
// 多版本部署时通过 VITE_BASE_PATH 环境变量指定（如 /file-ud.js/v0.08/）
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  title: "file-ud.js",
  description: "面向浏览器的文件上传下载 SDK，支持分片上传/下载、断点续传、秒传等功能",
  base,

  themeConfig: {
    nav: [
      { text: "指南", link: "/guide/getting-started" },
      { text: "API", link: "/api/uploader-config" },
      { text: "高级指南", link: "/advanced/" },
      {
        text: "插件",
        items: [
          { text: "概述", link: "/plugins/" },
          { text: "文件验证", link: "/plugins/validator" },
          { text: "图片压缩", link: "/plugins/compress" },
          { text: "水印", link: "/plugins/watermark" },
          { text: "智能重试", link: "/plugins/retry" },
        ],
      },
      {
        text: "相关链接",
        items: [
          { text: "GitHub", link: "https://github.com/ChYuanJinlin/file-ud.js" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "指南",
          items: [
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "本地示例", link: "/guide/example" },
            { text: "Uploader 上传器", link: "/guide/uploader" },
            { text: "Downloader 下载器", link: "/guide/downloader" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API 参考",
          items: [
            { text: "FileUD 主类", link: "/api/fileud" },
            { text: "Uploader 配置", link: "/api/uploader-config" },
            { text: "Downloader 配置", link: "/api/downloader-config" },
            { text: "错误码（ErrorCode）", link: "/api/error-codes" },
            { text: "日志（Logger）", link: "/api/logger" },
          ],
        },
      ],
      "/plugins/": [
        {
          text: "内置插件",
          items: [
            { text: "概述", link: "/plugins/" },
            { text: "文件验证", link: "/plugins/validator" },
            { text: "图片压缩", link: "/plugins/compress" },
            { text: "水印", link: "/plugins/watermark" },
            { text: "智能重试", link: "/plugins/retry" },
          ],
        },
      ],
      "/advanced/": [
        {
          text: "高级指南",
          items: [
            { text: "总览", link: "/advanced/" },
            { text: "文档地图", link: "/advanced/map" },
            { text: "setFiles 文件回显", link: "/advanced/SETFILES_GUIDE" },
            { text: "addFile 添加文件", link: "/advanced/ADDFILE_GUIDE" },
            { text: "分片恢复快速开始", link: "/advanced/CHUNK_UPLOAD_RESTORE_QUICKSTART" },
            { text: "分片恢复完整指南", link: "/advanced/CHUNK_UPLOAD_RESTORE_GUIDE" },
            { text: "IndexedDB 文件缓存", link: "/advanced/INDEXEDDB_FILE_CACHE" },
            { text: "取消上传状态修复", link: "/advanced/CANCEL_FIX" },
            { text: "取消后重试修复", link: "/advanced/RETRY_AFTER_CANCEL_FIX" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/ChYuanJinlin/file-ud.js" },
    ],

    search: {
      provider: "local",
    },

    footer: {
      message: "基于 MIT 协议发布",
      copyright: "Copyright © 2024",
    },
  },
});
