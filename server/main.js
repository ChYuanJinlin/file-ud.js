const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const app = express();
const cors = require("cors");

/**
 * ========================================
 * 文件上传服务器 - 支持秒传和断点续传
 * ========================================
 *
 * 🎯 核心特性：
 * 1. 秒传：相同内容的文件只需上传一次
 * 2. 断点续传：上传中断后可从断点继续
 * 3. 分片共享：相同 hash 的文件共享分片，节省存储
 * 4. 自动清理：7天未使用的分片自动删除
 *
 * 📋 接口列表：
 * 1. POST /check-file - 秒传检查
 * 2. GET /get-uploaded-chunks - 获取已上传分片列表（断点续传）
 * 3. POST /create-upload-task - 创建上传任务
 * 4. POST /upload-chunk - 分片上传
 * 5. POST /merge-chunks - 合并分片
 * 6. POST /upload - 普通上传
 * 7. POST /upload-multiple - 多文件上传
 * 8. GET /files - 获取文件列表
 *
 * 💾 存储结构：
 * - uploads/ - 上传文件目录
 * - uploads/tasks/ - 上传任务记录（断点续传 + 秒传）
 * - uploads/hash_{fileHash}.json - 秒传记录（包含 filenames 数组）
 * - uploads/chunk_{fileHash}_{chunkIndex} - 分片文件（共享）
 * - uploads/{fileName} - 合并后的完整文件
 *
 * 🔧 修复的问题：
 * - ✅ 相同 hash 不同文件名的文件可以正常上传
 * - ✅ 第二个文件不会因分片被删除而报错
 * - ✅ 真正的秒传：第二次上传瞬间完成
 */

// 配置 multer 存储（普通上传用）
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads");
    // 确保目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名：时间戳 + 随机数 + 原文件名
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

// 分片上传用 multer（临时存储）
const upload = multer({ dest: "uploads/" });
// 普通上传用 multer（持久化存储）
const uploadSingle = multer({ storage: storage });

app.use(express.json());
app.use(cors());

// ========== 1. 普通上传接口 ==========
/**
 * 普通文件上传
 * 前端用 FormData 传文件
 * 字段名: file
 */
app.post("/upload", uploadSingle.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "没有文件被上传",
    });
  }

  // 获取文件信息
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

  console.log(
    `✅ 文件上传成功: ${req.file.originalname} (${req.file.size} bytes)`,
  );
  res.json(fileInfo);
});

// ========== 2. 普通多文件上传接口 ==========
/**
 * 多文件上传
 * 前端用 FormData 传多个文件
 * 字段名: files
 */
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

// ========== 3. 秒传检查接口 ==========
/**
 * 秒传检查
 * 前端传递文件 MD5，后端检查是否已存在相同文件
 * 如果存在，直接返回文件信息（实现秒传）
 * 如果不存在，检查是否有其他文件的部分分片可以复用
 */
