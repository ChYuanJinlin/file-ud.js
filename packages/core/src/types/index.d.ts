import { FileUDError } from "../fileUD/errors";
import Uploader from "../uploader";
import ChunkManager from "../uploader/ChunkManager";
import UploadFile from "../uploader/UploadFile";

/**
 * 文件上传接受类型定义
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
  /* 是否启用断点续传 */
  enableResume?: boolean;
  /* 自定义上传ID（用于断点续传） */
  uploadId?: string;
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
export interface FileUDConfigs {
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
   * 文件上传地址，可以是字符串或者promise函数
   * @return {Promise}
   */
  action: string | ((formData: FormData, uploadFile: UploadFile) => Promise<any>);
  /* 上传文件的数量限制 */
  limit?: number;
  /* 上传文件限制的大小 */
  maxSize?: number;
  /* 上传请求的头部信息 */
  headers?: Record<string, any>;
  /* 上传文件标识 */
  file:
    | string
    | ((fileObj: {
        data: File | Blob;
        uploadFile: UploadFile;
        formData: FormData;
        chunkIndex?: number;
      }) => void);
  /* 分片上传配置 */
  chunkOptions?: ChunkOptions | null;
  /* 可选：传入自定义 axios 实例 */
  axiosInstance?: AxiosInstance;
}

export interface PluginContext {
  /** 上传器实例 */
  uploader: Uploader;

  /** 当前文件 */
  file?: UploadFile;

  /** 表单数据 */
  formData?: FormData;

  /** 配置信息 */
  config?: FileUDConfigs;

  /** 插件共享数据 */
  shared: Map<string, any>;

  /** 当前操作状态（用于区分MD5计算、上传中等不同阶段） */
  status?: "hashing" | "uploading" | "merging" | "success" | "error";

  /** 状态描述信息（可选，用于显示给用户） */
  message?: string;
}
/* 
插件接口 每个插件需要实现 IUploaderPlugin 接口
*/
export interface IUploaderPlugin {
  /** 插件名称 */
  name: string;

  /** 插件版本 */
  version?: string;
  // 插件描述
  desc?: string;
  /** 插件优先级（数字越小越先执行） */
  priority?: number;

  /** 插件初始化（注册时调用一次） */
  install?: (uploader: Uploader, options?: any) => void | Promise<void>;

  // 创建时钩子
  created?: (uploader: Uploader) => void | Promise<void>;
  /** 文件选择后触发 */
  onFileSelect?: (
    file: UploadFile,
    context: PluginContext,
  ) => Promise<UploadFile | void | false> | UploadFile | void;

  /** 上传前触发 */
  beforeUpload?: (
    file: UploadFile,
    context: PluginContext,
  ) => Promise<boolean | void> | boolean | void;

  /** 上传进度触发 */
  onProgress?: (
    percent: number,
    file: UploadFile,
    context: PluginContext,
  ) => void;

  /** 上传成功触发 */
  onSuccess?: (response: any, file: UploadFile, context: PluginContext) => void;

  /** 上传失败触发 */
  onError?: (error: Error, file: UploadFile, context: PluginContext) => void;

  /** 插件销毁时调用 */
  destroy?: () => void;
}
export type PluginConstructor = new (options?: any) => IUploaderPlugin;
interface UploadProgress {
  uploadedBytes: number; // 已上传字节数
  totalBytes: number; // 总字节数
  speed: number; // 上传速度 (bytes/s)
  remainingTime: number; // 预计剩余时间 (秒)
  startTime: number; // 开始时间
  elapsedTime: number; // 已用时间 (秒)
}
/* 文件上传状态类型 */
export interface IFile {
  /* 文件唯一标识符 */
  fileId: string;
  /* 文件访问URL */
  url: string;
  /* 文件名称 */
  fileName: string;
  /* 文件对象 */
  File: File;
  /* 文件上传的进度百分比 */
  percent?: number;
  // 文件上传统计进度信息
  progress?: UploadProgress;
  /* 文件扩展名 */
  extension?: string;
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
  /* 文件上传的索引 */
  index: number;
  /* Uploader 对象 */
  __uploader__?: Uploader;
  /* 文件上传的状态 */
  status?:
    | "pending"
    | "uploading"
    | "paused"
    | "success"
    | "fail"
    | "error"
    | "cancelled"
    | "merging"
    | "hashing";
  uploadSpeed?: UploadSpeedInfo;
}

