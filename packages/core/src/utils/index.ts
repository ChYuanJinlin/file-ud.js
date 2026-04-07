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
    
    // 添加 deleteProperty 陷阱，支持删除操作
    deleteProperty(target, prop) {
      const result = Reflect.deleteProperty(target, prop);
      // 触发更新回调
      uploader.triggerUpdate();
      return result;
    },
  });
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
    return '0 B/s';
  }
  
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unitIndex = 0;
  
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 睡眠工具函数
 * @param ms 毫秒数
 * @returns Promise
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 计算文件的 MD5 哈希值
 * @param file 文件对象
 * @returns MD5 哈希字符串
 */
export async function calculateFileMD5(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunkSize = 2 * 1024 * 1024; // 2MB 分片读取
    const chunks = Math.ceil(file.size / chunkSize);
    let currentChunk = 0;
    
    // 使用 Web Crypto API
    const spark = new SparkMD5.ArrayBuffer();
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      if (e.target?.result) {
        spark.append(e.target.result as ArrayBuffer);
        currentChunk++;

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
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      fileReader.readAsArrayBuffer(file.slice(start, end));
    }

    loadNext();
  });
}

/**
 * 简化的 MD5 实现类（基于 SparkMD5 逻辑）
 */
class SparkMD5 {
  private hex_chr = "0123456789abcdef".split("");
  private rstr2hex(input: string) {
    let output = "";
    for (let i = 0; i < input.length; i++) {
      const x = input.charCodeAt(i);
      output += this.hex_chr[(x >> 4) & 0x0f] + this.hex_chr[x & 0x0f];
    }
    return output;
  }

  private md5cycle(x: number[], k: number[]) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    
    a = this.ff(a, b, c, d, k[0], 7, -680876936);
    d = this.ff(d, a, b, c, k[1], 12, -389564586);
    c = this.ff(c, d, a, b, k[2], 17, 606105819);
    b = this.ff(b, c, d, a, k[3], 22, -1044525330);
    a = this.ff(a, b, c, d, k[4], 7, -176418897);
    d = this.ff(d, a, b, c, k[5], 12, 1200080426);
    c = this.ff(c, d, a, b, k[6], 17, -1473231341);
    b = this.ff(b, c, d, a, k[7], 22, -45705983);
    a = this.ff(a, b, c, d, k[8], 7, 1770035416);
    d = this.ff(d, a, b, c, k[9], 12, -1958414417);
    c = this.ff(c, d, a, b, k[10], 17, -42063);
    b = this.ff(b, c, d, a, k[11], 22, -1990404162);
    a = this.ff(a, b, c, d, k[12], 7, 1804603682);
    d = this.ff(d, a, b, c, k[13], 12, -40341101);
    c = this.ff(c, d, a, b, k[14], 17, -1502002290);
    b = this.ff(b, c, d, a, k[15], 22, 1236535329);
    
    a = this.gg(a, b, c, d, k[1], 5, -165796510);
    d = this.gg(d, a, b, c, k[6], 9, -1069501632);
    c = this.gg(c, d, a, b, k[11], 14, 643717713);
    b = this.gg(b, c, d, a, k[0], 20, -373897302);
    a = this.gg(a, b, c, d, k[5], 5, -701558691);
    d = this.gg(d, a, b, c, k[10], 9, 38016083);
    c = this.gg(c, d, a, b, k[15], 14, -660478335);
    b = this.gg(b, c, d, a, k[4], 20, -405537848);
    a = this.gg(a, b, c, d, k[9], 5, 568446438);
    d = this.gg(d, a, b, c, k[14], 9, -1019803690);
    c = this.gg(c, d, a, b, k[3], 14, -187363961);
    b = this.gg(b, c, d, a, k[8], 20, 1163531501);
    a = this.gg(a, b, c, d, k[13], 5, -1444681467);
    d = this.gg(d, a, b, c, k[2], 9, -51403784);
    c = this.gg(c, d, a, b, k[7], 14, 1735328473);
    b = this.gg(b, c, d, a, k[12], 20, -1926607734);
    
