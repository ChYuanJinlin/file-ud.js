/**
 * Web Worker 内联 MD5 计算 — 将 CPU 密集型哈希计算移出主线程，避免 UI 卡顿。
 *
 * 策略：
 *  - 文件 ≤ 50MB：通过 Blob URL Worker 异步计算，主线程零阻塞
 *  - 文件 > 50MB 或 Worker 不可用：回退到主线程 SparkMD5 流式计算
 *  - 小文件 (<5MB)：直接用主线程，省去 Worker 创建开销
 */

// ---- 内联 MD5 实现（RFC 1321，纯 JS，无依赖）----

const MD5_IMPL = `
function md5(data) {
  function rotateLeft(v, n) { return (v << n) | (v >>> (32 - n)); }
  function addUnsigned(x, y) { return ((x & 0x7fffffff) + (y & 0x7fffffff)) ^ (x & 0x80000000) ^ (y & 0x80000000); }

  var F = function(x,y,z) { return (x & y) | ((~x) & z); };
  var G = function(x,y,z) { return (x & z) | (y & (~z)); };
  var H = function(x,y,z) { return x ^ y ^ z; };
  var I = function(x,y,z) { return y ^ (x | (~z)); };

  function transform(func, a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(func(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  // Convert string/array to word array
  var len = data.length;
  var words = [];
  for (var i = 0; i < len; i++) {
    words[i >> 2] |= data[i] << ((i % 4) * 8);
  }
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[(((len + 8) >>> 6) << 4) + 14] = len * 8;

  var a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;

  for (var i = 0; i < words.length; i += 16) {
    var oldA = a, oldB = b, oldC = c, oldD = d;
    // Round 1
    a = transform(F, a, b, c, d, words[i+0],  7, 0xd76aa478);
    d = transform(F, d, a, b, c, words[i+1], 12, 0xe8c7b756);
    c = transform(F, c, d, a, b, words[i+2], 17, 0x242070db);
    b = transform(F, b, c, d, a, words[i+3], 22, 0xc1bdceee);
    a = transform(F, a, b, c, d, words[i+4],  7, 0xf57c0faf);
    d = transform(F, d, a, b, c, words[i+5], 12, 0x4787c62a);
    c = transform(F, c, d, a, b, words[i+6], 17, 0xa8304613);
    b = transform(F, b, c, d, a, words[i+7], 22, 0xfd469501);
    a = transform(F, a, b, c, d, words[i+8],  7, 0x698098d8);
    d = transform(F, d, a, b, c, words[i+9], 12, 0x8b44f7af);
    c = transform(F, c, d, a, b, words[i+10],17, 0xffff5bb1);
    b = transform(F, b, c, d, a, words[i+11],22, 0x895cd7be);
    a = transform(F, a, b, c, d, words[i+12], 7, 0x6b901122);
    d = transform(F, d, a, b, c, words[i+13],12, 0xfd987193);
    c = transform(F, c, d, a, b, words[i+14],17, 0xa679438e);
    b = transform(F, b, c, d, a, words[i+15],22, 0x49b40821);
    // Round 2
    a = transform(G, a, b, c, d, words[i+1],  5, 0xf61e2562);
    d = transform(G, d, a, b, c, words[i+6],  9, 0xc040b340);
    c = transform(G, c, d, a, b, words[i+11],14, 0x265e5a51);
    b = transform(G, b, c, d, a, words[i+0], 20, 0xe9b6c7aa);
    a = transform(G, a, b, c, d, words[i+5],  5, 0xd62f105d);
    d = transform(G, d, a, b, c, words[i+10], 9, 0x02441453);
    c = transform(G, c, d, a, b, words[i+15],14, 0xd8a1e681);
    b = transform(G, b, c, d, a, words[i+4], 20, 0xe7d3fbc8);
    a = transform(G, a, b, c, d, words[i+9],  5, 0x21e1cde6);
    d = transform(G, d, a, b, c, words[i+14], 9, 0xc33707d6);
    c = transform(G, c, d, a, b, words[i+3], 14, 0xf4d50d87);
    b = transform(G, b, c, d, a, words[i+8], 20, 0x455a14ed);
    a = transform(G, a, b, c, d, words[i+13], 5, 0xa9e3e905);
    d = transform(G, d, a, b, c, words[i+2],  9, 0xfcefa3f8);
    c = transform(G, c, d, a, b, words[i+7], 14, 0x676f02d9);
    b = transform(G, b, c, d, a, words[i+12],20, 0x8d2a4c8a);
    // Round 3
    a = transform(H, a, b, c, d, words[i+5],  4, 0xfffa3942);
    d = transform(H, d, a, b, c, words[i+8], 11, 0x8771f681);
    c = transform(H, c, d, a, b, words[i+11],16, 0x6d9d6122);
    b = transform(H, b, c, d, a, words[i+14],23, 0xfde5380c);
    a = transform(H, a, b, c, d, words[i+1],  4, 0xa4beea44);
    d = transform(H, d, a, b, c, words[i+4], 11, 0x4bdecfa9);
    c = transform(H, c, d, a, b, words[i+7], 16, 0xf6bb4b60);
    b = transform(H, b, c, d, a, words[i+10],23, 0xbebfbc70);
    a = transform(H, a, b, c, d, words[i+13], 4, 0x289b7ec6);
    d = transform(H, d, a, b, c, words[i+0], 11, 0xeaa127fa);
    c = transform(H, c, d, a, b, words[i+3], 16, 0xd4ef3085);
    b = transform(H, b, c, d, a, words[i+6], 23, 0x04881d05);
    a = transform(H, a, b, c, d, words[i+9],  4, 0xd9d4d039);
    d = transform(H, d, a, b, c, words[i+12],11, 0xe6db99e5);
    c = transform(H, c, d, a, b, words[i+15],16, 0x1fa27cf8);
    b = transform(H, b, c, d, a, words[i+2], 23, 0xc4ac5665);
    // Round 4
    a = transform(I, a, b, c, d, words[i+0],  6, 0xf4292244);
    d = transform(I, d, a, b, c, words[i+7], 10, 0x432aff97);
    c = transform(I, c, d, a, b, words[i+14],15, 0xab9423a7);
    b = transform(I, b, c, d, a, words[i+5], 21, 0xfc93a039);
    a = transform(I, a, b, c, d, words[i+12], 6, 0x655b59c3);
    d = transform(I, d, a, b, c, words[i+3], 10, 0x8f0ccc92);
    c = transform(I, c, d, a, b, words[i+10],15, 0xffeff47d);
    b = transform(I, b, c, d, a, words[i+1], 21, 0x85845dd1);
    a = transform(I, a, b, c, d, words[i+8],  6, 0x6fa87e4f);
    d = transform(I, d, a, b, c, words[i+15],10, 0xfe2ce6e0);
    c = transform(I, c, d, a, b, words[i+6], 15, 0xa3014314);
    b = transform(I, b, c, d, a, words[i+13],21, 0x4e0811a1);
    a = transform(I, a, b, c, d, words[i+4],  6, 0xf7537e82);
    d = transform(I, d, a, b, c, words[i+11],10, 0xbd3af235);
    c = transform(I, c, d, a, b, words[i+2], 15, 0x2ad7d2bb);
    b = transform(I, b, c, d, a, words[i+9], 21, 0xeb86d391);
    a = addUnsigned(a, oldA);
    b = addUnsigned(b, oldB);
    c = addUnsigned(c, oldC);
    d = addUnsigned(d, oldD);
  }

  function toHex(v) {
    var h = ''; for (var j = 0; j < 4; j++) h += ((v >> (j * 8)) & 0xff).toString(16).padStart(2, '0'); return h;
  }
  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

self.onmessage = async function(e) {
  try {
    var fileBuffer = e.data.fileBuffer;
    var hash = md5(new Uint8Array(fileBuffer));
    self.postMessage({ error: null, hash: hash });
  } catch (err) {
    self.postMessage({ error: err.message, hash: null });
  }
};
`;

