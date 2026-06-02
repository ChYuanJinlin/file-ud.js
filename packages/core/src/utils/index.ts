import Downloader from "../downloader";
import DownloadFile from "../downloader/DownloadFile";
import Transfer from "../transfer/Transfer";
import TransferFile from "../transfer/TransferFile";
import { IFile, TimeInfo } from "../types";
import Uploader from "../uploader";
import UploadFile from "../uploader/UploadFile";
import SparkMD5 from "spark-md5";
// 导出日志工具
export {
  logger,
  initLogger,
  setLogLevel,
  LogLevel,
  addLogCollector,
  clearLogCollectors,
} from "./logger";
export type { LoggerOptions, LogEntry, LogCollectorCallback } from "./logger";

// ✅ 导出文件缓存工具
export {
  saveFileToCache,
  restoreFileFromCache,
  removeFileFromCache,
  clearAllFileCache,
  getCacheStats,
  cleanExpiredCache,
} from "./fileCache";

// 导出上传监控工具
export { uploadMonitor } from "./upload-monitor";
export type { UploadStats, UploadRecord } from "./upload-monitor";

// ✅ 导出网络检查工具
export {
  checkNetworkStatus,
  checkNetworkConnectivity,
  watchNetworkStatus,
} from "./network";
export type { NetworkCheckResult } from "./network";

export function generateFileId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `file_${timestamp}_${random}`;
}

export function mergeObjects<T extends Record<string, any>>(
  target: T,
  source?: Partial<T>,
): T {
  // Type checking for target
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("Target must be a valid object");
  }

  // Type checking for source (allow undefined/null)
  if (source && (typeof source !== "object" || Array.isArray(source))) {
    throw new TypeError("Source must be an object, undefined, or null");
  }

  // If source is empty, return shallow copy of target
  if (!source) {
    return { ...target };
  }

  // Perform shallow merge
  return { ...target, ...source };
}

export function handleFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 10 * 1024 * 1024) {
      try {
        resolve(URL.createObjectURL(file));
      } catch (error: any) {
        reject(new Error(`创建Object URL失败: ${error.message}`));
      }
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target?.result as string);
      };
      reader.onerror = () => {
        reject(new Error("文件读取错误"));
      };

      reader.onabort = () => {
        reject(new Error("文件读取被中止"));
      };
      reader.readAsDataURL(file);
    }
  });
}

export function computeTransferTime(transferTime: TimeInfo) {
  return {
    start() {
      // 记录全局上传开始时间
      const now = Date.now();
      // ✅ 直接修改对象属性，而不是重新赋值引用
      transferTime.startTime = now;
      transferTime.endTime = 0;
      transferTime.duration = 0;
      transferTime.durationFormatted = "0s";
    },
    end() {
      // 记录上传结束时间并计算持续时间
      const endTime = Date.now();
      const duration = endTime - transferTime.startTime;
      // ✅ 直接修改对象属性，而不是重新赋值引用
      transferTime.endTime = endTime;
      transferTime.duration = duration;
      transferTime.durationFormatted = formatDuration(duration);
    },
  };
}

export function getFileExtension(filename?: string) {
  const parts = filename && filename?.split(".");
  return parts && parts.length > 1 ? parts[parts.length - 1] : "";
}

/**
 * 判断文件是否处于活跃上传状态（统一判断逻辑）
 * @param file 文件实例
 * @returns 是否为活跃上传状态
 * @private
 */
export function isFileActive(file: TransferFile): boolean {
  return ["UDLoading", "paused", "fail", "merging"].includes(file.status!);
}
/**
 * 将文件大小转换为易读的格式
 * @param {number} bytes - 文件大小的字节数
 * @param {number} [decimals=2] - 保留的小数位数，默认为2
 * @returns {string} 转换后的文件大小字符串
 */
export function formatFileSize(bytes: any, decimals = 2) {
  // ✅ 防御性检查：处理 undefined、null、NaN 等情况
  if (bytes === null || bytes === undefined || isNaN(Number(bytes))) {
    return "0 B";
  }

  // 转换为数字
  bytes = Number(bytes);

  // 检查是否为有效数字
  if (isNaN(bytes)) return "0 B";
  if (bytes === 0) return "0 B";

  // ✅ 处理负数情况（理论上不应该出现，但做防御性编程）
  if (bytes < 0) {
    console.warn("formatFileSize: 接收到负数值", bytes);
    return "0 B";
  }

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  // ✅ 关键修复：去掉 parseFloat()，保留 toFixed() 的精度
  // parseFloat("1.90") → 1.9  ← 会去掉末尾的 0，导致精度不一致
  return (bytes / Math.pow(k, i)).toFixed(decimals) + " " + sizes[i];
}

export const validator = {
  limit(limit: number, length: number) {
    return length < limit;
  },
  size(fileSize: number, maxSize: number) {
    return fileSize <= maxSize;
  },
  type(accept: string[], file: TransferFile) {
    if (accept.length > 0) {
      return accept.some((acceptType) => {
        // 处理通配符，如 'image/*'
        if (acceptType.endsWith("/*")) {
          const category = acceptType.split("/")[0];
          return file.File?.type.startsWith(category);
        }
        // 处理扩展名，如 '.jpg'
        if (acceptType.startsWith(".")) {
          return file.fileName.toLowerCase().endsWith(acceptType.toLowerCase());
        }
        // 处理 MIME 类型
        return file.File?.type === acceptType;
      });
    }
    return true;
  },
};

