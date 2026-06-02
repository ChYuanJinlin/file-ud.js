<script setup lang="ts">
import { ref, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Upload,
  Delete,
  Refresh,
  VideoPause,
  VideoPlay,
  CircleClose,
  Document,
  Picture,
  VideoCamera,
  Headset,
  Files,
  Setting,
  InfoFilled,
  Check,
  Loading,
  Warning,
} from "@element-plus/icons-vue";
import { FileUD, TransferFile, UploadFile } from "@file-ud.js/core";
import {
  uploadFile,
  upload,
  getFileList,
  checkFile,
  createUploadTask,
  mergeChunks,
} from "./api";
import { IFile } from "@file-ud.js/core/types";
import Uploader from "@file-ud.js/core/uploader";
import { uploadMonitor } from "@file-ud.js/core/utils";
import DownloadFile from "node_modules/@file-ud.js/core/src/downloader/DownloadFile";

// ==================== 初始化上传器 ====================
const isChunk = ref(true);

FileUD.startUDLogger({
  enabled: true,
});

const test1 = FileUD.createUploader<{
  url: string;
}>("test1", {
  action: "/api/upload-chunk",
  file({ formData, uploadFile, chunkIndex, data }) {
    formData.append("file", data);
    formData.append("fileHash", uploadFile.uploadChunkManager?.fileHash!);
    formData.append("fileName", uploadFile.File.name);
    formData.append("chunkIndex", chunkIndex?.toString()!);
    formData.append(
      "totalChunks",
      uploadFile.uploadChunkManager?.totalChunks.toString()!,
    );
  },
  multiple: true,
  chunkOptions: isChunk.value ? {} : null,
});

// ==================== 回调函数 ====================
test1.onMergeChunk = async (ch) => {
  const { data } = await mergeChunks({
    fileHash: ch.fileHash,
    fileName: ch.uploadFile.fileName,
    totalChunks: ch?.totalChunks!,
  });
  return data;
};

test1.onInitChunk = async (uploadFile) => {
  const { data } = await checkFile({
    fileHash: uploadFile.uploadChunkManager?.fileHash!,
    fileName: uploadFile.fileName,
  });

  // ✅ 情况1：真正的秒传 - 文件已完整存在
  if (data.exists && data.isInstantUpload === true) {
    console.log("⚡ 秒传成功，跳过上传和合并");
    return {
      ...data,
      url: data.fileInfo.url,
      isInstantUpload: true,
    };
  }

  // ✅ 情况2：分片可复用但文件不存在
  if (data.canReuseChunks === true) {
    console.log("🔄 分片可复用，但需要重新上传以创建新文件");
    return {
      chunks: data.chunks,
      fileHash: data.fileHash || "",
      shouldRemove: false,
    };
  }

  // ✅ 情况3：普通断点续传或新文件
  if (!data.exists) {
    if (data.chunks && data.chunks.length > 0) {
      console.log(
        `🔄 断点续传: ${data.chunks.length}/${data.totalChunks} 分片已上传`,
      );
      return {
        chunks: data.chunks,
        fileHash: data.fileHash || "",
        shouldRemove: false,
      };
    }

    console.log("📝 新文件，创建上传任务");
    await createUploadTask({
      fileHash: uploadFile.uploadChunkManager?.fileHash,
      fileName: uploadFile.fileName,
      totalChunks: uploadFile.uploadChunkManager?.totalChunks!,
      fileSize: uploadFile.File.size,
    });

    return {
      chunks: [],
      fileHash: "",
      shouldRemove: false,
    };
  }

  return {
    fileHash: data.fileHash || "",
    shouldRemove: false,
  };
};

// ==================== 响应式数据 ====================
const files = ref<TransferFile<UploadFile>[]>([]);
const files2 = ref<TransferFile<DownloadFile>[]>([]);

// ✅ 创建响应式的全局统计信息
const globalStats = ref({
  totalPercent: 0,
  totalBytes: 0,
  totalFormatSize: "0 B",
  transferredFormatSize: "0 B",
  speed: { averageSpeedFormatted: "0 B/s" },
});

