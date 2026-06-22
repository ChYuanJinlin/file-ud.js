const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { Worker } = require("worker_threads");
const app = express();
const cors = require("cors");

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({ dest: "uploads/" });
const uploadSingle = multer({ storage: storage });

// 目录定义
const UPLOAD_DIR = path.join(__dirname, "uploads");
const TASK_DIR = path.join(UPLOAD_DIR, "tasks");
const DEDUP_DIR = path.join(UPLOAD_DIR, "dedup");

// 确保所有目录存在
[UPLOAD_DIR, TASK_DIR, DEDUP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// 🔧 动态构建完整 URL（避免硬编码 localhost:3000）
function buildUrl(req, path) {
  const protocol = req.protocol || "http";
  const host = req.get("host") || "localhost:3000";
  return `${protocol}://${host}${path}`;
}

// 🔧 使用 Worker Thread 异步计算文件 MD5，避免阻塞事件循环
const WORKER_TIMEOUT_MS = 120_000; // 2 分钟超时（大文件 MD5 可能较长）
function calculateFileMD5(filePath) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "worker", "md5Worker.js");

    // Worker Thread 模块文件不存在 → 回退到主线程计算
    if (!fs.existsSync(workerPath)) {
      const crypto = require("crypto");
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", (err) => reject(err));
      return;
    }

    const worker = new Worker(workerPath);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("MD5 Worker 计算超时"));
    }, WORKER_TIMEOUT_MS);

    worker.on("message", ({ error, hash }) => {
      clearTimeout(timeout);
      worker.terminate();
      if (error) {
        reject(new Error(error));
      } else {
        resolve(hash);
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(err);
    });

    worker.postMessage({ filePath });
  });
}

app.use(express.json());
app.use(cors());

