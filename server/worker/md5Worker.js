/**
 * MD5 Worker Thread — 在独立线程中计算文件哈希，避免阻塞主事件循环。
 * 输入: { filePath: string }
 * 输出: { error: string|null, hash: string|null }
 */
const { parentPort } = require("worker_threads");
const fs = require("fs");
const crypto = require("crypto");

parentPort.on("message", ({ filePath }) => {
  if (!filePath) {
    parentPort.postMessage({ error: "缺少 filePath 参数", hash: null });
    return;
  }

  try {
    const hash = crypto.createHash("md5");
    const readStream = fs.createReadStream(filePath, {
      highWaterMark: 2 * 1024 * 1024, // 2MB 缓冲区，减少 syscall 次数
    });

    readStream.on("data", (chunk) => hash.update(chunk));

    readStream.on("end", () => {
      const result = hash.digest("hex");
      parentPort.postMessage({ error: null, hash: result });
    });

    readStream.on("error", (err) => {
      parentPort.postMessage({ error: err.message, hash: null });
    });
  } catch (err) {
    parentPort.postMessage({ error: err.message, hash: null });
  }
});