// ✅ 监听 test1 的属性变化并更新响应式数据
const updateGlobalStats = () => {
  globalStats.value = {
    totalPercent: test1.totalPercent,
    totalBytes: test1.totalBytes,
    totalFormatSize: test1.totalFormatSize,
    transferredFormatSize: test1.transferredFormatSize,
    speed: test1.speed || { averageSpeedFormatted: "0 B/s" },
  };
};

Uploader.onError = (err) => {
  console.log("🚀 ~ err:1", err);
  ElMessage.error(`上传错误: ${err.message || "未知错误"}`);
};

test1.on("files-complete", (fileList) => {
  console.log("🚀 ~ fileList:", fileList);
  ElMessage.success("所有文件传输完成！");
});

test1.onSuccess = (res) => {
  console.log("🚀 ~ res:", res);
};

test1.onUpdate = (fileList) => {
  files.value = fileList;
  // ✅ 每次文件列表更新时，同步更新全局统计信息
  updateGlobalStats();
};

// ==================== 计算属性 ====================
const uploadingCount = computed(
  () => files.value.filter((f) => f.status === "UDLoading").length,
);

const pausedCount = computed(
  () => files.value.filter((f) => f.status === "paused").length,
);

const successCount = computed(
  () => files.value.filter((f) => f.status === "success").length,
);

const errorCount = computed(
  () => files.value.filter((f) => f.status === "error").length,
);

const cancelledCount = computed(
  () => files.value.filter((f) => f.status === "cancelled").length,
);

// ==================== 方法 ====================

// 切换上传模式
const handlerChunk = () => {
  if (isChunk.value) {
    isChunk.value = false;
    test1.updateConfig({
      chunkOptions: null,
      action: "/api/upload",
    });
    ElMessage.info("已切换到普通上传模式");
  } else {
    test1.updateConfig({
      chunkOptions: {},
      action: "/api/upload-chunk",
    });
    isChunk.value = true;
    ElMessage.info("已切换到大文件分片上传模式");
  }
};

// 获取文件类型图标
const getFileIcon = (file: UploadFile) => {
  const ext = file.extension?.toLowerCase() || "";
  if (
    [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"].includes(ext)
  ) {
    return Picture;
  } else if ([".mp4", ".avi", ".mov", ".wmv", ".flv", ".mkv"].includes(ext)) {
    return VideoCamera;
  } else if ([".mp3", ".wav", ".ogg", ".aac", ".flac"].includes(ext)) {
    return Headset;
  }
  return Document;
};

// 获取状态标签类型
const getStatusType = (
  status: string,
): "success" | "warning" | "danger" | "info" | undefined => {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "danger";
    case "paused":
      return "warning";
    case "cancelled":
      return "info";
    default:
      return undefined; // pending 和 UDLoading 使用默认样式
  }
};

// 获取状态文本
const getStatusText = (status: string) => {
  const statusMap: Record<string, string> = {
    pending: "等待中",
    UDLoading: "上传中",
    paused: "已暂停",
    success: "已完成",
    error: "上传错误",
    fail: "上传失败",
    merging: "合并文件中...",
    hashing: "计算文件哈希中...",
    cancelled: "已取消",
  };
  return statusMap[status] || status;
};

// 批量操作
const pauseAll = () => {
  test1.pauseAll();
  ElMessage.info("已全部暂停");
};

const resumeAll = () => {
  test1.resumeAll();
  ElMessage.success("已全部继续");
};