// ============================================
// 1. 秒传检查接口（适配前端逻辑）
// ============================================
app.post("/check-file", async (req, res) => {
  const { fileHash, fileName, fileSize, totalChunks } = req.body;

  console.log("🔍 check-file 请求:", { fileHash, fileName, totalChunks });

  if (!fileHash) {
    return res.status(400).json({
      success: false,
      message: "缺少文件哈希值",
    });
  }

  // 1. 检查是否已有完整文件（秒传）
  const dedupRecordPath = path.join(DEDUP_DIR, `${fileHash}.json`);

  if (fs.existsSync(dedupRecordPath)) {
    const fileInfo = JSON.parse(fs.readFileSync(dedupRecordPath, "utf-8"));
    console.log(`⚡ 秒传成功: ${fileName} (hash: ${fileHash})`);

    // ✅ 适配前端：返回 isInstantUpload = true
    return res.json({
      success: true,
      data: {
        exists: true,
        isInstantUpload: true, // 前端需要这个字段
        canReuseChunks: false,
        fileHash: fileHash,
        fileInfo: {
          fileName: fileInfo.fileName,
          fileHash: fileInfo.fileHash,
          fileSize: fileInfo.fileSize,
          url: fileInfo.url,
        },
        chunks: totalChunks
          ? Array.from({ length: totalChunks }, (_, i) => i)
          : [],
        totalChunks: totalChunks || 0,
      },
    });
  }

  // ===== 下载场景回退：按 fileName 查找 dedup 记录 =====
  // 下载端首次调用时 fileHash = computeFileIdentifier() = fileName-fileSize（非真实 MD5），
  // 需要按 fileName 匹配 dedup 记录，返回真实 MD5。之后客户端会缓存真实 MD5 到 this.fileHash
  if (fileName && fs.existsSync(DEDUP_DIR)) {
    try {
      const dedupFiles = fs.readdirSync(DEDUP_DIR).filter((f) =>
        f.endsWith(".json"),
      );
      console.log(
        `🔍 fileName 回退扫描: DEDUP_DIR 中有 ${dedupFiles.length} 个 .json 文件`,
        { dedupFiles, targetName: fileName },
      );
      for (const df of dedupFiles) {
        const recordPath = path.join(DEDUP_DIR, df);
        try {
          const record = JSON.parse(fs.readFileSync(recordPath, "utf-8"));
          console.log(
            `   📄 检查 dedup 记录: ${df}, record.fileName="${record.fileName}", record.originalFileName="${record.originalFileName}"`,
          );
          if (
            record.fileName === fileName ||
            record.originalFileName === fileName
          ) {
            // 如果有 fileSize 参数，验证一致性
            if (fileSize && record.fileSize !== parseInt(fileSize)) {
              console.log(
                `   ⚠️ fileSize 不匹配: record.fileSize=${record.fileSize} vs request.fileSize=${fileSize}`,
              );
              continue;
            }
            const realFileHash = record.fileHash || path.basename(df, ".json");
            console.log(
              `🔗 通过 fileName 匹配到 dedup 记录: ${fileName} → realHash=${realFileHash}`,
            );

            return res.json({
              success: true,
              data: {
                exists: true,
                isInstantUpload: true,
                // ⚠️ 不设 isInstantDownload，由客户端做磁盘+哈希验证后自行判断秒下
                canReuseChunks: false,
                fileHash: realFileHash, // 🔑 返回真实 MD5，供客户端做哈希校验
                fileInfo: {
                  fileName: record.fileName,
                  fileHash: record.fileHash,
                  fileSize: record.fileSize,
                  url: record.url,
                },
                chunks: totalChunks
                  ? Array.from({ length: totalChunks }, (_, i) => i)
                  : [],
                totalChunks: totalChunks || 0,
              },
            });
          }
        } catch (_) {
          // 单条记录读取失败，继续检查下一条
        }
      }
      console.log(`   ❌ fileName 回退未匹配到任何 dedup 记录, target="${fileName}"`);
    } catch (_) {
      // dedup 目录扫描失败，继续原有逻辑
      console.error("   ❌ DEDUP_DIR 扫描异常:", _);
    }
  } else {
    console.log(
      `🔍 跳过 fileName 回退: fileName="${fileName}", DEDUP_DIR exists=${fs.existsSync(DEDUP_DIR)}`,
    );
  }

  // ===== 下载场景兜底：按磁盘文件直接查找 =====
  // 如果 dedup 记录不存在（文件可能是直接放在 uploads 目录下的），
  // 直接检查磁盘是否存在同名文件，存在则返回 exists: true
  if (fileName) {
    const fileOnDisk = path.join(UPLOAD_DIR, fileName);
    if (fs.existsSync(fileOnDisk)) {
      const diskStats = fs.statSync(fileOnDisk);
      console.log(
        `💾 磁盘文件兜底: 找到文件 ${fileName}, size=${diskStats.size} bytes`,
      );

      // 如果有 fileSize 参数，验证一致性（仅警告，不阻断返回）
      if (fileSize && diskStats.size !== parseInt(fileSize)) {
        console.log(
          `   ⚠️ 磁盘文件大小不匹配: disk=${diskStats.size} vs request=${fileSize}，但仍返回 exists: true`,
        );
      }

      // 🔑 尝试读取 dedup 记录获取真实 MD5（用于 IndexedDB key 一致性）
      let realFileHash = fileHash;
      let realMD5Found = false;
      if (fs.existsSync(DEDUP_DIR)) {
        try {
          const dedupFiles = fs.readdirSync(DEDUP_DIR).filter((f) => f.endsWith(".json"));
          for (const df of dedupFiles) {
            try {
              const record = JSON.parse(fs.readFileSync(path.join(DEDUP_DIR, df), "utf-8"));
              if (record.fileName === fileName && record.fileHash && /^[a-f0-9]{32}$/i.test(record.fileHash)) {
                realFileHash = record.fileHash;
                realMD5Found = true;
                console.log(`   🔑 从 dedup 记录获取真实 MD5: ${realFileHash}`);
                break;
              }
            } catch (_) {}
          }
        } catch (_) {}
      }

      // 🔑 如无 dedup 记录中包含真实 MD5，使用 Worker Thread 异步计算并缓存
      if (!realMD5Found) {
        const MAX_MD5_SIZE = 100 * 1024 * 1024; // >100MB 跳过 MD5
        if (diskStats.size <= MAX_MD5_SIZE) {
          try {
            realFileHash = await calculateFileMD5(fileOnDisk);
            realMD5Found = true;
            console.log(`   🔑 计算磁盘文件真实 MD5: ${realFileHash}`);

            // 缓存为 dedup 记录，后续请求直接复用
            const dedupRecord = {
              fileName: fileName,
              originalFileName: fileName,
              fileHash: realFileHash,
              fileSize: diskStats.size,
              url: `/uploads/${encodeURIComponent(fileName)}`,
              createdAt: Date.now(),
            };
            fs.writeFileSync(
              path.join(DEDUP_DIR, `${realFileHash}.json`),
              JSON.stringify(dedupRecord, null, 2),
            );
            console.log(`   💾 已缓存 dedup 记录: ${realFileHash}`);
          } catch (md5Err) {
            console.log(`   ⚠️ 计算磁盘文件 MD5 失败: ${md5Err.message}，使用请求中的 fileHash 兜底`);
          }
        } else {
          console.log(`   ⚠️ 文件过大(${(diskStats.size / 1024 / 1024).toFixed(0)}MB)，跳过 MD5 计算，使用请求中的 fileHash 兜底`);
        }
      }

      return res.json({
        success: true,
        data: {
          exists: true,
          isInstantUpload: false,
          isInstantDownload: false,
          canReuseChunks: false,
          // 🔑 优先返回真实 MD5（可以匹配 dedup 记录），兜底用请求 hash
          fileHash: realFileHash,
          fileInfo: {
            fileName: fileName,
            fileHash: realFileHash,
            fileSize: diskStats.size,
            url: `/uploads/${encodeURIComponent(fileName)}`,
          },
          chunks: totalChunks
            ? Array.from({ length: totalChunks }, (_, i) => i)
            : [],
          totalChunks: totalChunks || 0,
        },
      });
    }
  }

  // 2. 检查是否有未完成的上传任务（分片可复用）
  let existingChunks = [];
  let hasTask = false;

  const taskRecordPath = path.join(TASK_DIR, `${fileHash}.json`);
  if (fs.existsSync(taskRecordPath)) {
    try {
      const taskInfo = JSON.parse(fs.readFileSync(taskRecordPath, "utf-8"));
      existingChunks = taskInfo.chunks || [];
      hasTask = true;
      console.log(
        `🔄 发现未完成上传: ${taskInfo.fileName}，已上传 ${existingChunks.length}/${taskInfo.totalChunks} 分片`,
      );
    } catch (error) {
      console.error("读取任务记录失败:", error);
    }
  } else {
    // 检查物理分片文件（可能没有任务记录但有残留分片）
    for (let i = 0; i < (totalChunks || 100); i++) {
      const chunkPath = path.join(UPLOAD_DIR, `chunk_${fileHash}_${i}`);
      if (fs.existsSync(chunkPath)) {
        existingChunks.push(i);
      } else {
        break;
      }
    }

    if (existingChunks.length > 0) {
      console.log(`🔄 发现残留分片: ${existingChunks.length}/${totalChunks}`);
    }
  }

  // 3. 判断是否可复用分片（有分片但文件未完成）
  const canReuseChunks = existingChunks.length > 0;

  if (canReuseChunks) {
    console.log(
      `🔄 分片可复用: ${existingChunks.length}/${totalChunks} 分片已存在`,
    );
    console.log(`   已上传分片索引:`, existingChunks);

    // ✅ 适配前端：返回 canReuseChunks = true
    return res.json({
      success: true,
      data: {
        exists: false,
        isInstantUpload: false,
        canReuseChunks: true, // 前端需要这个字段
        fileHash: fileHash,
        chunks: existingChunks,
        totalChunks: totalChunks || 0,
      },
    });
  }

  // 4. 新文件，需要上传所有分片
  console.log(`📝 新文件: ${fileName} (hash: ${fileHash})，需要上传所有分片`);

  // 如果已有任务记录但没有分片，清理任务记录
  if (hasTask && existingChunks.length === 0) {
    try {
      fs.unlinkSync(taskRecordPath);
      console.log(`   🗑️ 清理无效任务记录`);
    } catch (error) {
      console.error("清理任务记录失败:", error);
    }
  }

  res.json({
    success: true,
    data: {
      exists: false,
      isInstantUpload: false,
      canReuseChunks: false,
      fileHash: fileHash,
      chunks: [],
      totalChunks: totalChunks || 0,
    },
  });
});