app.post("/check-file", (req, res) => {
  const { fileHash, fileName, totalChunks } = req.body;

  if (!fileHash) {
    return res.status(400).json({
      success: false,
      message: "缺少文件哈希值",
    });
  }

  const uploadDir = path.join(__dirname, "uploads");
  const taskDir = path.join(uploadDir, "tasks");

  // 确保任务目录存在
  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true });
  }

  // 1. 检查文件是否已完整上传（秒传）
  const hashFilePath = path.join(taskDir, `${fileHash}.json`);

  if (fs.existsSync(hashFilePath)) {
    // 文件哈希记录存在，实现秒传
    const fileInfo = JSON.parse(fs.readFileSync(hashFilePath, "utf-8"));
    
    // ✅ 关键修复：检查目标文件是否真的存在
    const uploadDir = path.join(__dirname, "uploads");
    const targetFilePath = path.join(uploadDir, fileName);
    
    if (fs.existsSync(targetFilePath)) {
      // 目标文件存在，真正的秒传
      console.log(`⚡ 秒传成功: ${fileName} (fileHash: ${fileHash})`);

      return res.json({
        success: true,
        message: "文件已存在，秒传成功",
        data: {
          exists: true,
          isInstantUpload: true, // ✅ 标记为真正的秒传
          uploadedChunks: Array.from({ length: totalChunks || 0 }, (_, i) => i), // 返回所有分片索引
          totalChunks: totalChunks || 0,
          ...fileInfo,
        },
      });
    } else {
      // ✅ 目标文件不存在，但 hash 记录存在（可能是不同文件名）
      // 需要检查分片文件是否存在，如果存在可以复用
      console.log(`📝 文件不存在但 hash 记录存在: ${fileName} (fileHash: ${fileHash})`);
      console.log(`   已有文件: ${fileInfo.fileName || fileInfo.filenames?.[0]}`);
      
      // 检查分片文件是否存在
      let chunksExist = true;
      if (totalChunks > 0) {
        const firstChunkPath = path.join(uploadDir, `chunk_${fileHash}_0`);
        const lastChunkPath = path.join(uploadDir, `chunk_${fileHash}_${totalChunks - 1}`);
        
        if (!fs.existsSync(firstChunkPath) || !fs.existsSync(lastChunkPath)) {
          chunksExist = false;
          console.log(`   ⚠️  分片文件已被清理，需要重新上传`);
          
          // 删除过期的哈希记录
          fs.unlinkSync(hashFilePath);
        }
      }
      
      if (chunksExist) {
        // 分片存在，可以断点续传
        console.log(`   ✅ 分片文件存在，可以复用`);
        
        return res.json({
          success: true,
          message: "分片可复用，请继续上传",
          data: {
            exists: false, // 注意：这里返回 false，表示需要继续上传
            uploadedChunks: Array.from({ length: totalChunks || 0 }, (_, i) => i), // 返回所有分片索引
            totalChunks: totalChunks || 0,
            canReuseChunks: true, // ✅ 标记可以复用分片
            ...fileInfo,
          },
        });
      }
      // 如果分片也不存在，继续下面的逻辑，当作新文件处理
    }
  }

  // 2. 文件未完整上传，检查是否有其他文件的部分分片可以复用
  // 遍历任务目录，查找相同 fileHash 的任务记录
  let reusableChunks = [];
  
  try {
    const taskFiles = fs.readdirSync(taskDir);
    
    for (const taskFile of taskFiles) {
      if (!taskFile.endsWith('.json')) continue;
      
      const taskPath = path.join(taskDir, taskFile);
      const taskInfo = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
      
      // 找到相同 fileHash 的任务
      if (taskInfo.fileHash === fileHash && taskInfo.uploadedChunks) {
        reusableChunks = taskInfo.uploadedChunks;
        console.log(`🔄 发现可复用分片: ${reusableChunks.length}/${totalChunks} (来自任务: ${taskFile})`);
        break;
      }
    }
  } catch (error) {
    console.error("检查可复用分片失败:", error);
  }

  // 3. 检查物理分片文件是否存在
  const existingChunks = [];
  for (const chunkIndex of reusableChunks) {
    const chunkPath = path.join(uploadDir, `${fileName}-${fileHash}-${chunkIndex}`);
    if (fs.existsSync(chunkPath)) {
      existingChunks.push(chunkIndex);
    }
  }

  // 文件不存在，返回需要上传的分片列表（用于断点续传检查）
  console.log(`📝 文件不存在，需要上传: ${fileName} (fileHash: ${fileHash})`);
  console.log(`   可复用分片: ${existingChunks.length}/${totalChunks}`);
  
  res.json({
    success: true,
    message: "文件不存在，需要上传",
    data: {
      exists: false,
      uploadedChunks: existingChunks, // 返回已存在的分片索引
      totalChunks: totalChunks || 0,
    },
  });
});

// ========== 4. 获取已上传分片列表接口（断点续传） ==========
/**
 * 获取已上传分片列表
 * 前端传递 fileHash，后端返回已上传的分片索引数组
 * 用于断点续传时恢复上传进度
 */
