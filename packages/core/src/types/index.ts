import type { FileUDErrorJSON } from "../fileUD/errors";
import type Uploader from "../uploader";
import type Downloader from "../downloader/index";
import type DownloadFile from "../downloader/DownloadFile";
import type ChunkManager from "../uploader/UploadChunkManager";
import type UploadFile from "../uploader/UploadFile";
import type TransferFile from "../transfer/TransferFile";
import type Transfer from "../transfer/Transfer";
import type { AxiosRequestConfig, AxiosInstance } from "axios";
/**
 * 文件传输接受类型定义
 * 支持常见的 MIME 类型、通配符和文件后缀名
 */
export type AcceptFileType =
  // 图片类型
  | "image/*"
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml"
  | "image/bmp"
  | "image/tiff"
  // 视频类型
  | "video/*"
  | "video/mp4"
  | "video/webm"
  | "video/ogg"
  | "video/quicktime"
  // 音频类型
  | "audio/*"
  | "audio/mp3"
  | "audio/wav"
  | "audio/ogg"
  | "audio/aac"
  | "audio/flac"
  // 文档类型
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.ms-powerpoint"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  // 压缩文件
  | "application/zip"
  | "application/x-rar-compressed"
  | "application/x-7z-compressed"
  // 文本类型
  | "text/plain"
  | "text/csv"
  | "text/html"
  | "text/css"
  | "text/javascript"
  | "application/json"
  | "application/xml"
  // 字体文件
  | "font/woff"
  | "font/woff2"
  | "font/ttf"
  | "font/otf"
  // 常见文件后缀名 - 图片
  | ".jpg"
  | ".jpeg"
  | ".png"
  | ".gif"
  | ".webp"
  | ".svg"
  | ".bmp"
  | ".tiff"
  | ".ico"
  | ".heic"
  | ".heif"
  | ".raw"
  | ".psd"
  | ".ai"
  | ".eps"
  // 常见文件后缀名 - 视频
  | ".mp4"
  | ".webm"
  | ".ogg"
  | ".avi"
  | ".mov"
  | ".wmv"
  | ".flv"
  | ".mkv"
  | ".m4v"
  | ".mpeg"
  | ".mpg"
  | ".3gp"
  | ".rmvb"
  | ".rm"
  // 常见文件后缀名 - 音频
  | ".mp3"
  | ".wav"
  | ".flac"
  | ".aac"
  | ".wma"
  | ".m4a"
  | ".ape"
  | ".opus"
  | ".aiff"
  | ".mid"
  | ".midi"
  // 常见文件后缀名 - 文档
  | ".pdf"
  | ".doc"
  | ".docx"
  | ".xls"
  | ".xlsx"
  | ".ppt"
  | ".pptx"
  | ".txt"
  | ".md"
  | ".csv"
  | ".rtf"
  | ".odt"
  | ".ods"
  | ".odp"
  | ".wps"
  | ".et"
  | ".dps"
  // 常见文件后缀名 - 代码与数据
  | ".json"
  | ".xml"
  | ".html"
  | ".htm"
  | ".css"
  | ".scss"
  | ".sass"
  | ".less"
  | ".js"
  | ".jsx"
  | ".ts"
  | ".tsx"
  | ".vue"
  | ".py"
  | ".java"
  | ".c"
  | ".cpp"
  | ".h"
  | ".hpp"
  | ".go"
  | ".rs"
  | ".php"
  | ".rb"
  | ".swift"
  | ".kt"
  | ".yaml"
  | ".yml"
  | ".toml"
  | ".ini"
  | ".sql"
  | ".sh"
  | ".bat"
  | ".ps1"
  // 常见文件后缀名 - 压缩文件
  | ".zip"
  | ".rar"
  | ".7z"
  | ".tar"
  | ".gz"
  | ".bz2"
  | ".xz"
  | ".tgz"
  | ".iso"
  // 常见文件后缀名 - 字体
  | ".ttf"
  | ".otf"
  | ".woff"
  | ".woff2"
  | ".eot"
  // 常见文件后缀名 - 其他
  | ".apk"
  | ".ipa"
  | ".exe"
  | ".msi"
  | ".dmg"
  | ".pkg";

export interface ChunkOptions {
  /* 分片最大并发 */
  maxConcurrent?: number;
  /* 分片大小 */
  chunkSize?: number;
  /* 重试次数 */
  retries?: number | null;
  /* 重试延迟（毫秒） */
  retryDelay?: number;
  /* 超时时间（毫秒） */
  timeout?: number;
  // ==================== 文件缓存配置 ====================
  /* 是否启用文件缓存（将 File 对象存储到 IndexedDB，默认 false） */
  enableFileCache?: boolean;
  /* 缓存保留天数，超过此天数的缓存将被自动清理（默认 7 天） */
  cacheRetentionDays?: number;
}

