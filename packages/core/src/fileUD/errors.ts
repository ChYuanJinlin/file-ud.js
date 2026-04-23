import Uploader from "../uploader";
import { formatFileSize } from "../utils";
/**
 * 错误码枚举（所有可能的错误）
 */
export enum ErrorCode {
  // ==================== 通用错误 (1000-1999) ====================
  /** 未知错误 */
  UNKNOWN = 1000,
  /** 操作已中止 */
  ABORTED = 1001,
  /** 请求超时 */
  TIMEOUT = 1002,
  /** 网络错误 */
  NETWORK = 1003,

  // ==================== 文件验证错误 (2000-2999) ====================
  /** 文件过大 */
  FILE_TOO_LARGE = 2000,
  /** 文件过小 */
  FILE_TOO_SMALL = 2001,
  /** 文件类型无效 */
  INVALID_TYPE = 2002,
  /** 文件数量超限 */
  FILE_LIMIT_EXCEEDED = 2003,
  /** 重复的文件 */
  DUPLICATE_FILE = 2004,
  /** 文件为空 */
  FILE_EMPTY = 2005,
  /** 文件已损坏 */
  FILE_CORRUPTED = 2006,
  /** 文件过于空泛（可能缺少必要内容） */
  FILE_TOO_EMPTY = 2007,

  // ==================== 图片验证错误 (2100-2199) ====================
  /** 图片宽度不符合要求 */
  IMAGE_WIDTH_INVALID = 2100,
  /** 图片高度不符合要求 */
  IMAGE_HEIGHT_INVALID = 2101,
  /** 图片宽高比不符合要求 */
  IMAGE_ASPECT_RATIO_INVALID = 2102,
  /** 图片分辨率不符合要求 */
  IMAGE_RESOLUTION_INVALID = 2103,
  /** 图片不是正方形 */
  IMAGE_NOT_SQUARE = 2104,
  /** 不支持动态图片 */
  IMAGE_ANIMATED = 2105,

  // ==================== 视频验证错误 (2200-2299) ====================
  /** 视频时长不符合要求 */
  VIDEO_DURATION_INVALID = 2200,
  /** 视频宽度不符合要求 */
  VIDEO_WIDTH_INVALID = 2201,
  /** 视频高度不符合要求 */
  VIDEO_HEIGHT_INVALID = 2202,
  /** 视频比特率不符合要求 */
  VIDEO_BITRATE_INVALID = 2203,
  /** 视频编码格式不支持 */
  VIDEO_CODEC_INVALID = 2204,

  // ==================== 上传错误 (3000-3999) ====================
  /** 上传失败 */
  UPLOAD_FAILED = 3000,
  /** 分片上传失败 */
  CHUNK_UPLOAD_FAILED = 3001,
  /** 合并分片失败 */
  MERGE_FAILED = 3002,
  /** 服务器错误 */
  SERVER_ERROR = 3003,
  /** 未授权访问 */
  UNAUTHORIZED = 3004,
  /** 禁止访问 */
  FORBIDDEN = 3005,
  /** 资源不存在 */
  NOT_FOUND = 3006,

  // ==================== 下载错误 (4000-4999) ====================
  /** 下载失败 */
  DOWNLOAD_FAILED = 4000,
  /** 分片下载失败 */
  CHUNK_DOWNLOAD_FAILED = 4001,

  // ==================== 插件错误 (5000-5999) ====================
  /** 插件错误 */
  PLUGIN_ERROR = 5000,
  /** 插件初始化失败 */
  PLUGIN_INIT_FAILED = 5001,
  /** 插件执行失败 */
  PLUGIN_EXECUTION_FAILED = 5002,
}

/**
 * 错误级别
 */
export enum ErrorLevel {
  INFO = "info", // 提示信息，不影响流程
  WARNING = "warn", // 警告，但继续执行
  ERROR = "error", // 错误，中断当前操作
  CRITICAL = "critical", // 致命错误，整个实例不可用
}

/**
 * 错误上下文（包含现场信息）
 */
export interface ErrorContext {
  /** 发生时间 */
  timestamp?: number;

  /** 插件名称 */
  plugin?: string;

  /** 上传器实例 */
  uploader?: Uploader;

  /* 
  参数选项
   */
  options?: Record<string, any>;

  /** 文件名 */
  fileName?: string;

  /** 文件大小 */
  fileSize?: number;

  /** 分片索引 */
  chunkIndex?: number;

  /** HTTP 状态码 */
  httpStatus?: number;

  /** 重试次数 */
  retryCount?: number;

  /** 原始错误 */
  originalError?: any;

  /** 自定义字段 */
  [key: string]: any;
}

/**
 * 错误配置
 */
export interface ErrorOptions {
  /** 是否可恢复 */
  recoverable?: boolean;

  /** 是否自动重试 */
  retryable?: boolean;

  /** 建议操作 */
  suggestion?: string;

  /** 是否显示给用户 */
  userVisible?: boolean;

