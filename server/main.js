const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const app = express();
const cors = require("cors");

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
  }
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
      message: "没有文件被上传"
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
      url: `http://localhost:3000/uploads/${req.file.filename}`
    }
  };

  console.log(`✅ 文件上传成功: ${req.file.originalname} (${req.file.size} bytes)`);
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
      message: "没有文件被上传"
    });
  }

  const filesInfo = req.files.map(file => ({
    originalName: file.originalname,
    filename: file.filename,
    size: file.size,
    mimetype: file.mimetype,
    path: file.path,
    url: `http://localhost:3000/uploads/${file.filename}`
  }));

  console.log(`✅ 多文件上传成功: ${filesInfo.length} 个文件`);
  res.json({
    success: true,
    message: `${filesInfo.length} 个文件上传成功`,
    data: filesInfo
  });
});

// ========== 3. 分片上传接口 ==========
app.post("/upload-chunk", upload.single("file"), (req, res) => {
  const { chunkIndex, totalChunks, fileName } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ success: false, message: "没有文件分片" });
  }

  // 使用文件名作为分片标识
  const chunkFileName = `${fileName || req.file.originalname}-${chunkIndex}`;
  const filePath = path.join("uploads", chunkFileName);
  
  fs.rename(req.file.path, filePath, (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: "保存分片失败" });
    }
    res.json({ success: true, message: "分片上传成功", chunkIndex });
  });
});

// ========== 4. 合并分片接口 ==========
app.post("/merge-chunks", async (req, res) => {
  const { fileName, totalChunks, originalName } = req.body;
  
  if (!fileName || !totalChunks) {
    return res.status(400).json({ success: false, message: "缺少必要参数" });
  }

  const finalFileName = originalName || fileName;
  const filePath = path.join("uploads", finalFileName);
  const writeStream = fs.createWriteStream(filePath);

  let completed = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join("uploads", `${fileName}-${i}`);
    
    if (!fs.existsSync(chunkPath)) {
      return res.status(500).json({ 
        success: false, 
        message: `分片 ${i} 不存在` 
      });
    }

    const readStream = fs.createReadStream(chunkPath);
    
    await new Promise((resolve, reject) => {
      readStream.pipe(writeStream, { end: false });
      
      readStream.on("end", () => {
        completed++;
        // 删除已合并的分片
        fs.unlink(chunkPath, (err) => {
          if (err) console.error(`删除分片 ${i} 失败:`, err);
        });
        resolve();
      });
      
      readStream.on("error", reject);
    });
  }

  writeStream.end();
  
  writeStream.on("finish", () => {
    res.json({ 
      success: true, 
      message: "文件合并成功",
      data: {
        filename: finalFileName,
        path: filePath,
        url: `http://localhost:3000/uploads/${finalFileName}`
      }
    });
  });
  
  writeStream.on("error", (err) => {
    res.status(500).json({ success: false, message: "合并文件失败", error: err.message });
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
    sortBy = 'name',
    sortOrder = 'asc'
  } = req.query;
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      return res.status(500).json({ success: false, message: "读取文件列表失败" });
    }
    
    // 过滤掉分片文件
    let filteredFiles = files.filter(f => !f.includes("-"));
    
    // 按文件类型过滤
    if (fileType) {
      const typeMap = {
        'image': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'],
        'video': ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv'],
        'audio': ['.mp3', '.wav', '.ogg', '.aac', '.flac'],
        'document': ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md']
      };
      
      const extensions = typeMap[fileType] || [];
      if (extensions.length > 0) {
        filteredFiles = filteredFiles.filter(f => 
          extensions.some(ext => f.toLowerCase().endsWith(ext))
        );
      }
    }
    
    // 按文件名搜索
    if (search) {
      const searchLower = search.toLowerCase();
      filteredFiles = filteredFiles.filter(f => 
        f.toLowerCase().includes(searchLower)
      );
    }
    
    // 获取文件详细信息并排序
    const fileList = filteredFiles.map(file => {
      const filePath = path.join(uploadDir, file);
      const stats = fs.statSync(filePath);
      const ext = path.extname(file).toLowerCase();
      
      let type = 'other';
      if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'].includes(ext)) type = 'image';
      else if (['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv'].includes(ext)) type = 'video';
      else if (['.mp3', '.wav', '.ogg', '.aac', '.flac'].includes(ext)) type = 'audio';
      else if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md'].includes(ext)) type = 'document';
      
      return {
        name: file,
        url: `http://localhost:3000/uploads/${file}`,
        size: stats.size,
        type,
        extension: ext,
        createdAt: stats.birthtime,
        updatedAt: stats.mtime
      };
    });
    
    // 排序
    fileList.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'size') {
        comparison = a.size - b.size;
      } else if (sortBy === 'date') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortOrder === 'desc' ? -comparison : comparison;
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
      totalPages: Math.ceil(total / pageSizeNum)
    });
  });
});

// ========== 6. 静态文件服务（让前端可以访问上传的文件） ==========
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ========== 启动服务器 ==========
app.listen(3000, () => {
  console.log("Server is running on port 3000");
  console.log("📁 普通上传: POST /upload");
  console.log("📁 多文件上传: POST /upload-multiple");
  console.log("📁 分片上传: POST /upload-chunk");
  console.log("📁 合并分片: POST /merge-chunks");
  console.log("📁 文件列表: GET /files");
  console.log("📁 静态文件: GET /uploads/:filename");
});