/* 日志配置 */

export interface LogConfig {
  /** 是否启用日志输出（默认 true） */
  enabled?: boolean;
  /** 日志级别：0=DEBUG, 1=INFO, 2=WARN, 3=ERROR（默认根据 NODE_ENV 自动设置） */
  level?: 0 | 1 | 2 | 3;
  /** 是否显示时间戳（默认 true） */
  showTimestamp?: boolean;
  /** 是否启用颜色输出（默认非生产环境启用） */
  enableColors?: boolean;
}
export type FileConfig = {
  data: File | Blob;
  uploadFile: UploadFile;
  formData: FormData;
  chunkIndex?: number;
};
export interface UDConfig<T = any> {
  /* 分片上传下载配置 */
  chunkOptions?: ChunkOptions | null;
  /* 可选：传入自定义 axios 实例 */
  axiosInstance?: AxiosInstance;

  /* 上传下载文件的数量限制 */
  limit?: number;
  /* 上传下载文件限制的大小 */
  maxSize?: number;
  /* 上传下载请求的头部信息 */
  headers?: Record<string, any>;
  /** 最大同时传输文件数，0 或不设置表示不限制 */
  maxFileConcurrent?: number;
}
export interface UploaderConfig extends UDConfig<UploadFile> {
  /* 是否支持多选 */
  multiple?: boolean;
  /* 接受的文件类型（支持 MIME 类型或文件后缀名） */
  accept?: AcceptFileType[] | string[];
  /* 是否显示文件输入框 */
  show?: false;
  /* 挂载的元素ID */
  elementId?: string;
  /* 是否自动上传 */
  autoUpload?: boolean;
  /**
   * 文件传输下载地址，可以是字符串或者promise函数
   * @return {Promise}
   */
  action:
    | string
    | ((formData: FormData, transferFile: UploadFile) => string | Promise<any>);
  /* 上传文件标识 */
  file?: string | ((FileConfig: FileConfig) => void);
}
/**
 * 下载器配置
 */
export interface DownloaderConfig extends UDConfig<DownloadFile> {
  /** 默认超时时间 */
  timeout?: number;
  /**
   * 文件传输下载地址，可以是字符串或者promise函数
   * @return {Promise}
   */
  action: string | ((transferFile: DownloadFile) => string | Promise<any>);
  axiosOptions?: AxiosRequestConfig;
  /** 下载最大速率限制（bytes/秒），0 或不设置表示不限制 */
  maxDownloadSpeed?: number;
}
export interface PluginContext<
  T extends TransferFile<any, any> = TransferFile<any, any>,
> {
  /** 传输器实例（Uploader 或 Downloader） */
  transfer: Transfer<T>;

  /** 当前文件 */
  file?: T;

  /** 表单数据（上传专用） */
  formData?: FormData;

  /** 配置信息 */
  config?: any;

  /** 插件共享数据 */
  shared: Map<string, any>;

  /** 当前操作状态（用于区分MD5计算、上传中等不同阶段） */
  status?: IFile["status"];

  /** 状态描述信息（可选，用于显示给用户） */
  message?: string;
}
/* 
插件接口 每个插件需要实现 IUDPlugin 接口
*/
export interface IUDPlugin<
  T extends TransferFile<any, any> = TransferFile<any, any>,
> {
  /** 插件名称 */
  name: string;

  /** 插件版本 */
  version?: string;
  // 插件描述
  desc?: string;
  /** 插件优先级（数字越小越先执行） */
  priority?: number;

  /** 插件初始化（注册时调用一次） */
  install?: (transfer: Transfer<T>, options?: any) => void | Promise<void>;

  // 创建时钩子
  created?: (transfer: Transfer<T>) => void | Promise<void>;
  /** 文件选择后触发 */
  onFileSelect?: (
    file: T,
    context: PluginContext<T>,
  ) => Promise<T | void | false> | T | void;

  /** 传输前触发 */
  beforeTransfer?: (
    file: T,
    context: PluginContext<T>,
  ) => Promise<boolean | void> | boolean | void;

  /** 传输进度触发 */
  onProgress?: (percent: number, file: T, context: PluginContext<T>) => void;

  /** 传输成功触发 */
  onSuccess?: (response: any, file: T, context: PluginContext<T>) => void;

  /** 传输失败触发 */
  onError?: (error: Error, file: T, context: PluginContext<T>) => void;

  /** 插件销毁时调用 */
  destroy?: () => void;
}
export type PluginConstructor = new (options?: any) => IUDPlugin;