// ============================================
// 2. 获取已上传分片列表
// ============================================
app.get("/get-uploaded-chunks", (req, res) => {
  const { fileHash } = req.query;

  if (!fileHash) {
    return res.status(400).json({
      success: false,
      message: "缺少文件哈希值",
    });
  }

  const taskFile = path.join(TASK_DIR, `${fileHash}.json`);

  if (!fs.existsSync(taskFile)) {
    return res.json({
      success: true,
      data: {
        fileHash,
        chunks: [],
        totalChunks: 0,
      },
    });
  }

  try {
    const taskInfo = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
    console.log(
      `📂 断点续传: ${taskInfo.fileName} (已上传: ${taskInfo.chunks.length}/${taskInfo.totalChunks})`,
    );

    res.json({
      success: true,
      data: {
        fileHash,
        fileName: taskInfo.fileName,
        totalChunks: taskInfo.totalChunks,
        chunks: taskInfo.chunks,
        chunkSize: taskInfo.chunkSize,
        fileSize: taskInfo.fileSize,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "读取上传记录失败",
      error: error.message,
    });
  }
});

// ============================================
// 3. 创建上传任务
// ============================================
app.post("/create-upload-task", (req, res) => {
  const { fileHash, fileName, fileSize, totalChunks, chunkSize } = req.body;

  console.log("📋 创建上传任务:", {
    fileHash,
    fileName,
    totalChunks,
    fileSize,
  });

  if (!fileHash || !fileName || !fileSize || !totalChunks) {
    return res.status(400).json({
      success: false,
      message: "缺少必要参数",
    });
  }

  const taskFile = path.join(TASK_DIR, `${fileHash}.json`);

  // 检查是否已有去重记录（文件已完成）
  const dedupRecordPath = path.join(DEDUP_DIR, `${fileHash}.json`);
  if (fs.existsSync(dedupRecordPath)) {
    const fileInfo = JSON.parse(fs.readFileSync(dedupRecordPath, "utf-8"));
    console.log(`⚠️ 文件已存在，无需创建任务: ${fileName}`);
    return res.json({
      success: true,
      message: "文件已存在",
      data: {
        fileHash,
        fileName: fileInfo.fileName,
        fileSize: fileInfo.fileSize,
        totalChunks,
        chunks: Array.from({ length: totalChunks }, (_, i) => i),
      },
    });
  }

  // 如果任务已存在，返回现有任务信息
  if (fs.existsSync(taskFile)) {
    const existingTask = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
    console.log(`📋 任务已存在: ${fileName}`);
    return res.json({
      success: true,
      message: "任务已存在",
      data: existingTask,
    });
  }

  // 创建新任务记录
  const taskInfo = {
    fileHash,
    fileName,
    fileSize: parseInt(fileSize),
    totalChunks: parseInt(totalChunks),
    chunkSize: chunkSize || 5 * 1024 * 1024,
    chunks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  fs.writeFileSync(taskFile, JSON.stringify(taskInfo, null, 2));
  console.log(`✅ 创建上传任务成功: ${fileName} (hash: ${fileHash})`);

  res.json({
    success: true,
    message: "上传任务创建成功",
    data: taskInfo,
  });
});

// ============================================
// 4. 分片上传接口
// ============================================
app.post("/upload-chunk", upload.single("file"), (req, res) => {
  const { chunkIndex, totalChunks, fileName, fileHash } = req.body;

  if (!req.file) {
    return res.status(400).json({ success: false, message: "没有文件分片" });
  }

  console.log(`📤 接收分片: ${fileHash} - ${chunkIndex}/${totalChunks}`);

  const chunkFileName = `chunk_${fileHash}_${chunkIndex}`;
  const chunkPath = path.join(UPLOAD_DIR, chunkFileName);

  // 检查分片是否已存在（秒传分片）
  if (fs.existsSync(chunkPath)) {
    console.log(`   ⚡ 分片已存在，秒传成功: ${chunkIndex}`);
    // 删除临时文件
    fs.unlink(req.file.path, () => {});

    // 更新任务记录
    if (fileHash) {
      const taskFile = path.join(TASK_DIR, `${fileHash}.json`);
      if (fs.existsSync(taskFile)) {
        try {
          const taskInfo = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
          const chunkIdx = parseInt(chunkIndex);
          if (!taskInfo.chunks.includes(chunkIdx)) {
            taskInfo.chunks.push(chunkIdx);
            taskInfo.chunks.sort((a, b) => a - b);
            taskInfo.updatedAt = Date.now();
            fs.writeFileSync(taskFile, JSON.stringify(taskInfo, null, 2));
          }
        } catch (error) {
          console.error("更新任务记录失败:", error);
        }
      }
    }

    return res.json({
      success: true,
      message: "分片已存在（秒传）",
      chunkIndex: parseInt(chunkIndex),
    });
  }

  // 保存新分片（处理跨分区 rename 失败 EXDEV 错误）
  const saveChunk = (srcPath, destPath, cb) => {
    fs.rename(srcPath, destPath, (renameErr) => {
      if (!renameErr) return cb(null);
      // EXDEV: 跨分区 rename 不允许，改用 copy + delete
      if (renameErr.code === "EXDEV") {
        fs.copyFile(srcPath, destPath, (copyErr) => {
          if (copyErr) return cb(copyErr);
          fs.unlink(srcPath, () => cb(null));
        });
      } else {
        cb(renameErr);
      }
    });
  };
  saveChunk(req.file.path, chunkPath, (err) => {
    if (err) {
      console.error("保存分片失败:", err);
      return res.status(500).json({ success: false, message: "保存分片失败" });
    }

    // 更新任务记录
    if (fileHash) {
      const taskFile = path.join(TASK_DIR, `${fileHash}.json`);

      if (fs.existsSync(taskFile)) {
        try {
          const taskInfo = JSON.parse(fs.readFileSync(taskFile, "utf-8"));

          const chunkIdx = parseInt(chunkIndex);
          if (!taskInfo.chunks.includes(chunkIdx)) {
            taskInfo.chunks.push(chunkIdx);
            taskInfo.chunks.sort((a, b) => a - b);
            taskInfo.updatedAt = Date.now();
            fs.writeFileSync(taskFile, JSON.stringify(taskInfo, null, 2));

            console.log(
              `   ✅ 分片 ${chunkIndex} 已保存，进度: ${taskInfo.chunks.length}/${taskInfo.totalChunks}`,
            );
          }
        } catch (error) {
          console.error("更新任务记录失败:", error);
        }
      } else {
        // 创建新任务记录
        const newTaskInfo = {
          fileHash,
          fileName: fileName || "unknown",
          totalChunks: parseInt(totalChunks),
          chunkSize: req.file.size,
          chunks: [parseInt(chunkIndex)],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        fs.writeFileSync(taskFile, JSON.stringify(newTaskInfo, null, 2));
        console.log(`   📋 创建新任务记录: ${fileHash}`);
      }
    }

    res.json({
      success: true,
      message: "分片上传成功",
      chunkIndex: parseInt(chunkIndex),
    });
  });
});

// ============================================
// 5. 合并分片接口
// ============================================
app.post("/merge-chunks", async (req, res) => {
  const { fileName, totalChunks, originalName, fileHash, fileSize } = req.body;

  console.log("🔀 合并请求:", { fileName, totalChunks, fileHash, fileSize });

  if (!fileName || !totalChunks || !fileHash) {
    return res.status(400).json({
      success: false,
      message: "缺少必要参数: fileName, totalChunks, fileHash 为必填",
    });
  }

  const finalFileName = originalName || fileName;
  const filePath = path.join(UPLOAD_DIR, finalFileName);

  // 先检查去重记录，避免重复保存
  const dedupRecordPath = path.join(DEDUP_DIR, `${fileHash}.json`);
  if (fs.existsSync(dedupRecordPath)) {
    const existingFile = JSON.parse(fs.readFileSync(dedupRecordPath, "utf-8"));
    console.log(`⚠️ 文件已存在，跳过合并: ${fileHash}`);

    // 清理残留的分片文件
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(UPLOAD_DIR, `chunk_${fileHash}_${i}`);
      if (fs.existsSync(chunkPath)) {
        fs.unlinkSync(chunkPath);
      }
    }

    return res.json({
      success: true,
      message: "文件已存在（秒传）",
      data: {
        filename: existingFile.fileName,
        path: path.join(UPLOAD_DIR, existingFile.fileName),
        url: existingFile.url,
        fileHash: fileHash,
        fileSize: existingFile.fileSize,
      },
    });
  }

  // 收集所有分片
  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(UPLOAD_DIR, `chunk_${fileHash}_${i}`);
    if (!fs.existsSync(chunkPath)) {
      return res.status(500).json({
        success: false,
        message: `分片 ${i} 不存在`,
        missingChunkIndex: i,
      });
    }
    chunks.push(chunkPath);
  }

  console.log(
    `🔀 开始合并分片: ${finalFileName} (hash: ${fileHash}, 总分片: ${totalChunks})`,
  );

  try {
    // 创建写入流
    const writeStream = fs.createWriteStream(filePath);

    // 按顺序流式写入所有分片（避免 readFileSync 阻塞事件循环 + 内存溢出）
    for (const chunkPath of chunks) {
      await new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(chunkPath);
        readStream.pipe(writeStream, { end: false });
        readStream.on("end", resolve);
        readStream.on("error", reject);
      });
    }

    writeStream.end();

    // 等待写入完成
    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // 获取文件大小
    const stats = fs.statSync(filePath);
    const actualSize = stats.size;

    console.log(
      `✅ 文件合并成功: ${finalFileName} (大小: ${actualSize} bytes)`,
    );

    // 保存去重记录（用于秒传）
    const fileInfo = {
      fileName: finalFileName,
      originalFileName: originalName || fileName,
      fileHash: fileHash,
      fileSize: actualSize,
      url: `/uploads/${encodeURIComponent(finalFileName)}`,
      uploadedAt: Date.now(),
    };

    fs.writeFileSync(dedupRecordPath, JSON.stringify(fileInfo, null, 2));
    console.log(`💾 保存去重记录: ${fileHash} -> ${finalFileName}`);

    // 删除所有分片文件
    for (const chunkPath of chunks) {
      fs.unlinkSync(chunkPath);
      console.log(`   🗑️ 删除分片: ${path.basename(chunkPath)}`);
    }

    // 删除任务记录
    const taskFile = path.join(TASK_DIR, `${fileHash}.json`);
    if (fs.existsSync(taskFile)) {
      fs.unlinkSync(taskFile);
      console.log(`   🗑️ 删除任务记录: ${fileHash}`);
    }

    res.json({
      success: true,
      message: "文件合并成功",
      data: {
        filename: finalFileName,
        path: filePath,
        url: buildUrl(req, `/uploads/${encodeURIComponent(finalFileName)}`),
        fileHash: fileHash,
        fileSize: actualSize,
      },
    });
  } catch (error) {
    console.error("合并文件失败:", error);
    res.status(500).json({
      success: false,
      message: "合并文件失败",
      error: error.message,
    });
  }
});

