import { IFile } from "../types";
import Uploader from "../uploader";
import UploadFile from "../uploader/UploadFile";

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

export function getFileExtension(filename: string) {
  const parts = filename && filename.split(".");
  return parts && parts.length > 1 ? parts[parts.length - 1] : "";
}

/**
 * 将文件大小转换为易读的格式
 * @param {number} bytes - 文件大小的字节数
 * @param {number} [decimals=2] - 保留的小数位数，默认为2
 * @returns {string} 转换后的文件大小字符串
 */
export function formatFileSize(bytes: any, decimals = 2) {
  // 转换为数字
  bytes = Number(bytes);

  // 检查是否为有效数字
  if (isNaN(bytes)) return "0 Bytes";
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return (
    parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
  );
}

export const validator = {
  limit(limit: number, length: number) {
    return length < limit;
  },
  size(fileSize: number, maxSize: number) {
    return fileSize <= maxSize;
  },
  type(accept: string[], file: IFile) {
    if (accept.length > 0) {
      return accept.some((acceptType) => {
        // 处理通配符，如 'image/*'
        if (acceptType.endsWith("/*")) {
          const category = acceptType.split("/")[0];
          return file.File.type.startsWith(category);
        }
        // 处理扩展名，如 '.jpg'
        if (acceptType.startsWith(".")) {
          return file.fileName.toLowerCase().endsWith(acceptType.toLowerCase());
        }
        // 处理 MIME 类型
        return file.File.type === acceptType;
      });
    }
    return true;
  },
};

/**
 * 创建响应式的 UploadFile 实例
 * @param uploadFile 原始的 UploadFile 实例
 * @param uploader Uploader 实例
 * @returns Proxy 包装后的 UploadFile
 */
export function createReactiveUploadFile(
  file: UploadFile,
  uploader: Uploader,
): UploadFile {
  // 添加一个内部属性指向 uploader
  Object.defineProperty(file, "__uploader__", {
    value: uploader,
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
        uploader.triggerUpdate();
      }

      return result;
    },
  });
}

/**
 * 从函数中提取路径（提取以 / 开头的字符串）
 * @param fn 函数
 * @returns 提取到的路径，如果没有找到返回 null
 */
export function extractPathFromFunction(str: string): string | null {
  // 匹配以 / 开头的路径（支持单引号、双引号、反引号）
  const pattern = /['"`](\/[^'"`]*)['"`]/;
  const match = str.match(pattern);

  return match ? match[1] : null;
}