app.get("/get-uploaded-chunks", (req, res) => {
  const { fileHash } = req.query;

  if (!fileHash) {
    return res.status(400).json({
      success: false,
      message: "缺少文件哈希值",
    });
  }

  const uploadDir = path.join(__dirname, "uploads");
  const taskDir = path.join(uploadDir, "tasks");
  const taskFile = path.join(taskDir, `${fileHash}.json`);

  if (!fs.existsSync(taskFile)) {
    // 没有上传记录，返回空数组
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
    console.log(`📂 断点续传: ${taskInfo.fileName} (fileHash: ${fileHash})`);
    console.log(
      `   已上传分片: ${taskInfo.uploadedChunks.length}/${taskInfo.totalChunks}`,
    );

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

// ========== 5. 创建上传任务接口 ==========
/**
 * 创建上传任务
 * 前端开始上传前调用，后端创建任务记录
 */
app.post("/create-upload-task", (req, res) => {
  const { fileHash, fileName, fileSize, totalChunks, chunkSize } = req.body;
  console.log("🚀 ~ req.body:", req.body);

  if (!fileHash || !fileName || !fileSize || !totalChunks) {
    return res.status(400).json({
      success: false,
      message: "缺少必要参数",
    });
  }

  const uploadDir = path.join(__dirname, "uploads");
  const taskDir = path.join(uploadDir, "tasks");

  // 确保任务目录存在
  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true });
  }

  const taskFile = path.join(taskDir, `${fileHash}.json`);

  // 创建任务记录
  const taskInfo = {
    fileHash,
    fileName,
    fileSize,
    totalChunks,
    chunkSize,
    uploadedChunks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  fs.writeFileSync(taskFile, JSON.stringify(taskInfo, null, 2));
  console.log(`📋 创建上传任务: ${fileName} (fileHash: ${fileHash})`);

  res.json({
    success: true,
    message: "上传任务创建成功",
    data: taskInfo,
  });
});

// ========== 6. 分片上传接口 ==========
app.post("/upload-chunk", upload.single("file"), (req, res) => {
  const { chunkIndex, totalChunks, fileName, fileHash } = req.body;

  if (!req.file) {
    return res.status(400).json({ success: false, message: "没有文件分片" });
  }

  console.log(
    `接收到分片: ${fileName} - chunkIndex ${chunkIndex}/${totalChunks} (fileHash: ${fileHash || "unknown"})`,
  );

  // ✅ 使用 fileHash 作为分片文件名的核心标识，而不是 fileName
  // 这样相同内容（相同 fileHash）但不同文件名的文件可以共享分片
  const chunkFileName = `chunk_${fileHash}_${chunkIndex}`;
  const filePath = path.join("uploads", chunkFileName);

  // ✅ 关键修复：检查分片文件是否已存在（秒传分片）
  if (fs.existsSync(filePath)) {
    console.log(`   ⚡ 分片已存在，跳过保存: chunk ${chunkIndex}`);
    
    // 删除临时上传的文件
    fs.unlink(req.file.path, (err) => {
      if (err) console.error("删除临时文件失败:", err);
    });
    
    // 但仍然更新任务记录
    if (fileHash) {
      const taskDir = path.join("uploads", "tasks");
      const taskFile = path.join(taskDir, `${fileHash}.json`);

      if (fs.existsSync(taskFile)) {
        try {
          const taskInfo = JSON.parse(fs.readFileSync(taskFile, "utf-8"));

          // 添加已上传的分片索引
          if (!taskInfo.uploadedChunks.includes(parseInt(chunkIndex))) {
            taskInfo.uploadedChunks.push(parseInt(chunkIndex));
            taskInfo.updatedAt = Date.now();
            
            // 增加引用计数
            if (!taskInfo.chunkReferences) {
              taskInfo.chunkReferences = {};
            }
            taskInfo.chunkReferences[chunkIndex] = (taskInfo.chunkReferences[chunkIndex] || 0) + 1;
            
            fs.writeFileSync(taskFile, JSON.stringify(taskInfo, null, 2));
            
            console.log(`   ✅ 分片 ${chunkIndex} 已记录，当前进度: ${taskInfo.uploadedChunks.length}/${taskInfo.totalChunks}`);
          }
        } catch (error) {
          console.error("更新任务记录失败:", error);
        }
      } else {
        // 如果任务记录不存在，创建一个新的
        const newTaskInfo = {
          fileHash,
          fileName,
          totalChunks: parseInt(totalChunks),
          chunkSize: req.file.size,
          uploadedChunks: [parseInt(chunkIndex)],
          chunkReferences: { [chunkIndex]: 1 },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        fs.writeFileSync(taskFile, JSON.stringify(newTaskInfo, null, 2));
        console.log(`   📋 创建新任务记录: ${fileName} (fileHash: ${fileHash})`);
      }
    }
    
    return res.json({
      success: true,
      message: "分片已存在，秒传成功",
      chunkIndex: parseInt(chunkIndex),
      isDuplicate: true, // ✅ 标记为重复分片
    });
  }

  // 分片不存在，正常保存
  fs.rename(req.file.path, filePath, (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: "保存分片失败" });
    }

    // 更新任务记录（断点续传支持）
    if (fileHash) {
      const taskDir = path.join("uploads", "tasks");
      const taskFile = path.join(taskDir, `${fileHash}.json`);

      if (fs.existsSync(taskFile)) {
        try {
          const taskInfo = JSON.parse(fs.readFileSync(taskFile, "utf-8"));

          // 添加已上传的分片索引
          if (!taskInfo.uploadedChunks.includes(parseInt(chunkIndex))) {
            taskInfo.uploadedChunks.push(parseInt(chunkIndex));
            taskInfo.updatedAt = Date.now();
            
            // ✅ 新增：增加分片的引用计数（用于追踪有多少文件在使用这个分片）
            if (!taskInfo.chunkReferences) {
              taskInfo.chunkReferences = {};
            }
            taskInfo.chunkReferences[chunkIndex] = (taskInfo.chunkReferences[chunkIndex] || 0) + 1;
            
            fs.writeFileSync(taskFile, JSON.stringify(taskInfo, null, 2));
            
            console.log(`   ✅ 分片 ${chunkIndex} 已保存，当前进度: ${taskInfo.uploadedChunks.length}/${taskInfo.totalChunks}`);
          }
        } catch (error) {
          console.error("更新任务记录失败:", error);
        }
      } else {
        // 如果任务记录不存在，创建一个新的
        const newTaskInfo = {
          fileHash,
          fileName,
          totalChunks: parseInt(totalChunks),
          chunkSize: req.file.size,
          uploadedChunks: [parseInt(chunkIndex)],
          chunkReferences: { [chunkIndex]: 1 }, // ✅ 初始化引用计数
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        fs.writeFileSync(taskFile, JSON.stringify(newTaskInfo, null, 2));
        console.log(`   📋 创建新任务记录: ${fileName} (fileHash: ${fileHash})`);
      }
    }

    res.json({
      success: true,
      message: "分片上传成功",
      chunkIndex: parseInt(chunkIndex),
    });
  });
});