// ============================================
// 6. 普通上传接口
// ============================================
app.post("/upload", uploadSingle.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "没有文件被上传",
    });
  }

  const fileInfo = {
    success: true,
    message: "文件传输成功",
    data: {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path,
      url: buildUrl(req, `/uploads/${req.file.filename}`),
    },
  };

  console.log(
    `✅ 文件传输成功: ${req.file.originalname} (${req.file.size} bytes)`,
  );
  res.json(fileInfo);
});

// ============================================
// 7. 多文件传输接口
// ============================================
app.post("/upload-multiple", uploadSingle.array("files", 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      message: "没有文件被上传",
    });
  }

  const filesInfo = req.files.map((file) => ({
    originalName: file.originalname,
    filename: file.filename,
    size: file.size,
    mimetype: file.mimetype,
    path: file.path,
    url: buildUrl(req, `/uploads/${file.filename}`),
  }));

  console.log(`✅ 多文件传输成功: ${filesInfo.length} 个文件`);
  res.json({
    success: true,
    message: `${filesInfo.length} 个文件传输成功`,
    data: filesInfo,
  });
});

// ============================================
// 8. 获取文件列表
// ============================================
app.get("/files", (req, res) => {
  if (!fs.existsSync(UPLOAD_DIR)) {
    return res.json({ success: true, data: [], total: 0 });
  }

  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "读取文件列表失败" });
    }

    // 过滤掉分片文件、tasks目录、dedup目录
    const filteredFiles = files.filter(
      (f) =>
        !f.startsWith("chunk_") &&
        f !== "tasks" &&
        f !== "dedup" &&
        !f.endsWith(".json"),
    );

    const fileList = filteredFiles.map((file) => {
      const filePath = path.join(UPLOAD_DIR, file);
      let stats;
      try {
        stats = fs.statSync(filePath);
      } catch {
        return null; // 文件无法访问就跳过
      }
      const ext = path.extname(file).toLowerCase();

      let type = "other";
      if (
        [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"].includes(ext)
      )
        type = "image";
      else if ([".mp4", ".avi", ".mov", ".wmv", ".flv", ".mkv"].includes(ext))
        type = "video";
      else if ([".mp3", ".wav", ".ogg", ".aac", ".flac"].includes(ext))
        type = "audio";
      else if (
        [
          ".pdf",
          ".doc",
          ".docx",
          ".xls",
          ".xlsx",
          ".ppt",
          ".pptx",
          ".txt",
          ".md",
        ].includes(ext)
      )
        type = "document";

      return {
        fileName: file,
        url: buildUrl(req, `/uploads/${encodeURIComponent(file)}`),
        size: stats.size,
        type,
        extension: ext,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      };
    });

    res.json({
      success: true,
      data: fileList.filter(Boolean),
      total: fileList.filter(Boolean).length,
    });
  });
});

