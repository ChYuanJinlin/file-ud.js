const fs = require('fs');
const path = 'server/main.js';

console.log('🔧 开始修复 server/main.js...');

let content = fs.readFileSync(path, 'utf-8');
const originalLines = content.split('\n').length;

// 修改1: 简化 check-file 接口
const checkFileOld = `  // 2. 文件未完整上传，检查是否有其他文件的部分分片可以复用
  // 遍历任务目录，查找相同 fileHash 的任务记录
  let reusableChunks = [];
  
  try {
    const taskFiles = fs.readdirSync(taskDir);
    
    for (const taskFile of taskFiles) {
      if (!taskFile.endsWith('.json')) continue;
      
      const taskPath = path.join(taskDir, taskFile);
      const taskInfo = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
      
      // 找到相同 fileHash 的任务
      if (taskInfo.fileHash === fileHash && taskInfo.chunks) {
        reusableChunks = taskInfo.chunks;
        console.log(\`🔄 发现可复用分片: \${reusableChunks.length}/\${totalChunks} (来自任务: \${taskFile})\`);
        break;
      }
    }
  } catch (error) {
    console.error("检查可复用分片失败:", error);
  }

  // 3. 检查物理分片文件是否存在
  const existingChunks = [];
  for (const chunkIndex of reusableChunks) {
    // ✅ 修复：使用与 upload-chunk 接口一致的分片文件名格式
    const chunkPath = path.join(uploadDir, \`chunk_\${fileHash}_\${chunkIndex}\`);
    if (fs.existsSync(chunkPath)) {
      existingChunks.push(chunkIndex);
    }
  }

  // 文件不存在，返回需要上传的分片列表（用于断点续传检查）
  console.log(\`📝 文件不存在，需要上传: \${fileName} (fileHash: \${fileHash})\`);
  console.log(\`   可复用分片: \${existingChunks.length}/\${totalChunks}\`);
  
  res.json({
    success: true,
    message: "文件不存在，需要上传",
    data: {
      exists: false,
      chunks: existingChunks, // 返回已存在的分片索引
      totalChunks: totalChunks || 0,
    },
  });`;

const checkFileNew = `  // 文件不存在，需要上传
  console.log(\`📝 文件不存在，需要上传: \${fileName} (fileHash: \${fileHash})\`);
  
  res.json({
    success: true,
    message: "文件不存在，需要上传",
    data: {
      exists: false,
      chunks: [], // 没有已上传的分片
      totalChunks: totalChunks || 0,
      canReuseChunks: false,
    },
  });`;

if (content.includes(checkFileOld)) {
  content = content.replace(checkFileOld, checkFileNew);
  console.log('✅ check-file 接口简化成功');
} else {
  console.log('⚠️  check-file 接口可能已经修改过或未找到匹配内容');
}

// 修改2: 合并后不删除 Hash 记录
const mergeOld = `      // 删除任务记录
      const taskDir = path.join("uploads", "tasks");
      const taskFile = path.join(taskDir, \`\${fileHash}.json\`);
      if (fs.existsSync(taskFile)) {
        fs.unlinkSync(taskFile);
        console.log(\`   🗑️  删除任务记录\`);
      }`;

const mergeNew = `      // ✅ 不再删除任务记录！保留 Hash 记录用于下次秒传
      // const taskDir = path.join("uploads", "tasks");
      // const taskFile = path.join(taskDir, \`\${fileHash}.json\`);
      // if (fs.existsSync(taskFile)) {
      //   fs.unlinkSync(taskFile);
      //   console.log(\`   🗑️  删除任务记录\`);
      // }`;

if (content.includes(mergeOld)) {
  content = content.replace(mergeOld, mergeNew);
  console.log('✅ merge-chunks 接口修改成功');
} else {
  console.log('⚠️  merge-chunks 接口可能已经修改过或未找到匹配内容');
}

// 保存文件
fs.writeFileSync(path, content, 'utf-8');
const newLines = content.split('\n').length;

console.log(`\n📊 修改统计:`);
console.log(`   原始行数: ${originalLines}`);
console.log(`   修改后行数: ${newLines}`);
console.log(`   变化: ${newLines - originalLines} 行`);
console.log('\n✅ 修复完成！请运行 node -c server/main.js 验证语法');
