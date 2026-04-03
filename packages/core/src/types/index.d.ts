import { FileUDError } from "../fileUD/errors";
import Uploader from "../uploader";
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
  retries?: number;
  /* 重试延迟 */
  retryDelay?: number;
  /* 超时时间 */
  timeout?: number;
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
  action: string | (() => Promise<any>);
  /* 上传文件的数量限制 */
  limit?: number;
  /* 上传文件限制的大小 */
  maxSize?: number;
  /* 上传请求的头部信息 */
  headers?: Record<string, any>;
  /* 上传文件标识 */
  file: string | ((this: UploadFile, formData: FormData) => void);
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
  /* 文件扩展名 */
  extension?: string;
  /* 
  loading 状态
  */
  loading?: boolean;
  /* 文件大小 */
  formatSize?: string;
  /* 取消请求上传方法 */
  abort?: () => void;
  /* 是否在重试中 */
  retry?: boolean;
  /* 文件上传的索引 */
  index: number;
  /* Uploader 对象 */
  __uploader__?: Uploader;
  /* 文件上传的状态 */
  status?: "pending" | "uploading" | "success" | "error" | "cancelled";
}

/* 错误回调函数类型 */
export type ErrorCallBack = (errors: FileUDErrorJSON) => void;

/* 上传前的操作回调函数类型 */
export type BeforeUploadCallBack = (
  this: Uploader,
  file: UploadFile,
) => boolean | Promise<Boolean> | undefined | null;

/* 上传成功回调函数类型 */
export type UploadSuccessCallBack<T> = (response: T, file: UploadFile) => void;

/* 更新回调函数类型 */
export type UpdateCallBack = (file: UploadFile[]) => void;
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
  pause: (file: FileWithMeta) => void;
  /* 恢复上传事件 */
  resume: (file: FileWithMeta) => void;
  /* 取消上传事件 */
  cancel: (file: FileWithMeta) => void;
  /* 重试上传事件 */
  retry: (file: FileWithMeta) => void;
  remove: (uploadFile: UploadFile) => void;
  /* 批量开始上传事件 */
  "batch-start": (files: FileWithMeta[]) => void;
  /* 批量完成上传事件 */
  "batch-complete": (files: FileWithMeta[]) => void;
  /* 队列变化事件 */
  "queue-change": (queue: FileWithMeta[]) => void;
  /* 插件错误事件 */
  "plugin-error": (errorObj: {
    plugin: string;
    hook: string;
    error: unknown;
  }) => void;
}

/* 事件名称类型 */
export type EventName = keyof UploaderEvents;

/* 事件回调函数类型 */
export type EventCallback<T extends EventName> = UploaderEvents[T];