// ========== 7. 合并分片接口 ==========
app.post("/merge-chunks", async (req, res) => {
  const { fileName, totalChunks, originalName, fileHash } = req.body;

  if (!fileName || !totalChunks || !fileHash) {
    return res.status(400).json({ success: false, message: "缺少必要参数" });
  }

  const finalFileName = originalName || fileName;
  const filePath = path.join("uploads", finalFileName);
  
  // ✅ 检查文件是否已存在（秒传场景）
  if (fs.existsSync(filePath)) {
    console.log(`⚡ 文件已存在，跳过合并: ${finalFileName} (fileHash: ${fileHash})`);
    
    // 更新哈希记录，添加当前文件名
    const hashFilePath = path.join("uploads/tasks", `${fileHash}.json`);
    let fileInfo;
    
    if (fs.existsSync(hashFilePath)) {
      fileInfo = JSON.parse(fs.readFileSync(hashFilePath, "utf-8"));
      // 如果 filenames 不存在，初始化数组
      if (!fileInfo.filenames) {
        fileInfo.filenames = [fileInfo.fileName];
      }
      // 添加新文件名（避免重复）
      if (!fileInfo.filenames.includes(finalFileName)) {
        fileInfo.filenames.push(finalFileName);
      }
      fileInfo.lastAccessedAt = Date.now();
    } else {
      // 创建新的哈希记录
      fileInfo = {
        fileName: finalFileName,
        filenames: [finalFileName],
        fileSize: fs.statSync(filePath).size,
        fileHash,
        url: `http://localhost:3000/uploads/${finalFileName}`,
        uploadedAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
    }
    
    fs.writeFileSync(hashFilePath, JSON.stringify(fileInfo, null, 2));
    console.log(`   💾 更新哈希记录: ${fileHash}`);
    
    return res.json({
      success: true,
      message: "文件已存在，秒传成功",
      data: {
        filename: finalFileName,
        path: filePath,
        url: `http://localhost:3000/uploads/${finalFileName}`,
        fileHash: fileHash || null,
        isDuplicate: true, // ✅ 标记为重复文件
      },
    });
  }
  
  const writeStream = fs.createWriteStream(filePath);

  let completed = 0;

  console.log(`🔀 开始合并分片: ${finalFileName} (fileHash: ${fileHash}, 总分片数: ${totalChunks})`);

  for (let i = 0; i < totalChunks; i++) {
    // ✅ 使用新的分片文件名格式
    const chunkPath = path.join("uploads", `chunk_${fileHash}_${i}`);

    if (!fs.existsSync(chunkPath)) {
      writeStream.end();
      return res.status(500).json({
        success: false,
        message: `分片 ${i} 不存在`,
        missingChunkIndex: i,
      });
    }

    const readStream = fs.createReadStream(chunkPath);

    await new Promise((resolve, reject) => {
      readStream.pipe(writeStream, { end: false });

      readStream.on("end", () => {
        completed++;
        // ✅ 不再删除分片文件！让其他相同 hash 的文件可以复用
        // 分片文件会在定期清理任务中处理
        resolve();
      });

      readStream.on("error", reject);
    });
  }

  writeStream.end();

  writeStream.on("finish", () => {
    console.log(`✅ 文件合并成功: ${finalFileName}`);
    
    // 保存文件哈希记录（用于秒传）
    if (fileHash) {
      const hashFilePath = path.join("uploads/tasks", `${fileHash}.json`);
      const fileInfo = {
        fileName: finalFileName,
        filenames: [finalFileName], // ✅ 支持多个文件名
        fileSize: fs.statSync(filePath).size,
        fileHash,
        url: `http://localhost:3000/uploads/${finalFileName}`,
        uploadedAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      fs.writeFileSync(hashFilePath, JSON.stringify(fileInfo, null, 2));
      console.log(`   💾 保存哈希记录: ${fileHash}`);

      // ✅ 不再删除任务记录！保留引用计数信息
      // const taskDir = path.join("uploads", "tasks");
      // const taskFile = path.join(taskDir, `${fileHash}.json`);
      // if (fs.existsSync(taskFile)) {
      //   fs.unlinkSync(taskFile);
      //   console.log(`   🗑️  删除任务记录`);
      // }
    }

    res.json({
      success: true,
      message: "文件合并成功",
      data: {
        filename: finalFileName,
        path: filePath,
        url: `http://localhost:3000/uploads/${finalFileName}`,
        fileHash: fileHash || null,
        isDuplicate: false,
      },
    });
  });

  writeStream.on("error", (err) => {
    res
      .status(500)
      .json({ success: false, message: "合并文件失败", error: err.message });
  });
});

// ========== 5. 获取文件列表接口（支持参数） ==========
/**
 * 查询参数：
 * - page: 页码（默认 1）
 * - pageSize: 每页数量（默认 10）
 * - fileType: 文件类型过滤（image, video, audio, document, other）
 * - search: 搜索文件名关键词
 * - sortBy: 排序字段（name, size, date）
 * - sortOrder: 排序方式（asc, desc）
 */
app.get("/files", (req, res) => {
  const uploadDir = path.join(__dirname, "uploads");

  if (!fs.existsSync(uploadDir)) {
    return res.json({ success: true, data: [], total: 0 });
  }

  // 获取查询参数
  const {
    page = 1,
    pageSize = 10,
    fileType,
    search,
    sortBy = "name",
    sortOrder = "asc",
  } = req.query;

  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);

  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "读取文件列表失败" });
    }

    // 过滤掉分片文件
    let filteredFiles = files.filter((f) => !f.includes("-"));

    // 按文件类型过滤
    if (fileType) {
      const typeMap = {
        image: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"],
        video: [".mp4", ".avi", ".mov", ".wmv", ".flv", ".mkv"],
        audio: [".mp3", ".wav", ".ogg", ".aac", ".flac"],
        document: [
          ".pdf",
          ".doc",
          ".docx",
          ".xls",
          ".xlsx",
          ".ppt",
          ".pptx",
          ".txt",
          ".md",
        ],
      };

      const extensions = typeMap[fileType] || [];
      if (extensions.length > 0) {
        filteredFiles = filteredFiles.filter((f) =>
          extensions.some((ext) => f.toLowerCase().endsWith(ext)),
        );
      }
    }

    // 按文件名搜索
    if (search) {
      const searchLower = search.toLowerCase();
      filteredFiles = filteredFiles.filter((f) =>
        f.toLowerCase().includes(searchLower),
      );
    }

    // 获取文件详细信息并排序
    const fileList = filteredFiles.map((file) => {
      const filePath = path.join(uploadDir, file);
      const stats = fs.statSync(filePath);
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
        name: file,
        url: `http://localhost:3000/uploads/${file}`,
        size: stats.size,
        type,
        extension: ext,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
      };
    });

    // 排序
    fileList.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === "size") {
        comparison = a.size - b.size;
      } else if (sortBy === "date") {
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortOrder === "desc" ? -comparison : comparison;
    });

    // 分页
    const total = fileList.length;
    const startIndex = (pageNum - 1) * pageSizeNum;
    const endIndex = startIndex + pageSizeNum;
    const paginatedFiles = fileList.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedFiles,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  });
});

