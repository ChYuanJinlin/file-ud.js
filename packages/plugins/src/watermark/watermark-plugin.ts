// plugins/watermark/watermark-plugin.ts
import { UploadFile } from "@file-ud.js/core";
import { BasePlugin } from "../base-plugin";
import { PluginContext } from "@file-ud.js/core/types";
import { formatFileSize } from "@file-ud.js/core/utils";
export interface WatermarkPluginOptions {
  /** 水印文字 */
  text?: string;
  /** 水印图片URL */
  imageUrl?: string;
  /** 位置 */
  position?:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "center";
  /** 透明度 (0-1) */
  opacity?: number;
  /** 字体大小 */
  fontSize?: number;
  /** 字体颜色 */
  color?: string;
  /** 边距 */
  padding?: number;
  /** 水印图片宽度（可选） */
  imageWidth?: number;
  /** 水印图片高度（可选） */
  imageHeight?: number;
}

export class WatermarkPlugin extends BasePlugin {
  name = "watermark-plugin";
  priority = 20;
  desc = "水印插件（支持文字/图片水印）";
  options: Required<WatermarkPluginOptions>;

  private defaultOptions: Required<WatermarkPluginOptions> = {
    text: "© FileUD",
    imageUrl: "",
    position: "bottom-right",
    opacity: 0.6,
    fontSize: 24,
    color: "#ffffff",
    padding: 20,
    imageWidth: 100,
    imageHeight: 100,
  };

  constructor(options: Partial<WatermarkPluginOptions> = {}) {
    super();
    this.options = { ...this.defaultOptions, ...options };
  }

  async onFileSelect(
    file: UploadFile,
    context: PluginContext,
  ): Promise<UploadFile | void> {
    // 只处理图片
    if (!file.File.type.startsWith("image/")) {
      return file;
    }

    try {
      const watermarkedFile = await this.addWatermark(file.File);

      const newFile = new UploadFile(
        {
          fileId: file.fileId,
          url: file.url,
          fileName: file.fileName,
          File: watermarkedFile,
          percent: 0,
          status: "pending",
          extension: file.extension,
          formatSize: formatFileSize(watermarkedFile.size),
          index: file.index,
        },
        context.uploader,
      );

      console.log(`💧 水印已添加: ${file.fileName}`);
      return newFile;
    } catch (error) {
      console.error(`水印添加失败: ${file.fileName}`, error);
      return file;
    }
  }

  private addWatermark(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("无法创建 Canvas 上下文"));
          return;
        }

        // 绘制原图
        ctx.drawImage(img, 0, 0);
        ctx.globalAlpha = this.options.opacity;

        // ✅ 根据是否有 imageUrl 选择水印类型
        if (this.options.imageUrl) {
          // ========== 图片水印 ==========
          this.addImageWatermark(ctx, canvas, resolve, reject, file);
        } else if (this.options.text) {
          // ========== 文字水印 ==========
          this.addTextWatermark(ctx, canvas, resolve, reject, file);
        }
      };

      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = url;
    });
  }

  /**
   * 添加文字水印
   */
  private addTextWatermark(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    resolve: (value: File) => void,
    reject: (reason: Error) => void,
    originalFile: File,
  ) {
    // 设置文字样式
    ctx.font = `${this.options.fontSize}px Arial`;
    ctx.fillStyle = this.options.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text = this.options.text;
    const textWidth = ctx.measureText(text).width;
    const padding = this.options.padding;

    // 计算位置（传入 padding 参数）
    const { x, y } = this.calculatePosition(
      ctx,
      canvas,
      textWidth,
      this.options.fontSize,
      padding,
    );

    // 绘制文字水印
    ctx.fillText(text, x, y);

    // 转换为文件
    canvas.toBlob((blob) => {
      if (blob) {
        const watermarkedFile = new File([blob], originalFile.name, {
          type: originalFile.type,
        });
        resolve(watermarkedFile);
      } else {
        reject(new Error("水印添加失败"));
      }
    }, originalFile.type);
  }

  /**
   * 添加图片水印
   */
  private addImageWatermark(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    resolve: (value: File) => void,
    reject: (reason: Error) => void,
    originalFile: File,
  ) {
    const watermarkImg = new Image();
    watermarkImg.crossOrigin = "Anonymous"; // 处理跨域

    watermarkImg.onload = () => {
      // 计算水印图片尺寸
      let drawWidth = this.options.imageWidth;
      let drawHeight = this.options.imageHeight;

      // 如果没指定尺寸，使用原图尺寸
      if (!drawWidth && !drawHeight) {
        drawWidth = watermarkImg.width;
        drawHeight = watermarkImg.height;
      } else if (drawWidth && !drawHeight) {
        drawHeight = (watermarkImg.height / watermarkImg.width) * drawWidth;
      } else if (!drawWidth && drawHeight) {
        drawWidth = (watermarkImg.width / watermarkImg.height) * drawHeight;
      }

      const padding = this.options.padding;

      // 计算位置（传入 padding 参数）
      const { x, y } = this.calculatePosition(
        ctx,
        canvas,
        drawWidth,
        drawHeight,
        padding,
      );

      // 绘制图片水印
      ctx.drawImage(watermarkImg, x, y, drawWidth, drawHeight);

      // 转换为文件
      canvas.toBlob((blob) => {
        if (blob) {
          const watermarkedFile = new File([blob], originalFile.name, {
            type: originalFile.type,
          });
          resolve(watermarkedFile);
        } else {
          reject(new Error("水印添加失败"));
        }
      }, originalFile.type);
    };

    watermarkImg.onerror = () => {
      reject(new Error("水印图片加载失败"));
    };

    watermarkImg.src = this.options.imageUrl;
  }

  /**
   * 计算水印位置
   */
  private calculatePosition(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    padding?: number,
  ): { x: number; y: number } {
    const pad = padding ?? this.options.padding;
    let x: number, y: number;

    switch (this.options.position) {
      case "top-left":
        x = pad;
        y = pad;
        break;
      case "top-right":
        x = canvas.width - width - pad;
        y = pad;
        break;
      case "bottom-left":
        x = pad;
        y = canvas.height - height - pad;
        break;
      case "bottom-right":
        x = canvas.width - width - pad;
        y = canvas.height - height - pad;
        break;
      default: // center
        x = (canvas.width - width) / 2;
        y = (canvas.height - height) / 2;
    }

    return { x, y };
  }
}