export interface UDFile {
  /* 文件唯一标识符 */
  fileId?: string;
  /* 文件访问URL */
  url: string;
  /* 文件名称 */
  fileName: string;
  /* 文件大小 */
  size?: number;
  /* 流式保存 FileHandle（File System Access API） */
  fileHandle?: FileSystemFileHandle;

  /* 文件传输的状态 */
  status?:
    | "pending"
    | "UDLoading"
    | "paused"
    | "success"
    | "fail"
    | "error"
    | "cancelled"
    | "merging"
    | "hashing";
}
/* 文件传输状态类型 */
export interface IFile extends UDFile {
  /* 文件传输的进度百分比 */
  percent?: number;
  /* 文件扩展名 */
  extension?: string;
  /* 文件对象 */
  File?: File;
  /* 
  loading 状态
  */
  loading?: boolean;
  /* 
  文件效验 loading
  */
  hashLoading?: boolean;
  /* 
  hash 进度
  */
  hashPercent?: number;
  /* 
  是否取消上传
  */
  isCancel?: boolean;

  /* 文件大小 */
  formatSize?: string;
  /* 取消请求上传方法 */
  abort?: () => void;
  /* 是否在重试中 */
  isRetry?: boolean;
  /* 文件传输的索引 */
  index?: number;

  /* 插件可写入的自定义元数据 */
  metadata?: Record<string, any>;

  speed?: speedInfo;

  // ==================== 分片上传回显相关字段 ====================
  /* 总分片数（回显分片上传进度时需要） */
  totalChunks?: number;
  /* 已完成分片数（回显分片上传进度时需要） */
  completedChunks?: number;
  /* 已上传的分片索引数组（用于断点续传回显） */
  chunkIndexes?: number[];
  /* 文件哈希值（用于秒传/断点续传回显） */
  fileHash?: string;
  /* 服务端上传ID（用于断点续传回显） */
  uploadId?: string;
}

/**
 * 下载文件接口
 */
export interface IDownloadFile extends Omit<IFile, "transfer"> {
  /* 保存的文件名 */
  saveFileName?: string;
  /* 是否使用 Blob 下载 */
  useBlob?: boolean;
  /* Downloader 对象 */
  __downloader__?: Downloader;
}

/* 错误回调函数类型 */
export type ErrorCallBack = (errors: FileUDErrorJSON) => void;

/* 上传前的操作回调函数类型 */
export type beforeTransferCallBack<T extends TransferFile<any, any>> = (
  file: T,
) => boolean | Promise<Boolean> | undefined | null | { [key: string]: any };

/* 上传成功回调函数类型 */
export type successCallback<T> = (
  response: T,
  file: TransferFile<any, any>,
) => void;

/* 更新回调函数类型 */
export type UpdateCallBack<T = any> = (file: T[]) => void;

/* 
初始化回调函数类型
*/
export type onInitChunkCallback<T> = (
  file: T,
  totalChunks: number,
  fileHash: string,
) =>
  | Promise<{
      fileHash: string;
      chunks?: number[] | null | undefined;
      isInstantUpload?: boolean; // ✅ 上传秒传标记（文件已存在，无需合并）
      isInstantDownload?: boolean; // ✅ 下载秒下标记（所有分片已存在，无需下载）
      url?: string;
      shouldRemove?: boolean; // ✅ 标记是否需要移除该文件（秒传时自动移除）
    }>
  | undefined;

/* 
合并分片回调函数类型
*/
export type OnMergeChunkCallBack = (chunkManager: ChunkManager) => Promise<any>;
/* 
打开文件之后的回调
*/
export type OpenFileCallback = (uploadFile: UploadFile) => void;
/* 文件选择回调函数类型 */
export type SelectCallBack = (
  file: File,
) => boolean | Promise<Boolean> | undefined | null;

/**
 * 分片事件数据辅助类型（上传/下载共用）
 */
export interface ChunkStartData<T = TransferFile<any, any>> {
  file: T;
  totalChunks: number;
  chunkSize: number;
}

export interface ChunkSuccessData<T = TransferFile<any, any>> {
  chunkIndex: number;
  totalChunks: number;
  completedChunks: number;
  percent: number;
  file: T;
}

export interface ChunkErrorData<T = TransferFile<any, any>> {
  chunkIndex: number;
  totalChunks: number;
  error: string;
  file: T;
}