// ---- Worker 创建与管理 ----

/** 已缓存的 Blob URL，避免每次调用都创建新 URL */
let _workerBlobUrl: string | null = null;

function getWorkerBlobUrl(): string {
  if (!_workerBlobUrl) {
    const blob = new Blob([MD5_IMPL], { type: "text/javascript" });
    _workerBlobUrl = URL.createObjectURL(blob);
  }
  return _workerBlobUrl;
}

/**
 * 使用 Web Worker 异步计算文件 MD5。
 *
 * 仅在上传端使用（有 File 对象时）；下载端正用此函数的地方
 * 传入的是 FileSystemFileHandle.getFile() 返回的 File，同样可用。
 *
 * @returns MD5 hex 字符串
 */
export async function calculateFileMD5InWorker(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const WORKER_TIMEOUT_MS = 60_000; // 1 分钟超时

  return new Promise((resolve, reject) => {
    // 1. 读取文件为 ArrayBuffer（在 Worker 外部，因为 FileReader 在主线程更快）
    const reader = new FileReader();

    const abortHandler = () => {
      reader.abort();
      reject(new Error("MD5 计算已取消"));
    };

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    reader.onload = () => {
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }

      const fileBuffer = reader.result as ArrayBuffer;

      // 2. 创建 Worker
      const workerUrl = getWorkerBlobUrl();
      const worker = new Worker(workerUrl);

      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("MD5 Worker 计算超时"));
      }, WORKER_TIMEOUT_MS);

      worker.onmessage = (e: MessageEvent<{ error: string | null; hash: string | null }>) => {
        clearTimeout(timeout);
        worker.terminate();
        const { error, hash } = e.data;
        if (error) {
          reject(new Error(error));
        } else {
          resolve(hash!);
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(err.message || "MD5 Worker 异常"));
      };

      // 3. 将 ArrayBuffer 转移给 Worker（零拷贝）
      worker.postMessage({ fileBuffer }, [fileBuffer]);
    };

    reader.onerror = () => {
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
      reject(new Error("文件读取失败"));
    };

    // 一次性读取整个文件（已由调用方保证 ≤50MB）
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 全局清理：释放缓存的 Blob URL（SPA 卸载时调用）
 */
export function disposeMD5Worker(): void {
  if (_workerBlobUrl) {
    URL.revokeObjectURL(_workerBlobUrl);
    _workerBlobUrl = null;
  }
}
