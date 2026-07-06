// plugins/compress.plugin.ts

import {
  UploadFile,
  formatFileSize,
  type PluginContext,
} from "@file-ud.js/core";
import { BasePlugin } from "../../base-plugin";
export interface ImageCompressPluginOptions {
  /** 压缩质量 (0-1) */
  quality?: number;
  /** 最大宽度 (px) */
  maxWidth?: number;
  /** 最大高度 (px) */
  maxHeight?: number;
  /** 输出格式 */
  format?: "jpeg" | "png" | "webp";
  /** 是否显示压缩信息 */
  showInfo?: boolean;
  /** 压缩开始时触发 */
  onCompressStart?: (file: UploadFile) => void;
  /** 压缩完成时触发 */
  onCompressComplete?: (file: UploadFile, compressedFile: File) => void;
}

export class CompressImagePlugin extends BasePlugin {
  name = "compress-image-plugin";
  priority = 10;
  desc = "图片压缩插件";
  options: Required<ImageCompressPluginOptions>;
  private defaultOptions: Required<ImageCompressPluginOptions> = {
    quality: 0.8,
    maxWidth: 1920,
    maxHeight: 1080,
    format: "jpeg",
    showInfo: true,
    onCompressStart: function (file: UploadFile): void {
      throw new Error("Function not implemented.");
    },
    onCompressComplete: function (
      file: UploadFile,
      compressedFile: File,
    ): void {
      throw new Error("Function not implemented.");
    },
  };

  constructor(options: ImageCompressPluginOptions = {}) {
    super();
    this.options = { ...this.defaultOptions, ...options };
  }

  async onFileSelect(
    uploadFile: UploadFile,
    context: PluginContext<UploadFile>,
  ): Promise<UploadFile | void> {
    // 只处理图片
    if (!uploadFile.File.type.startsWith("image/")) {
      return uploadFile;
    }

    const originalSize = uploadFile.File.size;

    try {
      this.options.onCompressStart?.(uploadFile);
      const compressedFile = await this.compressImage(uploadFile.File);
      const compressedSize = compressedFile.size;
      const ratio = (
        ((originalSize - compressedSize) / originalSize) *
        100
      ).toFixed(1);

      if (this.options.showInfo) {
        console.log(
          `📸 压缩完成: ${uploadFile.fileName} | ${formatFileSize(originalSize)} → ${formatFileSize(compressedSize)} (减少 ${ratio}%)`,
        );
      }

      uploadFile.proxy.File = compressedFile;
      this.options.onCompressComplete?.(uploadFile, compressedFile);
      uploadFile.proxy.formatSize = formatFileSize(compressedSize);
      return uploadFile;
    } catch (error) {
      console.error(`压缩失败: ${uploadFile.fileName}`, error);
      return uploadFile; // 返回原文件
    }
  }

  private compressImage(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // 计算压缩尺寸
        let { width, height } = img;
        if (width > this.options.maxWidth) {
          height = Math.floor(height * (this.options.maxWidth / width));
          width = this.options.maxWidth;
        }
        if (height > this.options.maxHeight) {
          width = Math.floor(width * (this.options.maxHeight / height));
          height = this.options.maxHeight;
        }

        // 创建 Canvas
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("无法创建 Canvas 上下文"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // 转换为 Blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File(
                [blob],
                file.name.replace(/\.\w+$/, `.${this.options.format}`),
                { type: `image/${this.options.format}` },
              );
              resolve(compressedFile);
            } else {
              reject(new Error("压缩失败"));
            }
          },
          `image/${this.options.format}`,
          this.options.quality,
        );
      };

      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = url;
    });
  }
}