// ============================================
// 9. 删除重复文件记录接口（可选）
// ============================================
app.delete("/dedup-record/:fileHash", (req, res) => {
  const { fileHash } = req.params;
  const dedupRecordPath = path.join(DEDUP_DIR, `${fileHash}.json`);

  if (fs.existsSync(dedupRecordPath)) {
    fs.unlinkSync(dedupRecordPath);
    console.log(`🗑️ 删除去重记录: ${fileHash}`);
    res.json({ success: true, message: "删除成功" });
  } else {
    res.status(404).json({ success: false, message: "记录不存在" });
  }
});

// ============================================
// 10. 删除服务端文件（同时清理 dedup / task / chunk）
// ============================================
app.delete("/files/:filename", (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);

  console.log(`🗑️ 删除文件请求: ${filename}`);

  if (!fs.existsSync(filePath)) {
    console.log(`   ⚠️ 文件不存在: ${filePath}`);
    return res.json({ success: false, message: "文件不存在，可能已被删除" });
  }

  const deletedItems = [];

  try {
    // 1. 删除目标文件
    fs.unlinkSync(filePath);
    deletedItems.push(`文件: ${filename}`);
    console.log(`   ✅ 已删除: ${filePath}`);

    // 2. 扫描 dedup 记录，删除指向该文件名的记录及其关联的 task / chunk
    let fileHash = null;
    if (fs.existsSync(DEDUP_DIR)) {
      const dedupFiles = fs.readdirSync(DEDUP_DIR).filter((f) => f.endsWith(".json"));
      for (const df of dedupFiles) {
        const dedupPath = path.join(DEDUP_DIR, df);
        try {
          const record = JSON.parse(fs.readFileSync(dedupPath, "utf-8"));
          if (record.fileName === filename) {
            fileHash = record.fileHash || path.basename(df, ".json");
            fs.unlinkSync(dedupPath);
            deletedItems.push(`去重记录: ${df}`);
            console.log(`   ✅ 已删除去重记录: ${df}`);
            break; // 一个文件最多一条记录
          }
        } catch (_) {}
      }
    }

    // 3. 根据 fileHash 清理 task 记录和 chunk 文件
    if (fileHash) {
      // 删除 task 记录
      const taskPath = path.join(TASK_DIR, `${fileHash}.json`);
      if (fs.existsSync(taskPath)) {
        fs.unlinkSync(taskPath);
        deletedItems.push(`任务记录: ${fileHash}.json`);
        console.log(`   ✅ 已删除任务记录: ${fileHash}.json`);
      }

      // 删除残留 chunk 文件
      try {
        const uploadFiles = fs.readdirSync(UPLOAD_DIR);
        for (const f of uploadFiles) {
          if (f.startsWith(`chunk_${fileHash}_`)) {
            fs.unlinkSync(path.join(UPLOAD_DIR, f));
            console.log(`   ✅ 已删除分片: ${f}`);
          }
        }
      } catch (_) {}
    }

    res.json({
      success: true,
      message: "删除成功",
      data: { deletedItems, fileName: filename },
    });
  } catch (error) {
    console.error("删除文件失败:", error);
    res.status(500).json({
      success: false,
      message: "删除文件失败",
      error: error.message,
    });
  }
});