/**
 * 基础传输事件接口（上传/下载共用）
 *
 * 注意：error 和 update 未纳入基类，因为上传/下载的签名完全不同：
 *   - Uploader.error = (errors: FileUDErrorJSON) => void
 *   - Downloader.error = (error: Error, file: DownloadFile) => void
 */
export interface BaseTransferEvents<T = TransferFile<any, any>> {
  /* 文件列表变化事件 */
  change: (file: T) => void;
  /* 传输进度事件 */
  progress: (percent: number) => void;
  /* 暂停传输事件 */
  pause: (file: T) => void;
  /* 恢复传输事件 */
  resume: (file: T) => void;
  /* 取消传输事件 */
  cancel: (file: T) => void;
  /* 重试传输事件 */
  retry: (file: T) => void;
  /* 移除文件事件 */
  remove: (file: T) => void;
  /* 文件开始传输事件 */
  "files-start": (files: T[]) => void;
  /* 文件完成传输事件 */
  "files-complete": (files: TransferFile<any, any>[]) => void;
  // 分片相关（上传/下载共用）
  /* 分片成功事件 */
  "chunk-success": (data: ChunkSuccessData<T>) => void;
  /* 分片失败事件 */
  "chunk-error": (data: ChunkErrorData<T>) => void;
  /* 合并开始事件 */
  merging: (data: {
    file: T;
    completedChunks: number;
    totalChunks: number;
  }) => void;
  /* 合并成功事件 */
  "merge-success": (data: { file: T; response?: any }) => void;
  /* 合并失败事件 */
  "merge-error": (data: { file: T; error: string }) => void;
}

/* 上传器事件接口 */
export interface UploaderEvents extends BaseTransferEvents<UploadFile> {
  /* 选择文件时触发的事件 */
  select: (file: File) => boolean;
  /* 更新事件 */
  update: (uploaderFile: UploadFile[]) => void;
  /* 错误事件 */
  error: ErrorCallBack;
  /* 分片上传开始事件 */
  "chunk-upload-start": (data: ChunkStartData<UploadFile>) => void;
  /* 秒传成功事件（文件已存在，自动移除） */
  "instant-upload": (data: { file: UploadFile; reason: string }) => void;
}

/**
 * 下载器事件接口
 */
export interface DownloaderEvents extends BaseTransferEvents<DownloadFile> {
  /* 更新事件 */
  update: (downloaderFiles: DownloadFile[]) => void;
  /* 错误事件 */
  error: (error: Error, file: DownloadFile) => void;
  /* 分片下载开始事件 */
  "chunk-download-start": (data: ChunkStartData<DownloadFile>) => void;
}

/* 事件名称类型 */
export type EventName = keyof UploaderEvents;
export type DownloaderEventName = keyof DownloaderEvents;

/* 事件回调函数类型 */
export type EventCallback<T extends EventName> = UploaderEvents[T];

/**
 * 上传速率统计信息接口
 * 用于描述单个文件或全局的上传速度指标
 */
export interface speedInfo {
  /** 当前瞬时速度 (bytes/s) - 基于最近两个采样点计算 */
  currentSpeed: number;

  /** 平均速度 (bytes/s) - 基于总耗时和总字节数计算 */
  averageSpeed: number;

  /** 格式化后的当前速度,如 "15.23 MB/s"、"256 KB/s" */
  currentSpeedFormatted: string;

  /** 格式化后的平均速度,如 "12.45 MB/s"、"128 KB/s" */
  averageSpeedFormatted: string;

  /** 预计剩余时间（秒），-1 表示无法计算，0 表示即将完成 */
  estimatedTimeRemaining: number;

  /** 格式化后的预计剩余时间，如 "3m 20s"、"12s"、"即将完成" */
  estimatedTimeFormatted: string;
}

/**
 * 上传时间统计信息接口
 * 记录文件传输的生命周期时间节点
 */
export interface TimeInfo {
  /** 开始时间戳 (毫秒) */
  startTime: number;

  /** 结束时间戳 (毫秒) */
  endTime: number;

  /** 总耗时 (毫秒) */
  duration: number;

  /** 格式化后的耗时,如 "5.23s"、"1m 30s"、"2h 15m" */
  durationFormatted: string;
}

/**
 * 下载配置选项
 */
export interface DownloadOptions {
  /** 下载链接 */
  url: string;
  /** 文件名 */
  fileName?: string;
  /** 是否使用 Blob 方式下载（浏览器环境触发下载对话框） */
  useBlob?: boolean;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 请求头 */
  headers?: Record<string, string>;
  /** Axios 实例（可选） */
  axiosInstance?: any;
}
