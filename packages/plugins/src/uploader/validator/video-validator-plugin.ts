import { UploadFile, ErrorCode } from "@file-ud.js/core";
import { BasePlugin } from "../../base-plugin";
import { PluginContext } from "@file-ud.js/core/types";
export interface VideoValidatorOptions {
  // 时长验证
  minDuration?: number;
  maxDuration?: number;
  // 分辨率验证
  minWidth?: number;
  minHeight?: number;
  // 比特率验证
  minBitrate?: number;
  maxBitrate?: number;
  // 编码格式验证
  allowedCodecs?: string[];
}

export class VideoValidatorPlugin extends BasePlugin {
  name = "video-validator-plugin";
  version = "1.0.0";
  priority = 0;

  constructor(private options: VideoValidatorOptions = {}) {
    super();
  }

  async onFileSelect(
    file: UploadFile,
    context: PluginContext,
  ): Promise<UploadFile | void> {
    // 只验证视频
    if (!file.File.type.startsWith("video/")) {
      return file;
    }

    const metadata = await this.getVideoMetadata(file.File);

    // 创建基础错误对象
    const baseError = this.createBaseError(file, context.uploader);

    // 时长验证
    if (
      this.options.minDuration &&
      metadata.duration < this.options.minDuration
    ) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.VIDEO_DURATION_INVALID)
          .setMessage(
            `视频时长不能小于 ${this.options.minDuration}秒，当前 ${metadata.duration.toFixed(1)}秒`,
          )
          .setContext({ duration: metadata.duration }),
      );
    }
    if (
      this.options.maxDuration &&
      metadata.duration > this.options.maxDuration
    ) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.VIDEO_DURATION_INVALID)
          .setMessage(
            `视频时长不能大于 ${this.options.maxDuration}秒，当前 ${metadata.duration.toFixed(1)}秒`,
          )
          .setContext({ duration: metadata.duration }),
      );
    }

    // 分辨率验证
    if (this.options.minWidth && metadata.width < this.options.minWidth) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.VIDEO_WIDTH_INVALID)
          .setMessage(
            `视频宽度不能小于 ${this.options.minWidth}px，当前 ${metadata.width}px`,
          )
          .setContext({ width: metadata.width }),
      );
    }
    if (this.options.minHeight && metadata.height < this.options.minHeight) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.VIDEO_HEIGHT_INVALID)
          .setMessage(
            `视频高度不能小于 ${this.options.minHeight}px，当前 ${metadata.height}px`,
          )
          .setContext({ height: metadata.height }),
      );
    }

    // 比特率验证
    if (this.options.minBitrate && metadata.bitrate < this.options.minBitrate) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.VIDEO_BITRATE_INVALID)
          .setMessage(
            `视频比特率不能小于 ${this.options.minBitrate}kbps，当前 ${metadata.bitrate}kbps`,
          )
          .setContext({ bitrate: metadata.bitrate }),
      );
    }
    if (this.options.maxBitrate && metadata.bitrate > this.options.maxBitrate) {
      return this.throwError(
        baseError
          .setCode(ErrorCode.VIDEO_BITRATE_INVALID)
          .setMessage(
            `视频比特率不能大于 ${this.options.maxBitrate}kbps，当前 ${metadata.bitrate}kbps`,
          )
          .setContext({ bitrate: metadata.bitrate }),
      );
    }

    // 编码格式验证
    if (this.options.allowedCodecs?.length) {
      const codecValid = this.options.allowedCodecs.some((codec) =>
        metadata.codec?.includes(codec),
      );
      if (!codecValid) {
        return this.throwError(
          baseError
            .setCode(ErrorCode.VIDEO_CODEC_INVALID)
            .setMessage(
              `视频编码格式不支持，当前 ${metadata.codec || "未知"}，允许：${this.options.allowedCodecs.join(", ")}`,
            )
            .setContext({ codec: metadata.codec }),
        );
      }
    }

    // 保存元数据
    file.metadata = { ...file.metadata, video: metadata };

    return file;
  }

  /**
   * 获取视频元数据
   */
  private async getVideoMetadata(file: File): Promise<{
    duration: number;
    width: number;
    height: number;
    bitrate: number;
    codec?: string;
  }> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          bitrate: 0, // 浏览器无法直接获取比特率，需要后端提供或估算
          codec: video.currentSrc.split(",").pop()?.split('"')[1],
        });
      };

      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error("Failed to load video metadata"));
      };

      video.src = URL.createObjectURL(file);
    });
  }
}