// ============================================
// 11. 文件下载接口（支持 Range 分片下载）
// ============================================
app.get("/download/:filename", (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);

  console.log(`📥 下载请求: ${filename}`);

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: "文件不存在",
    });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // ===== 无 Range 头：完整下载 =====
  if (!range) {
    console.log(`   📦 完整下载: ${fileSize} bytes`);
    res.setHeader("Content-Length", fileSize);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    res.setHeader("Accept-Ranges", "bytes");

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);

    readStream.on("error", (err) => {
      console.error(`   ❌ 文件读取失败: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "文件读取失败" });
      }
    });

    readStream.on("end", () => {
      console.log(`   ✅ 下载完成: ${fileSize} bytes`);
    });
    return;
  }

  // ===== 有 Range 头：分片下载 =====
  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  // 校验范围
  if (start >= fileSize || end >= fileSize || start > end) {
    res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
    return res.json({ success: false, message: "Range 请求范围不合法" });
  }

  const chunkSize = end - start + 1;

  console.log(
    `   🔀 分片下载: bytes=${start}-${end}/${fileSize} (${(chunkSize / 1024).toFixed(1)} KB)`,
  );

  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", chunkSize);
  res.setHeader("Content-Type", "application/octet-stream");

  const readStream = fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
  readStream.pipe(res);

  readStream.on("error", (err) => {
    console.error(`   ❌ 分片读取失败: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "分片读取失败" });
    }
  });

  readStream.on("end", () => {
    console.log(`   ✅ 分片下载完成: ${chunkSize} bytes`);
  });
});