  /** 国际化key */
  i18nKey?: string;
}
export interface FileUDErrorJSON {
  name: string;
  code: ErrorCode;
  level: ErrorLevel;
  message: string;
  context: ErrorContext;
  options: ErrorOptions;
  stack?: string;
}

/**
 * 错误码到中文描述的映射表（静态常量，避免重复创建）
 */
const ERROR_CODE_DESCRIPTIONS: Readonly<Record<number, string>> = {
  // 通用错误
  [ErrorCode.UNKNOWN]: "未知错误",
  [ErrorCode.ABORTED]: "操作已中止",
  [ErrorCode.TIMEOUT]: "请求超时",
  [ErrorCode.NETWORK]: "网络错误",

  // 文件验证错误
  [ErrorCode.FILE_TOO_LARGE]: "文件过大",
  [ErrorCode.FILE_TOO_SMALL]: "文件过小",
  [ErrorCode.INVALID_TYPE]: "文件类型无效",
  [ErrorCode.FILE_LIMIT_EXCEEDED]: "文件数量超限",
  [ErrorCode.DUPLICATE_FILE]: "重复的文件",
  [ErrorCode.FILE_EMPTY]: "文件为空",
  [ErrorCode.FILE_CORRUPTED]: "文件已损坏",
  [ErrorCode.FILE_TOO_EMPTY]: "文件内容不完整",

  // 图片验证错误
  [ErrorCode.IMAGE_WIDTH_INVALID]: "图片宽度不符合要求",
  [ErrorCode.IMAGE_HEIGHT_INVALID]: "图片高度不符合要求",
  [ErrorCode.IMAGE_ASPECT_RATIO_INVALID]: "图片宽高比不符合要求",
  [ErrorCode.IMAGE_RESOLUTION_INVALID]: "图片分辨率不符合要求",
  [ErrorCode.IMAGE_NOT_SQUARE]: "图片不是正方形",
  [ErrorCode.IMAGE_ANIMATED]: "不支持动态图片",

  // 视频验证错误
  [ErrorCode.VIDEO_DURATION_INVALID]: "视频时长不符合要求",
  [ErrorCode.VIDEO_WIDTH_INVALID]: "视频宽度不符合要求",
  [ErrorCode.VIDEO_HEIGHT_INVALID]: "视频高度不符合要求",
  [ErrorCode.VIDEO_BITRATE_INVALID]: "视频比特率不符合要求",
  [ErrorCode.VIDEO_CODEC_INVALID]: "视频编码格式不支持",

  // 上传错误
  [ErrorCode.UPLOAD_FAILED]: "上传失败",
  [ErrorCode.CHUNK_UPLOAD_FAILED]: "分片上传失败",
  [ErrorCode.MERGE_FAILED]: "合并分片失败",
  [ErrorCode.SERVER_ERROR]: "服务器错误",
  [ErrorCode.UNAUTHORIZED]: "未授权访问",
  [ErrorCode.FORBIDDEN]: "禁止访问",
  [ErrorCode.NOT_FOUND]: "资源不存在",

  // 下载错误
  [ErrorCode.DOWNLOAD_FAILED]: "下载失败",
  [ErrorCode.CHUNK_DOWNLOAD_FAILED]: "分片下载失败",

  // 插件错误
  [ErrorCode.PLUGIN_ERROR]: "插件错误",
  [ErrorCode.PLUGIN_INIT_FAILED]: "插件初始化失败",
  [ErrorCode.PLUGIN_EXECUTION_FAILED]: "插件执行失败",
} as const;

/**
 * 🔥 核心错误类
 */
export class FileUDError extends Error {
  /** 错误码 */
  code: ErrorCode | undefined;

  /** 错误级别 */
  level: ErrorLevel;

  /** 错误上下文 */
  readonly context: ErrorContext;

  /** 错误选项 */
  readonly options: ErrorOptions;

  /** 原始错误 */
  readonly cause?: Error;

  /** 内部定时器（用于防抖） */
  private __noticeTimer__: ReturnType<typeof setTimeout> | null = null;

  constructor(
    code: ErrorCode,
    message: string,
    context: Partial<ErrorContext> = {},
    options: Partial<ErrorOptions> = {},
    cause?: Error,
  ) {
    super(message);
    this.name = "FileUDError";
    this.code = code;
    this.level = this.determineLevel(code);
    
    // ✅ 使用辅助方法获取文件上下文，减少全局状态耦合
    this.context = {
      timestamp: Date.now(),
      ...this.getCurrentFileContext(),
      ...context,
    };
    
    this.options = {
      recoverable: true,
      retryable: false,
      userVisible: true,
      ...options,
    };
    this.cause = cause;

    // 捕获堆栈（V8 引擎特有，非标准 API）
    (Error as any).captureStackTrace?.(this, FileUDError);
  }

  /**
   * 根据错误码确定错误级别
   */
  private determineLevel(code: ErrorCode): ErrorLevel {
    if (code < 2000) return ErrorLevel.ERROR;
    if (code < 3000) return ErrorLevel.WARNING;
    if (code < 4000) return ErrorLevel.ERROR;
    return ErrorLevel.CRITICAL;
  }