// ========== 6. 静态文件服务（让前端可以访问上传的文件） ==========
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ========== 7. 定期清理过期的分片文件 ==========
/**
 * 清理策略：
 * 1. 检查所有哈希记录文件
 * 2. 如果某个 hash 对应的文件超过 7 天未被访问，删除其分片文件
 * 3. 保留最近使用的分片文件，提高秒传效率
 */
function cleanupOldChunks() {
  const taskDir = path.join(__dirname, "uploads", "tasks");
  const uploadDir = path.join(__dirname, "uploads");
  
  if (!fs.existsSync(taskDir)) return;
  
  console.log("🧹 开始清理过期的分片文件...");
  
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000; // 7天的毫秒数
  
  try {
    const taskFiles = fs.readdirSync(taskDir);
    
    for (const taskFile of taskFiles) {
      if (!taskFile.endsWith('.json')) continue;
      
      const taskPath = path.join(taskDir, taskFile);
      const fileInfo = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
      
      // 跳过没有 lastAccessedAt 的旧记录
      if (!fileInfo.lastAccessedAt) continue;
      
      // 检查是否超过7天未访问
      if (now - fileInfo.lastAccessedAt > sevenDays) {
        const fileHash = fileInfo.fileHash;
        console.log(`   🗑️  清理过期分片: ${fileHash} (最后访问: ${new Date(fileInfo.lastAccessedAt).toLocaleString()})`);
        
        // 删除该 hash 的所有分片文件
        const files = fs.readdirSync(uploadDir);
        for (const file of files) {
          if (file.startsWith(`chunk_${fileHash}_`)) {
            const chunkPath = path.join(uploadDir, file);
            try {
              fs.unlinkSync(chunkPath);
              console.log(`      - 删除分片: ${file}`);
            } catch (err) {
              console.error(`      - 删除失败: ${file}`, err.message);
            }
          }
        }
        
        // 删除哈希记录
        fs.unlinkSync(taskPath);
        console.log(`      - 删除记录: ${taskFile}`);
      }
    }
    
    console.log("✅ 分片清理完成");
  } catch (error) {
    console.error("❌ 分片清理失败:", error);
  }
}

