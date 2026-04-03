import { UploadFile, ErrorCode } from "@file-ud.js/core";
import { BasePlugin } from "../base-plugin";
import { PluginContext } from "@file-ud.js/core/types";
export interface ImageValidatorOptions {
  // 宽度验证
  exactWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  // 高度验证
  exactHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  // 正方形验证
  square?: boolean;
  // 宽高比验证
  minAspectRatio?: number;
  maxAspectRatio?: number;
  aspectRatios?: number[];
  // 分辨率验证
  minResolution?: number;
  maxResolution?: number;
  // 动画图片验证
  allowAnimated?: boolean;
}

export class ImageValidatorPlugin extends BasePlugin {
  name = "image-validator-plugin";
  priority = 0;
  desc = "图片验证插件（尺寸、比例、分辨率）";

  constructor(private options: ImageValidatorOptions = {}) {
    super();
  }

  async onFileSelect(
    file: UploadFile,
    context: PluginContext,
  ): Promise<UploadFile | void> {
    // 只验证图片
    if (!file.File.type.startsWith("image/")) {
      return file;
    }

    // 获取图片尺寸
    const dimensions = await this.getImageDimensions(file.File);

    // 创建基础错误对象
    const baseError = this.createBaseError(file, context.uploader);

    // 1. 宽度验证
    if (
      this.options.exactWidth &&
      dimensions.width !== this.options.exactWidth
    ) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_WIDTH_INVALID)
          .setMessage(
            `宽度必须为 ${this.options.exactWidth}px，当前 ${dimensions.width}px`,
          )
          .setContext({ width: dimensions.width }),
      );
    }
    if (this.options.minWidth && dimensions.width < this.options.minWidth) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_WIDTH_INVALID)
          .setMessage(
            `宽度不能小于 ${this.options.minWidth}px，当前 ${dimensions.width}px`,
          )
          .setContext({ width: dimensions.width }),
      );
    }
    if (this.options.maxWidth && dimensions.width > this.options.maxWidth) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_WIDTH_INVALID)
          .setMessage(
            `宽度不能大于 ${this.options.maxWidth}px，当前 ${dimensions.width}px`,
          )
          .setContext({ width: dimensions.width }),
      );
    }

    // 2. 高度验证
    if (
      this.options.exactHeight &&
      dimensions.height !== this.options.exactHeight
    ) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_HEIGHT_INVALID)
          .setMessage(
            `高度必须为 ${this.options.exactHeight}px，当前 ${dimensions.height}px`,
          )
          .setContext({ height: dimensions.height }),
      );
    }
    if (this.options.minHeight && dimensions.height < this.options.minHeight) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_HEIGHT_INVALID)
          .setMessage(
            `高度不能小于 ${this.options.minHeight}px，当前 ${dimensions.height}px`,
          )
          .setContext({ height: dimensions.height }),
      );
    }
    if (this.options.maxHeight && dimensions.height > this.options.maxHeight) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_HEIGHT_INVALID)
          .setMessage(
            `高度不能大于 ${this.options.maxHeight}px，当前 ${dimensions.height}px`,
          )
          .setContext({ height: dimensions.height }),
      );
    }

    // 3. 正方形验证
    if (this.options.square && dimensions.width !== dimensions.height) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_NOT_SQUARE)
          .setMessage(
            `图片必须是正方形，当前 ${dimensions.width}x${dimensions.height}`,
          )
          .setContext({
            width: dimensions.width,
            height: dimensions.height,
          }),
      );
    }

    // 4. 宽高比验证
    const aspectRatio = dimensions.width / dimensions.height;
    if (
      this.options.minAspectRatio &&
      aspectRatio < this.options.minAspectRatio
    ) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_ASPECT_RATIO_INVALID)
          .setMessage(
            `宽高比不能小于 ${this.options.minAspectRatio}，当前 ${aspectRatio.toFixed(2)}`,
          )
          .setContext({ aspectRatio }),
      );
    }
    if (
      this.options.maxAspectRatio &&
      aspectRatio > this.options.maxAspectRatio
    ) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_ASPECT_RATIO_INVALID)
          .setMessage(
            `宽高比不能大于 ${this.options.maxAspectRatio}，当前 ${aspectRatio.toFixed(2)}`,
          )
          .setContext({ aspectRatio }),
      );
    }
    if (this.options.aspectRatios?.length) {
      const isValid = this.options.aspectRatios.some(
        (ratio) => Math.abs(aspectRatio - ratio) < 0.01,
      );
      if (!isValid) {
        return this.throwError(
          baseError
            .setCode(ErrorCode.IMAGE_ASPECT_RATIO_INVALID)
            .setMessage(
              `宽高比必须为 ${this.options.aspectRatios.join(", ")}，当前 ${aspectRatio.toFixed(2)}`,
            )
            .setContext({ aspectRatio }),
        );
      }
    }

    // 5. 分辨率验证
    const resolution = dimensions.width * dimensions.height;
    if (this.options.minResolution && resolution < this.options.minResolution) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_RESOLUTION_INVALID)
          .setMessage(
            `分辨率不能小于 ${this.options.minResolution}px²，当前 ${resolution}px²`,
          )
          .setContext({ resolution }),
      );
    }
    if (this.options.maxResolution && resolution > this.options.maxResolution) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.IMAGE_RESOLUTION_INVALID)
          .setMessage(
            `分辨率不能大于 ${this.options.maxResolution}px²，当前 ${resolution}px²`,
          )
          .setContext({ resolution }),
      );
    }

    // 6. 动画图片验证
    if (
      this.options.allowAnimated === false &&
      file.File.type === "image/gif"
    ) {
      const isAnimated = await this.isAnimatedGif(file.File);
      if (isAnimated) {
        return this.throwError(
          baseError
            .setCode(ErrorCode.IMAGE_ANIMATED)
            .setMessage("不支持动态图片"),
        );
      }
    }

    // 保存尺寸信息到元数据
    file.metadata = {
      ...file.metadata,
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio,
      resolution,
    };

    return file;
  }

  /**
   * 获取图片尺寸
   */
  private async getImageDimensions(
    file: File,
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * 检查 GIF 是否为动态图片
   */
  private async isAnimatedGif(file: File): Promise<boolean> {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // 检查 GIF 文件头
    if (
      view.getUint8(0) !== 0x47 ||
      view.getUint8(1) !== 0x49 ||
      view.getUint8(2) !== 0x46 ||
      view.getUint8(3) !== 0x38
    ) {
      return false;
    }

    // 读取帧数量
    let frames = 0;
    const maxFrames = 2; // 只需要知道是否大于 1 帧
    let offset = 6;

    while (offset < view.byteLength && frames < maxFrames) {
      const blockId = view.getUint8(offset);

      if (blockId === 0x21) {
        // Extension block
        offset += 2;
        const blockSize = view.getUint8(offset);
        offset += blockSize + 1;
      } else if (blockId === 0x2c) {
        // Image block
        frames++;
        offset += 10;
      } else if (blockId === 0x3b) {
        // Trailer
        break;
      } else {
        offset++;
      }
    }

    return frames > 1;
  }
}