    a = this.hh(a, b, c, d, k[5], 4, -378558);
    d = this.hh(d, a, b, c, k[8], 11, -2022574463);
    c = this.hh(c, d, a, b, k[11], 16, 1839030562);
    b = this.hh(b, c, d, a, k[14], 23, -35309556);
    a = this.hh(a, b, c, d, k[1], 4, -1530992060);
    d = this.hh(d, a, b, c, k[4], 11, 1272893353);
    c = this.hh(c, d, a, b, k[7], 16, -155497632);
    b = this.hh(b, c, d, a, k[10], 23, -1094730640);
    a = this.hh(a, b, c, d, k[13], 4, 681279174);
    d = this.hh(d, a, b, c, k[0], 11, -358537222);
    c = this.hh(c, d, a, b, k[3], 16, -722521979);
    b = this.hh(b, c, d, a, k[6], 23, 76029189);
    a = this.hh(a, b, c, d, k[9], 4, -640364487);
    d = this.hh(d, a, b, c, k[12], 11, -421815835);
    c = this.hh(c, d, a, b, k[15], 16, 530742520);
    b = this.hh(b, c, d, a, k[2], 23, -995338651);
    
    a = this.ii(a, b, c, d, k[0], 6, -198630844);
    d = this.ii(d, a, b, c, k[7], 10, 1126891415);
    c = this.ii(c, d, a, b, k[14], 15, -1416354905);
    b = this.ii(b, c, d, a, k[5], 21, -57434055);
    a = this.ii(a, b, c, d, k[12], 6, 1700485571);
    d = this.ii(d, a, b, c, k[3], 10, -1894986606);
    c = this.ii(c, d, a, b, k[10], 15, -1051523);
    b = this.ii(b, c, d, a, k[1], 21, -2054922799);
    a = this.ii(a, b, c, d, k[8], 6, 1873313359);
    d = this.ii(d, a, b, c, k[15], 10, -30611744);
    c = this.ii(c, d, a, b, k[6], 15, -1560198380);
    b = this.ii(b, c, d, a, k[13], 21, 1309151649);
    a = this.ii(a, b, c, d, k[4], 6, -145523070);
    d = this.ii(d, a, b, c, k[11], 10, -1120210379);
    c = this.ii(c, d, a, b, k[2], 15, 718787259);
    b = this.ii(b, c, d, a, k[9], 21, -343485551);
    
    x[0] = this.add32(a, x[0]);
    x[1] = this.add32(b, x[1]);
    x[2] = this.add32(c, x[2]);
    x[3] = this.add32(d, x[3]);
  }

  private cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = this.add32(this.add32(a, q), this.add32(x, t));
    return this.add32((a << s) | (a >>> (32 - s)), b);
  }

  private ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return this.cmn((b & c) | ((~b) & d), a, b, x, s, t);
  }

  private gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return this.cmn((b & d) | (c & (~d)), a, b, x, s, t);
  }

  private hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return this.cmn(b ^ c ^ d, a, b, x, s, t);
  }

  private ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return this.cmn(c ^ (b | (~d)), a, b, x, s, t);
  }

  private add32(a: number, b: number) {
    return (a + b) & 0xFFFFFFFF;
  }

  private md51(s: string) {
    let n = s.length;
    let state = [1732584193, -271733879, -1732584194, 271733878];
    let i = 64;
    
    for (; i <= n; i += 64) {
      this.md5cycle(state, this.md5blk(s.substring(i - 64, i)));
    }
    
    s = s.substring(i - 64);
    let tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    
    for (let j = 0; j < s.length; j++) {
      tail[j >> 2] |= s.charCodeAt(j) << ((j % 4) << 3);
    }
    
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    
    if (i > 55) {
      this.md5cycle(state, tail);
      for (let k = 0; k < 16; k++) tail[k] = 0;
    }
    
    tail[14] = n * 8;
    this.md5cycle(state, tail);
    
    return state;
  }

  private md5blk(s: string) {
    let md5blks = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + 
                        (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }

  static ArrayBuffer = class {
    private spark: SparkMD5;
    private buff: string;
    
    constructor() {
      this.spark = new SparkMD5();
      this.buff = "";
    }
    
    append(arrBuffer: ArrayBuffer) {
      const bytes = new Uint8Array(arrBuffer);
      for (let i = 0; i < bytes.length; i++) {
        this.buff += String.fromCharCode(bytes[i]);
      }
      return this;
    }
    
    end() {
      return this.spark.rstr2hex(this.spark.md51(this.buff).map((x) => {
        let v = x.toString(16);
        while (v.length < 8) v = "0" + v;
        return v;
      }).join(""));
    }
  };
}