// ============================================
// 11. Excel 文件生成下载
// ============================================
app.post("/download-excel", async (req, res) => {
  const { columns = 10, rows = 1000, fileName = "data.xlsx" } = req.body;

  // 生成简单的 CSV 内容（Excel 可以直接打开 CSV）
  const headers = Array.from({ length: columns }, (_, i) => `列${i + 1}`).join(",");
  const dataRows = Array.from({ length: rows }, (_, rowIdx) =>
    Array.from({ length: columns }, (_, colIdx) => `数据${rowIdx + 1}-${colIdx + 1}`).join(",")
  ).join("\n");

  const csvContent = `${headers}\n${dataRows}`;
  const fileBuffer = Buffer.from(csvContent, "utf-8");

  // 如果需要真正的 xlsx，可以用 xlsx 库，这里用 CSV 代替
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Length", fileBuffer.length);
  res.send(fileBuffer);
});

// ============================================
// 12. 静态文件服务
// ============================================
app.use("/uploads", express.static(UPLOAD_DIR));

// ============================================
// 12. 启动服务器
// ============================================
app.listen(3000, () => {
  console.log("\n========================================");
  console.log("🚀 Server is running on port 3000");
  console.log("========================================");
  console.log("⚡ 秒传检查: POST /check-file");
  console.log("📂 断点续传: GET /get-uploaded-chunks");
  console.log("📋 创建任务: POST /create-upload-task");
  console.log("📤 分片上传: POST /upload-chunk");
  console.log("🔀 合并分片: POST /merge-chunks");
  console.log("📁 普通上传: POST /upload");
  console.log("📁 多文件传输: POST /upload-multiple");
  console.log("📁 文件列表: GET /files");
  console.log("🗑️ 删除记录: DELETE /dedup-record/:fileHash");
  console.log("🗑️ 删除文件: DELETE /files/:filename");
  console.log("📥 文件下载: GET /download/:filename");
  console.log("📁 静态文件: GET /uploads/:filename");
  console.log("========================================\n");
});
