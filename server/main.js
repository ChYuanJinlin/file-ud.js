const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
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
[UPLOAD_DIR, TASK_DIR, DEDUP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(express.json());
app.use(cors());

// ============================================
// 1. 秒传检查接口（适配前端逻辑）
// ============================================
app.post("/check-file", (req, res) => {
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
        isInstantUpload: true,        // 前端需要这个字段
        canReuseChunks: false,
        fileHash: fileHash,
        fileInfo: {
          fileName: fileInfo.fileName,
          fileHash: fileInfo.fileHash,
          fileSize: fileInfo.fileSize,
          url: fileInfo.url,
        },
        uploadedChunks: totalChunks ? Array.from({ length: totalChunks }, (_, i) => i) : [],
        totalChunks: totalChunks || 0,
      }
    });
  }

  // 2. 检查是否有未完成的上传任务（分片可复用）
  let existingChunks = [];
  let hasTask = false;
  
  const taskRecordPath = path.join(TASK_DIR, `${fileHash}.json`);
  if (fs.existsSync(taskRecordPath)) {
    try {
      const taskInfo = JSON.parse(fs.readFileSync(taskRecordPath, "utf-8"));
      existingChunks = taskInfo.uploadedChunks || [];
      hasTask = true;
      console.log(`🔄 发现未完成上传: ${taskInfo.fileName}，已上传 ${existingChunks.length}/${taskInfo.totalChunks} 分片`);
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
    console.log(`🔄 分片可复用: ${existingChunks.length}/${totalChunks} 分片已存在`);
    console.log(`   已上传分片索引:`, existingChunks);
    
    // ✅ 适配前端：返回 canReuseChunks = true
    return res.json({
      success: true,
      data: {
        exists: false,
        isInstantUpload: false,
        canReuseChunks: true,         // 前端需要这个字段
        fileHash: fileHash,
        uploadedChunks: existingChunks,
        totalChunks: totalChunks || 0,
      }
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
      uploadedChunks: [],
      totalChunks: totalChunks || 0,
    }
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
        uploadedChunks: [],
        totalChunks: 0,
      },
    });
  }

  try {
    const taskInfo = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
    console.log(`📂 断点续传: ${taskInfo.fileName} (已上传: ${taskInfo.uploadedChunks.length}/${taskInfo.totalChunks})`);

    res.json({
      success: true,
      data: {
        fileHash,
        fileName: taskInfo.fileName,
        totalChunks: taskInfo.totalChunks,
        uploadedChunks: taskInfo.uploadedChunks,
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

  console.log("📋 创建上传任务:", { fileHash, fileName, totalChunks, fileSize });

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
        uploadedChunks: Array.from({ length: totalChunks }, (_, i) => i),
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
    uploadedChunks: [],
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
          if (!taskInfo.uploadedChunks.includes(chunkIdx)) {
            taskInfo.uploadedChunks.push(chunkIdx);
            taskInfo.uploadedChunks.sort((a, b) => a - b);
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

  // 保存新分片
  fs.rename(req.file.path, chunkPath, (err) => {
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
          if (!taskInfo.uploadedChunks.includes(chunkIdx)) {
            taskInfo.uploadedChunks.push(chunkIdx);
            taskInfo.uploadedChunks.sort((a, b) => a - b);
            taskInfo.updatedAt = Date.now();
            fs.writeFileSync(taskFile, JSON.stringify(taskInfo, null, 2));
            
            console.log(`   ✅ 分片 ${chunkIndex} 已保存，进度: ${taskInfo.uploadedChunks.length}/${taskInfo.totalChunks}`);
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
          uploadedChunks: [parseInt(chunkIndex)],
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
      message: "缺少必要参数: fileName, totalChunks, fileHash 为必填" 
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

  console.log(`🔀 开始合并分片: ${finalFileName} (hash: ${fileHash}, 总分片: ${totalChunks})`);

  try {
    // 创建写入流
    const writeStream = fs.createWriteStream(filePath);
    
    // 按顺序写入所有分片
    for (const chunkPath of chunks) {
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
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

    console.log(`✅ 文件合并成功: ${finalFileName} (大小: ${actualSize} bytes)`);
    
    // 保存去重记录（用于秒传）
    const fileInfo = {
      fileName: finalFileName,
      originalFileName: originalName || fileName,
      fileHash: fileHash,
      fileSize: actualSize,
      url: `http://localhost:3000/uploads/${encodeURIComponent(finalFileName)}`,
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
        url: `http://localhost:3000/uploads/${encodeURIComponent(finalFileName)}`,
        fileHash: fileHash,
        fileSize: actualSize,
      },
    });
  } catch (error) {
    console.error("合并文件失败:", error);
    res.status(500).json({ 
      success: false, 
      message: "合并文件失败", 
      error: error.message 
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
    message: "文件上传成功",
    data: {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path,
      url: `http://localhost:3000/uploads/${req.file.filename}`,
    },
  };

  console.log(`✅ 文件上传成功: ${req.file.originalname} (${req.file.size} bytes)`);
  res.json(fileInfo);
});

// ============================================
// 7. 多文件上传接口
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
    url: `http://localhost:3000/uploads/${file.filename}`,
  }));

  console.log(`✅ 多文件上传成功: ${filesInfo.length} 个文件`);
  res.json({
    success: true,
    message: `${filesInfo.length} 个文件上传成功`,
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
      return res.status(500).json({ success: false, message: "读取文件列表失败" });
    }

    // 过滤掉分片文件、tasks目录、dedup目录
    const filteredFiles = files.filter(f => 
      !f.startsWith("chunk_") && 
      f !== "tasks" && 
      f !== "dedup" &&
      !f.endsWith(".json")
    );

    const fileList = filteredFiles.map((file) => {
      const filePath = path.join(UPLOAD_DIR, file);
      const stats = fs.statSync(filePath);
      const ext = path.extname(file).toLowerCase();

      let type = "other";
      if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"].includes(ext)) type = "image";
      else if ([".mp4", ".avi", ".mov", ".wmv", ".flv", ".mkv"].includes(ext)) type = "video";
      else if ([".mp3", ".wav", ".ogg", ".aac", ".flac"].includes(ext)) type = "audio";
      else if ([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md"].includes(ext)) type = "document";

      return {
        name: file,
        url: `http://localhost:3000/uploads/${encodeURIComponent(file)}`,
        size: stats.size,
        type,
        extension: ext,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      };
    });

    res.json({
      success: true,
      data: fileList,
      total: fileList.length,
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
// 10. 静态文件服务
// ============================================
app.use("/uploads", express.static(UPLOAD_DIR));

// ============================================
// 11. 启动服务器
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
  console.log("📁 多文件上传: POST /upload-multiple");
  console.log("📁 文件列表: GET /files");
  console.log("🗑️ 删除记录: DELETE /dedup-record/:fileHash");
  console.log("📁 静态文件: GET /uploads/:filename");
  console.log("========================================\n");
});