  /**
   * 获取当前上传文件的上下文信息（避免直接访问全局状态）
   * @returns 文件上下文信息
   * @private
   */
  private getCurrentFileContext(): Pick<ErrorContext, "fileName" | "fileSize"> {
    const uploadFile = Uploader.uploadFile;
    return {
      fileName: uploadFile?.fileName,
      fileSize: uploadFile?.File.size,
    };
  }

  /**
   * 设置/更新错误上下文信息
   * @param context - 要设置的上下文信息
   * @returns this (支持链式调用)
   */
  setContext(context: Partial<ErrorContext>): this {
    Object.assign(this.context, context);
    return this;
  }

  /**
   * 设置/更新错误码
   * @param code - 新的错误码
   * @returns this (支持链式调用)
   */
  setCode(code: ErrorCode): this {
    this.code = code as any;
    // 重新计算错误级别
    (this as any).level = this.determineLevel(code);
    this.notice();
    return this;
  }

  /**
   * 通知错误（防抖处理）
   */
  private notice(): void {
    // ✅ 清除之前的定时器
    if (this.__noticeTimer__) {
      clearTimeout(this.__noticeTimer__);
    }

    // ✅ 设置新的定时器，延迟通知以避免频繁触发
    this.__noticeTimer__ = setTimeout(() => {
      Uploader.onError?.(this.toJSON());
      this.__noticeTimer__ = null;
    }, 0);
  }

  /**
   * 获取错误码对应的中文描述
   * @param code - 错误码（可选，不传则使用当前错误码）
   * @returns 中文描述字符串
   */
  getChineseDescription(code?: ErrorCode): string {
    const errorCode = code ?? this.code;
    return ERROR_CODE_DESCRIPTIONS[errorCode as number] || "未知错误";
  }

  /**
   * 设置/更新错误消息
   * @param message - 新的错误消息
   * @returns this (支持链式调用)
   */
  setMessage(message: string): this {
    this.message = message;
    this.notice();
    return this;
  }

  /**
   * 设置/更新错误选项
   * @param options - 新的错误选项
   * @returns this (支持链式调用)
   */
  setOptions(options: Partial<ErrorOptions>): this {
    Object.assign(this.options, options);
    return this;
  }

  /**
   * 转换为 JSON
   */
  toJSON(): object {
    return {
      name: this.name,
      code: this.code,
      level: this.level,
      message: this.message,
      context: this.context,
      options: this.options,
      stack: this.stack,
    };
  }
}

/**
 * 错误工厂（方便创建常见错误）
 */
export const Errors = {
  /**
   * 内部辅助方法：创建并发出错误事件
   * @param uploader - 上传器实例
   * @param error - 错误实例
   * @private
   */
  _emitError(uploader: Uploader, error: FileUDError): void {
    uploader.emit("error", error);
  },

  // 文件相关
  fileTooLarge(this: Uploader, maxSize: number) {
    Errors._emitError(
      this,
      new FileUDError(
        ErrorCode.FILE_TOO_LARGE,
        `文件大小 ${Uploader.uploadFile?.formatSize} 超过限制 ${formatFileSize(maxSize)}`,
        { suggestion: "请选择更小的文件", uploader: this },
      ),
    );
  },
  fileTooType(this: Uploader, options: { accept?: any[]; fileName: string }) {
    Errors._emitError(
      this,
      new FileUDError(
        ErrorCode.INVALID_TYPE,
        `文件${options.fileName}类型不支持，允许：${options.accept?.join(", ")}`,
        {
          accept: options.accept,
          uploader: this,
        },
        { suggestion: "请选择符合要求的文件类型" },
      ),
    );
  },
  fileTooLimit(this: Uploader, limit: number) {
    Errors._emitError(
      this,
      new FileUDError(
        ErrorCode.FILE_LIMIT_EXCEEDED,
        "文件数量超过限制",
        {
          limit,
          uploader: this,
        },
        { suggestion: "请选择更少的文件" },
      ),
    );
  },

  // 网络相关
  networkError(this: Uploader, cause?: Error) {
    Errors._emitError(
      this,
      new FileUDError(
        ErrorCode.NETWORK,
        "网络连接失败，请检查网络后重试",
        { uploader: this },
        { retryable: true, recoverable: true },
        cause,
      ),
    );
  },

  // 上传相关
  uploadFailed(this: Uploader, fileName: string, status?: number) {
    Errors._emitError(
      this,
      new FileUDError(
        ErrorCode.UPLOAD_FAILED,
        `文件 ${fileName} 上传失败${status ? ` (${status})` : ""}`,
        { fileName, httpStatus: status, uploader: this },
        { retryable: true },
      ),
    );
  },

  // 插件错误
  pluginError(this: Uploader, pluginName: string, cause?: Error) {
    Errors._emitError(
      this,
      new FileUDError(
        ErrorCode.PLUGIN_ERROR,
        `插件 ${pluginName} 执行失败`,
        {
          plugin: pluginName,
          uploader: this,
        },
        { recoverable: false },
        cause,
      ),
    );
  },
};
