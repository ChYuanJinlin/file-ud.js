import { UploadFile, FileUDError, ErrorCode, Uploader } from "@file-ud.js/core";
import { BasePlugin } from "../base-plugin";
import { uploaderConfigs, PluginContext } from "@file-ud.js/core/types";
import { formatFileSize, validator } from "@file-ud.js/core/utils";
export interface FileValidatorPluginOptions {
  /** 最大文件大小 (字节) */
  maxSize?: number;
  /** 最小文件大小 (字节) */
  minSize?: number;
  /** 允许的文件类型 (MIME类型或扩展名) */
  accept?: uploaderConfigs["accept"];
  /** 是否允许空文件 */
  allowEmpty?: boolean;
  /** 自定义验证函数 */
  customValidate?: (
    file: File,
    error: typeof FileUDError,
  ) => boolean | Promise<boolean>;
  /** 错误消息定制 */
  messages?: {
    maxSize?: (max: number, current: number) => string;
    minSize?: (min: number, current: number) => string;
    accept?: (accept: string[], fileName: string) => string;
    // maxFiles?: (max: number) => string;
    // minFiles?: (min: number) => string;
    empty?: () => string;
    custom?: (fileName: string) => string;
  };
}

export class FileValidatorPlugin extends BasePlugin {
  name = "file-validator-plugin";
  priority = 0; // 最先执行
  critical = true;
  desc = "基础验证插件（大小、类型、数量）";

  private options: Required<FileValidatorPluginOptions>;

  private defaultOptions: Required<FileValidatorPluginOptions> = {
    maxSize: Infinity,
    minSize: 0,
    accept: [],
    allowEmpty: false,
    customValidate: async () => true,
    messages: {},
  };

  constructor(options: FileValidatorPluginOptions = {}) {
    super();
    this.options = { ...this.defaultOptions, ...options };
  }

  async created(uploader: Uploader) {
    uploader.inputHTML?.setAttribute("accept", this.options.accept.join(","));
  }
  async onFileSelect(file: UploadFile, context: PluginContext) {
    const uploader = context.uploader;
    const baseError = this.createBaseError(file, uploader);

    // 1. 空文件验证
    if (!this.options.allowEmpty && file.File.size === 0) {
      const msg =
        this.options.messages.empty?.() || `文件 ${file.fileName} 是空文件`;
      return this.throwError(
        baseError.setCode(ErrorCode.FILE_EMPTY).setMessage(msg),
      );
    }

    // 2. 最小大小验证
    if (file.File.size < this.options.minSize) {
      const msg =
        this.options.messages.minSize?.(this.options.minSize, file.File.size) ||
        `文件 ${file.fileName} 太小，最小 ${formatFileSize(this.options.minSize)}`;
      return this.throwError(
        baseError.setCode(ErrorCode.FILE_TOO_SMALL).setMessage(msg).setContext({
          minSize: this.options.minSize,
          currentSize: file.File.size,
        }),
      );
    }

    // 3. 最大大小验证
    if (file.File.size > this.options.maxSize) {
      const msg =
        this.options.messages.maxSize?.(this.options.maxSize, file.File.size) ||
        `文件 ${file.fileName} 太大，最大 ${formatFileSize(this.options.maxSize)}`;
      return this.throwError(
        baseError.setCode(ErrorCode.FILE_TOO_LARGE).setMessage(msg).setContext({
          maxSize: this.options.maxSize,
          currentSize: file.File.size,
        }),
      );
    }

    // 4. 文件类型验证
    if (!validator.type(this.options.accept, file)) {
      const msg =
        this.options.messages.accept?.(this.options.accept, file.fileName) ||
        `文件 ${file.fileName} 类型不支持，允许：${this.options.accept.join(", ")}`;
      return this.throwError(
        baseError.setCode(ErrorCode.INVALID_TYPE).setMessage(msg),
      );
    }

    // 5. 自定义验证
    try {
      const customResult = await this.options.customValidate(
        file.File,
        FileUDError,
      );
      if (!customResult) {
        const msg =
          this.options.messages.custom?.(file.fileName) ||
          `文件 ${file.fileName} 验证失败`;
        return this.throwError(
          baseError.setCode(ErrorCode.FILE_CORRUPTED).setMessage(msg),
        );
      }
    } catch (error) {
      console.log("🚀 ~ FileValidatorPlugin ~ onFileSelect ~ error:", error);
      return this.throwError(
        baseError
          .setCode(ErrorCode.PLUGIN_ERROR)
          .setMessage("文件验证过程出错")
          .setContext({
            originalError: error,
          }),
      );
    }

    return file;
  }
}