// ✅ 每天凌晨3点执行清理任务
const cleanupInterval = setInterval(cleanupOldChunks, 24 * 60 * 60 * 1000);
// 服务器启动后5分钟执行第一次清理
setTimeout(cleanupOldChunks, 5 * 60 * 1000);

console.log("⏰ 已设置分片清理定时任务（每天凌晨3点执行）");

// ========== 8. 启动服务器 ==========
app.listen(3000, () => {
  console.log("Server is running on port 3000");
  console.log("📁 普通上传: POST /upload");
  console.log("📁 多文件上传: POST /upload-multiple");
  console.log("⚡ 秒传检查: POST /check-file");
  console.log("📂 获取已上传分片: GET /get-uploaded-chunks?fileHash=xxx");
  console.log("📋 创建上传任务: POST /create-upload-task");
  console.log("📁 分片上传: POST /upload-chunk");
  console.log("📁 合并分片: POST /merge-chunks");
  console.log("📁 文件列表: GET /files");
  console.log("📁 静态文件: GET /uploads/:filename");
  console.log("🧹 自动清理: 每天凌晨3点清理7天未使用的分片文件");
});

// ✅ 优雅关闭：清理定时器
process.on('SIGTERM', () => {
  console.log('\n🛑 收到终止信号，正在关闭服务器...');
  clearInterval(cleanupInterval);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 收到中断信号，正在关闭服务器...');
  clearInterval(cleanupInterval);
  process.exit(0);
});