const cancelAll = () => {
  ElMessageBox.confirm("确定要取消所有文件的上传吗？", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(() => {
      test1.cancelAll();
      ElMessage.info("已全部取消");
    })
    .catch(() => {});
};

const retryAll = () => {
  test1.retryAll();
  ElMessage.success("已开始重试");
};

const clearFiles = () => {
  ElMessageBox.confirm("确定要清除文件列表吗？", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(() => {
      test1.clearFiles();
      // ✅ 清除文件后重置全局统计信息
      updateGlobalStats();
      ElMessage.success("文件列表已清除");
    })
    .catch(() => {});
};

// 打印监控报告
const printReport = () => {
  uploadMonitor.printReport();
  ElMessage.info("监控报告已输出到控制台");
};

(window as any).test1 = test1;
</script>

<template>
  <div class="app-container">
    <!-- <div>
      <button @click="test1.open()">上传文件</button>
      <button @click="test1.clearFiles()">清除文件列表</button>
      <button @click="loadSavedFiles()">🔄 回显文件（清空后回显）</button>
      <button @click="handlerChunk()">
        {{ isChunk ? "普通上传" : "大文件传输" }}
      </button>
      <button @click="test1.pauseAll()">全部暂停</button>
      <button @click="test1.resumeAll()">全部继续</button>
      <button @click="test1.cancelAll()">全部取消</button>
      <button @click="test1.retryAll()">全部重试</button>
      总的大小:{{ test1.totalBytes }} 总进度:{{ test1.totalPercent }} 总速度:{{
        test1.speed?.averageSpeedFormatted
      }}
      {{ test1.transferredFormatSize }}/{{ test1.totalFormatSize }}

      <div v-for="item in files" :key="item.fileId">
        进度{{ item.percent }} 状态{{ item.status }} 文件名{{
          item.fileName
        }}
        md5 效验状态{{ item.hashPercent }}%

        <img
          style="width: 200px; height: 200px"
          :src="item.url"
          alt=""
          srcset=""
        />
        <video width="500" height="500" :src="item.url" controls></video>
        <button @click="item.pause()">暂停</button>
        <button @click="item.resume()">继续</button>
        <button @click="item.cancel()">取消</button>
        <button @click="item.remove()">删除</button>
        <button @click="item.retry()">重试</button>
      </div>
    </div> -->
    <el-card class="header-card" shadow="hover">
      <div class="header-content">
        <h1 class="title">
          <el-icon :size="32" color="#409EFF"><Upload /></el-icon>
          File-UD 文件传输测试平台
        </h1>
        <p class="subtitle">支持秒传、断点续传、分片上传等多种功能</p>
      </div>
    </el-card>

    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stats-row">
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-item">
            <el-icon :size="24" color="#409EFF"><Loading /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ uploadingCount }}</div>
              <div class="stat-label">上传中</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-item">
            <el-icon :size="24" color="#E6A23C"><VideoPause /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ pausedCount }}</div>
              <div class="stat-label">已暂停</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-item">
            <el-icon :size="24" color="#67C23A"><Check /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ successCount }}</div>
              <div class="stat-label">已完成</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-item">
            <el-icon :size="24" color="#F56C6C"><CircleClose /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ errorCount }}</div>
              <div class="stat-label">失败</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-item">
            <el-icon :size="24" color="#909399"><InfoFilled /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ cancelledCount }}</div>
              <div class="stat-label">已取消</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-item">
            <el-icon :size="24" color="#409EFF"><Files /></el-icon>
            <div class="stat-info">
              <div class="stat-value">{{ files.length }}</div>
              <div class="stat-label">总文件数</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 全局进度 -->
    <el-card class="progress-card" shadow="hover">
      <div class="progress-header">
        <span class="progress-title">全局上传进度</span>
        <span class="progress-text">
          {{ globalStats.transferredFormatSize }} /
          {{ globalStats.totalFormatSize }}
        </span>
      </div>
      <el-progress
        :percentage="globalStats.totalPercent"
        :stroke-width="20"
        :format="((percent: number) => `${percent}%`) as any"
      />
      <div class="progress-info">
        <span>平均速度: {{ globalStats.speed.averageSpeedFormatted }}</span>
      </div>
    </el-card>

    <!-- 操作按钮区 -->
    <el-card class="action-card" shadow="hover">
      <div class="action-buttons">
        <el-button type="primary" :icon="Upload" @click="test1.open()">
          选择文件
        </el-button>
        <el-button :type="isChunk ? 'success' : 'info'" @click="handlerChunk">
          {{ isChunk ? "普通上传 " : "分片上传" }}
        </el-button>
        <el-button type="warning" :icon="VideoPause" @click="pauseAll">
          全部暂停
        </el-button>
        <el-button type="success" :icon="VideoPlay" @click="resumeAll">
          全部继续
        </el-button>
        <el-button type="danger" :icon="CircleClose" @click="cancelAll">
          全部取消
        </el-button>
        <el-button type="info" :icon="Refresh" @click="retryAll">
          全部重试
        </el-button>
        <el-button @click="clearFiles"> 清除列表 </el-button>
        <el-button type="primary" plain @click="printReport">
          监控报告
        </el-button>
      </div>
    </el-card>

    <!-- 文件列表 -->
    <el-card class="file-list-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>文件列表 ({{ files.length }})</span>
        </div>
      </template>

      <el-table
        :data="files"
        style="width: 100%"
        empty-text='暂无文件，请点击"选择文件"按钮添加'
      >
        <el-table-column label="文件名" min-width="200">
          <template #default="{ row }">
            <div class="file-name-cell">
              <el-icon :size="20" class="file-icon">
                <component :is="getFileIcon(row)" />
              </el-icon>
              <span class="file-name">{{ row.fileName }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="大小" width="100">
          <template #default="{ row }">
            {{ row.formatSize }}
          </template>
        </el-table-column>

        <el-table-column label="进度" width="200">
          <template #default="{ row }">
            <el-progress
              :percentage="row.percent"
              :status="row.status === 'error' ? 'exception' : undefined"
              :stroke-width="8"
            />
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag
              v-bind="
                getStatusType(row.status)
                  ? { type: getStatusType(row.status) }
                  : {}
              "
              size="small"
            >
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="MD5校验" width="100">
          <template #default="{ row }">
            <span>{{
              row.hashPercent !== undefined ? `${row.hashPercent}%` : "-"
            }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <div class="action-cell">
              <el-button
                v-if="row.status === 'UDLoading'"
                size="small"
                :icon="VideoPause"
                @click="row.pause()"
              >
                暂停
              </el-button>
              <el-button
                v-if="row.status === 'paused'"
                size="small"
                type="success"
                :icon="VideoPlay"
                @click="row.resume()"
              >
                继续
              </el-button>
              <el-button
                v-if="row.status === 'error' || row.status === 'cancelled'"
                size="small"
                type="warning"
                :icon="Refresh"
                @click="row.retry()"
              >
                重试
              </el-button>
              <el-button
                size="small"
                type="danger"
                :icon="Delete"
                @click="row.remove()"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.app-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.header-card {
  margin-bottom: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.header-card :deep(.el-card__body) {
  padding: 30px;
}

.header-content {
  text-align: center;
  color: white;
}

.title {
  font-size: 28px;
  margin: 0 0 10px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.subtitle {
  font-size: 14px;
  opacity: 0.9;
  margin: 0;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  height: 100%;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #303133;
}

.stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.progress-card {
  margin-bottom: 20px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-title {
  font-size: 16px;
  font-weight: bold;
  color: #303133;
}

.progress-text {
  font-size: 14px;
  color: #606266;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  font-size: 13px;
  color: #909399;
}

.action-card {
  margin-bottom: 20px;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.file-list-card {
  margin-bottom: 20px;
}

.card-header {
  font-size: 16px;
  font-weight: bold;
  color: #303133;
}

.file-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-icon {
  color: #409eff;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-cell {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* 表格样式优化 */
:deep(.el-table) {
  font-size: 14px;
}

:deep(.el-table th) {
  background-color: #f5f7fa;
  color: #606266;
  font-weight: 600;
}

:deep(.el-table td) {
  padding: 12px 0;
}

:deep(.el-progress-bar__outer) {
  background-color: #ebeef5;
}
</style>