/* 错误回调函数类型 */
export type ErrorCallBack = (errors: FileUDErrorJSON) => void;

/* 上传前的操作回调函数类型 */
export type BeforeUploadCallBack = (
  file: UploadFile,
) => boolean | Promise<Boolean> | undefined | null;

/* 上传成功回调函数类型 */
export type UploadSuccessCallBack<T> = (response: T, file: UploadFile) => void;

/* 更新回调函数类型 */
export type UpdateCallBack = (file: UploadFile[]) => void;
/* 
初始化回调函数类型
*/
export type onInitChunkCallback = (
  file: UploadFile,
  totalChunks: number,
  fileHash: string,
) => Promise<{
  fileHash: string;
  uploadedChunks?: number[];
  isInstantUpload?: boolean; // ✅ 标记是否为真正的秒传（文件已存在，无需合并）
  shouldRemove?: boolean;    // ✅ 标记是否需要移除该文件（秒传时自动移除）
}>;

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

/* 上传器事件接口 */
export interface UploaderEvents {
  /* 文件列表变化事件 */
  change: (uploadFile: UploadFile) => void;
  /* 选择文件时触发的事件 */
  select: (file: File) => boolean;
  /* 上传进度事件 */
  progress: (percent: number) => void;
  /* 更新事件 */
  update: (uploaderFile: UploaderFile[]) => void;
  /* 错误事件 */
  error: ErrorCallBack;
  /* 暂停上传事件 */
  pause: (file: UploadFile) => void;
  /* 恢复上传事件 */
  resume: (file: UploadFile) => void;
  /* 取消上传事件 */
  cancel: (file: UploadFile) => void;
  /* 重试上传事件 */
  retry: (file: UploadFile) => void;
  /* 移除文件事件 */
  remove: (file: UploadFile) => void;
  /* 文件开始上传事件 */
  "files-start": (files: UploadFile[]) => void;
  /* 文件完成上传事件 */
  "files-complete": (files: UploadFile[]) => void;
  
  // 分片上传相关事件
  /* 分片上传开始事件 */
  "chunk-upload-start": (data: {
    file: UploadFile;
    totalChunks: number;
    chunkSize: number;
  }) => void;
  /* 分片上传成功事件 */
  "chunk-success": (data: {
    chunkIndex: number;
    totalChunks: number;
    completedChunks: number;
    percent: number;
    file: UploadFile;
  }) => void;
  /* 分片上传失败事件 */
  "chunk-error": (data: {
    chunkIndex: number;
    totalChunks: number;
    error: string;
    file: UploadFile;
  }) => void;
  /* 合并开始事件 */
  merging: (data: {
    file: UploadFile;
    completedChunks: number;
    totalChunks: number;
  }) => void;
  /* 合并成功事件 */
  "merge-success": (data: {
    file: UploadFile;
    response?: any;
  }) => void;
  /* 合并失败事件 */
  "merge-error": (data: {
    file: UploadFile;
    error: string;
  }) => void;
  
  /* 秒传成功事件（文件已存在，自动移除） */
  "instant-upload": (data: {
    file: UploadFile;
    reason: string;
  }) => void;
}

/* 事件名称类型 */
export type EventName = keyof UploaderEvents;

/* 事件回调函数类型 */
export type EventCallback<T extends EventName> = UploaderEvents[T];

/**
 * 上传速率统计信息接口
 * 用于描述单个文件或全局的上传速度指标
 */
export interface UploadSpeedInfo {
  /** 当前瞬时速度 (bytes/s) - 基于最近两个采样点计算 */
  currentSpeed: number;

  /** 平均速度 (bytes/s) - 基于总耗时和总字节数计算 */
  averageSpeed: number;

  /** 格式化后的当前速度,如 "15.23 MB/s"、"256 KB/s" */
  currentSpeedFormatted: string;

  /** 格式化后的平均速度,如 "12.45 MB/s"、"128 KB/s" */
  averageSpeedFormatted: string;
}

/**
 * 上传时间统计信息接口
 * 记录文件上传的生命周期时间节点
 */
export interface UploadTimeInfo {
  /** 上传开始时间戳 (毫秒) */
  startTime: number;

  /** 上传结束时间戳 (毫秒),未完成时为 0 */
  endTime: number;

  /** 上传总耗时 (毫秒),未完成时为 0 */
  duration: number;

  /** 格式化后的耗时,如 "5.23s"、"1m 30s" */
  durationFormatted: string;
}