/**
 * 创建响应式文件实例的通用工厂函数
 * @param file 原始的文件实例（UploadFile 或 DownloadFile）
 * @param manager 管理器实例（Uploader 或 Downloader）
 * @param managerKey 管理器在文件上的属性名（'transfer' 或 '__downloader__'）
 * @returns Proxy 包装后的文件实例
 */
function createReactiveFile<
  T extends object,
  M extends { triggerUpdate: () => void },
>(file: T, manager: M): T {
  // 添加一个内部属性指向管理器
  Object.defineProperty(file, "transfer", {
    value: manager,
    enumerable: false, // 不可枚举，避免循环引用
    writable: false,
    configurable: false,
  });

  return new Proxy(file, {
    get(target, prop, receiver) {
      // 获取属性值
      const value = Reflect.get(target, prop, receiver);

      // 如果是函数，需要绑定 this 并包装
      if (typeof value === "function") {
        return function (...args: any[]) {
          const result = value.apply(target, args);
          return result;
        };
      }

      return value;
    },

    set(target, prop, value, receiver) {
      // 获取旧值
      const oldValue = Reflect.get(target, prop, receiver);

      // 设置新值
      const result = Reflect.set(target, prop, value, receiver);

      // 如果值真的变化了，触发更新
      if (oldValue !== value) {
        // 触发 update 回调（使用防抖优化）
        manager.triggerUpdate();
      }

      return result;
    },

    // 添加 deleteProperty 陷阱，支持删除操作
    deleteProperty(target, prop) {
      const result = Reflect.deleteProperty(target, prop);
      // 触发更新回调
      manager.triggerUpdate();
      return result;
    },
  }) as T;
}

/**
 * 创建响应式的 UploadFile 实例
 * @param uploadFile 原始的 UploadFile 实例
 * @param uploader Uploader 实例
 * @returns Proxy 包装后的 UploadFile
 */
export function createReactiveUploadFile(
  file: UploadFile,
  uploader: Transfer,
): UploadFile {
  return createReactiveFile(file, uploader);
}

/**
 * 创建响应式的 DownloadFile 实例
 * @param file 原始的 DownloadFile 实例
 * @param downloader Downloader 实例
 * @returns Proxy 包装后的 DownloadFile
 */
export function createReactiveDownloadFile(
  file: DownloadFile,
  downloader: Transfer,
): DownloadFile {
  return createReactiveFile(file, downloader);
}

/**
 * 提取函数中的路径
 * @param str 函数字符串
 * @returns 提取到的路径，如果没有找到返回 null
 */
export function extractPathFromFunction(str: string): string | null {
  // 匹配以 / 开头的路径（支持单引号、双引号、反引号）
  const pattern = /['"`](\/[^'"`]*)['"`]/;
  const match = str.match(pattern);

  return match ? match[1] : null;
}

/**
 * 格式化上传/下载速度显示
 * @param bytesPerSecond 每秒字节数
 * @returns 格式化后的速度字符串
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) {
    return "0 B/s";
  }

  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bytesPerSecond;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 格式化时间 duration 显示
 * @param milliseconds 毫秒数
 * @returns 格式化后的时间字符串
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds === 0) {
    return "0s";
  }

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * 睡眠工具函数
 * @param ms 毫秒数
 * @returns Promise
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 计算文件的 MD5 哈希值
 * @param file 文件对象
 * @param onProgress 可选的进度回调函数，接收当前进度百分比 (0-100)
 * @returns MD5 哈希字符串
 */
export async function calculateFileMD5(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal, // ✅ 新增：支持中断信号
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const chunkSize = 2 * 1024 * 1024; // 2MB 分片读取
      const chunks = Math.ceil(file.size / chunkSize);
      let currentChunk = 0;

      const spark = new SparkMD5.ArrayBuffer();
      const fileReader = new FileReader();

      // ✅ 监听中断信号
      if (signal) {
        signal.addEventListener("abort", () => {
          fileReader.abort(); // 中止文件读取
          reject(new Error("MD5 计算已取消"));
        });
      }

      fileReader.onload = (e) => {
        // ✅ 每次读取前检查是否已取消
        if (signal?.aborted) {
          fileReader.abort();
          reject(new Error("MD5 计算已取消"));
          return;
        }

        if (e.target?.result) {
          spark.append(e.target.result as ArrayBuffer);
          currentChunk++;

          // 触发进度回调
          if (onProgress) {
            const percent = Math.round((currentChunk / chunks) * 100);
            onProgress(percent);
          }

          if (currentChunk < chunks) {
            loadNext();
          } else {
            resolve(spark.end());
          }
        }
      };

      fileReader.onerror = () => {
        reject(new Error("文件读取失败"));
      };

      function loadNext() {
        // ✅ 加载下一个分片前检查是否已取消
        if (signal?.aborted) {
          reject(new Error("MD5 计算已取消"));
          return;
        }

        const start = currentChunk * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        fileReader.readAsArrayBuffer(file.slice(start, end));
      }

      loadNext();
    } catch (error) {
      console.error("MD5 计算库加载失败:", error);
      reject(new Error("MD5 计算库加载失败"));
    }
  });
}
