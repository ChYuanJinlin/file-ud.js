<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
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
} from "@element-plus/icons-vue";
import { Downloader, FileUD, Uploader } from "@file-ud.js/core";
import { disposeMD5Worker } from "@file-ud.js/core/utils";
import {
  uploadFile,
  upload,
  getFileList,
  checkFile,
  createUploadTask,
  mergeChunks,
  downloadFileApi,
  downloadExcelApi,
  deleteServerFile,
} from "./api";
import type { DownloaderConfig, UploaderConfig } from "@file-ud.js/core";
import { WatermarkPlugin } from "@file-ud.js/plugins/uploader";

// ==================== 共享工具函数 ====================

const getFileIcon = (ext?: string) => {
  const e = ext?.toLowerCase() || "";
  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"].includes(e))
    return Picture;
  if ([".mp4", ".avi", ".mov", ".wmv", ".flv", ".mkv"].includes(e))
    return VideoCamera;
  if ([".mp3", ".wav", ".ogg", ".aac", ".flac"].includes(e)) return Headset;
  return Document;
};

const statusTypeMap: Record<string, "success" | "warning" | "danger" | "info"> =
  {
    success: "success",
    error: "danger",
    fail: "danger",
    paused: "warning",
    cancelled: "info",
  };

const statusTextMap: Record<string, string> = {
  pending: "等待中",
  UDLoading: "传输中",
  paused: "已暂停",
  success: "已完成",
  error: "传输错误",
  fail: "传输失败",
  merging: "合并中",
  hashing: "计算哈希中",
  cancelled: "已取消",
};

// ==================== 上传器 ====================

const isChunkUpload = ref(true);

const buildUploaderConfig = (): UploaderConfig => {
  return {
    action(formData, file) {
      // 🔑 不依赖 isChunkUpload.value（模式切换后会变），
      //    改用 file.uploadChunkManager 判断（文件创建时就固定，不会变）
      return file.uploadChunkManager ? uploadFile(formData) : upload(formData);
    },
    multiple: true,
    headers: { Authorization: "Bearer your-token" },
    chunkOptions: isChunkUpload.value
      ? { chunkSize: 5 * 1024 * 1024, timeout: 0 }
      : null,
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
  };
};

const uploader = FileUD.createUploader("uploader", buildUploaderConfig());
uploader.use([
  new WatermarkPlugin({
    text: "© MyCompany",
    position: "bottom-right",
    opacity: 0.6,
  }),
]);
/** 合并已上传完毕的所有分片，调用后端合并接口完成文件最终写入 */
uploader.onMergeChunk = async (ch) => {
  const { data } = await mergeChunks({
    fileHash: ch.fileHash,
    fileName: ch.uploadFile.fileName,
    totalChunks: ch.totalChunks!,
  });
  return data;
};

uploader.onInitChunk = async (uploadFile) => {
  const { data } = await checkFile({
    fileHash: uploadFile.uploadChunkManager?.fileHash!,
    fileName: uploadFile.fileName,
  });

  if (data.exists && data.isInstantUpload === true) {
    return { ...data, url: data.fileInfo.url, isInstantUpload: true };
  }
  if (data.canReuseChunks) {
    return {
      chunks: data.chunks,
      fileHash: data.fileHash || "",
      shouldRemove: false,
    };
  }
  if (!data.exists) {
    if (data.chunks?.length) {
      return {
        chunks: data.chunks,
        fileHash: data.fileHash || "",
        shouldRemove: false,
      };
    }
    await createUploadTask({
      fileHash: uploadFile.uploadChunkManager?.fileHash,
      fileName: uploadFile.fileName,
      totalChunks: uploadFile.uploadChunkManager?.totalChunks!,
      fileSize: uploadFile.File.size,
    });
    return { chunks: [], fileHash: "", shouldRemove: false };
  }
  return { fileHash: data.fileHash || "", shouldRemove: false };
};

// ==================== 下载器（普通文件下载） ====================

const isChunkDownload = ref(true);
const isStreamSave = ref(true); // 🚀 流式保存开关（File System Access API）

const buildDownloaderConfig = (): DownloaderConfig => ({
  action(downloadFile) {
    return downloadFileApi(downloadFile.fileName);
  },
  chunkOptions: isChunkDownload.value
    ? {
        chunkSize: 20 * 1024 * 1024,
        // 🔑 启用 IndexedDB 缓存：下载进度保存到本地 + 重试时从本地恢复
        //     服务端的 check-file 只追踪上传进度，下载断点续传必须靠客户端 IndexedDB
        enableFileCache: true,
      }
    : null,
});

const downloader = FileUD.createDownloader(
  "downloader",
  buildDownloaderConfig(),
);

downloader.onInitChunk = async (downloadFile, totalChunks, fileHash) => {
  // 🔑 下载场景：向服务端查询真实 MD5 + 下载 URL
  //    - 秒下判断由下载器内部（Step 0 磁盘检查 + IndexedDB）完全管理
  //    - 回调只需返回 fileHash 和 url
  const res = await checkFile({
    fileHash,
    fileName: downloadFile.fileName,
    totalChunks,
    fileSize: downloadFile.getFileSize(),
  });
  const apiData = res?.data || res || {};
  const realHash = apiData.fileHash || fileHash;

  return {
    fileHash: realHash,
    url: apiData.fileInfo?.url || null,
    chunks: [],
  };
};

downloader.beforeTransferCallback = () => ({});

// ==================== Excel 下载器（POST，不分片） ====================

const excelDownloader = FileUD.createDownloader("excelDownloader", {
  action(downloadFile) {
    return downloadExcelApi({
      columns: 6,
      rows: 50,
      fileName: downloadFile.fileName || "test-excel",
    });
  },
  axiosOptions: { method: "post", responseType: "blob" },
});

// ==================== 日志 ====================

FileUD.startUDLogger({ enabled: true });

// ==================== 全局错误 ====================

Uploader.onError = (err: any) =>
  ElMessage.error(`上传错误: ${err.message || "未知错误"}`);

// ==================== 响应式数据 ====================

const uploadFiles = ref<any[]>([]);
const downloadFiles = ref<any[]>([]);
const serverFiles = ref<any[]>([]);
const serverFileTableRef = ref();
const serverFileSelection = ref<any[]>([]);

const uploadStats = ref({
  totalPercent: 0,
  totalFormatSize: "0 B",
  transferredFormatSize: "0 B",
  speed: "0 B/s",
  estimatedTimeFormatted: "计算中...",
});
const downloadStats = ref({
  totalPercent: 0,
  totalFormatSize: "0 B",
  transferredFormatSize: "0 B",
  speed: "0 B/s",
  estimatedTimeFormatted: "计算中...",
});

// ==================== 事件绑定 ====================

uploader.on("files-complete", () => {
  ElMessage.success("所有文件上传完成！");
  fetchServerFiles();
});

uploader.onSuccess = (res: any) => console.log("上传成功:", res);

uploader.onUpdate = (files: any[]) => {
  uploadFiles.value = files;
  uploadStats.value = {
    totalPercent: uploader.totalPercent,
    totalFormatSize: uploader.totalFormatSize,
    transferredFormatSize: uploader.transferredFormatSize,
    speed: uploader.speed?.averageSpeedFormatted || "0 B/s",
    estimatedTimeFormatted:
      uploader.speed?.estimatedTimeFormatted || "计算中...",
  };
};

const bindDownloaderEvents = (dl: any) => {
  dl.onUpdate = (files: any[]) => {
    downloadFiles.value = files;
    downloadStats.value = {
      totalPercent: dl.totalPercent,
      totalFormatSize: dl.totalFormatSize,
      transferredFormatSize: dl.transferredFormatSize,
      speed: dl.speed?.averageSpeedFormatted || "0 B/s",
      estimatedTimeFormatted: dl.speed?.estimatedTimeFormatted || "计算中...",
    };
  };
  dl.onSuccess = (res: any) => console.log("下载成功:", res);
  dl.on("error", (err: any) =>
    ElMessage.error(`下载失败: ${err.message || "未知错误"}`),
  );
};

bindDownloaderEvents(downloader);
bindDownloaderEvents(excelDownloader);

// 🔑 组件卸载时清理事件监听器，防止 SPA 路由切换时内存泄漏
onUnmounted(() => {
  (downloader as any).onUpdate = undefined;
  (downloader as any).onSuccess = undefined;
  (excelDownloader as any).onUpdate = undefined;
  (excelDownloader as any).onSuccess = undefined;
  (uploader as any).onUpdate = undefined;
  (uploader as any).onSuccess = undefined;

  // 释放 MD5 Worker 的 Blob URL，防止内存泄漏
  disposeMD5Worker();
});

// ==================== 获取服务端文件列表 ====================

const fetchServerFiles = () => {
  getFileList().then((res: any) => {
    serverFiles.value = res.data;
  });
};
fetchServerFiles();

// ==================== 模式切换 ====================

const toggleUploadMode = () => {
  isChunkUpload.value = !isChunkUpload.value;
  uploader.updateConfig(buildUploaderConfig());
  ElMessage.info(
    isChunkUpload.value ? "已切换到分片上传模式" : "已切换到普通上传模式",
  );
};

const toggleDownloadMode = () => {
  isChunkDownload.value = !isChunkDownload.value;
  downloader.updateConfig(buildDownloaderConfig());
  ElMessage.info(
    isChunkDownload.value ? "已切换到分片下载模式" : "已切换到普通下载模式",
  );
};

// ==================== 批量操作（uploader） ====================

const pauseAll = () => {
  uploader.pauseAll();
  ElMessage.info("已全部暂停");
};
const resumeAll = () => {
  uploader.resumeAll();
  ElMessage.success("已全部继续");
};
const cancelAll = () => {
  ElMessageBox.confirm("确定要取消所有上传吗？", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(() => {
      uploader.cancelAll();
      ElMessage.info("已全部取消");
    })
    .catch((err) => {
      console.log("🚀 ~ cancelAll ~ err:", err);
    });
};
const retryAll = () => {
  uploader.retryAll();
  ElMessage.success("已开始重试");
};
const clearUploadFiles = () => {
  ElMessageBox.confirm("确定要清除上传文件列表吗？", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(() => uploader.clearFiles())
    .catch(() => {});
};

// ==================== 批量操作（downloader） ====================

const dlPauseAll = () => {
  downloader.pauseAll();
  excelDownloader.pauseAll();
  ElMessage.info("已全部暂停");
};
const dlResumeAll = () => {
  downloader.resumeAll();
  excelDownloader.resumeAll();
  ElMessage.success("已全部继续");
};
const dlCancelAll = () => {
  ElMessageBox.confirm("确定要取消所有下载吗？", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(() => {
      downloader.cancelAll();
      excelDownloader.cancelAll();
      ElMessage.info("已全部取消");
    })
    .catch(() => {});
};
const dlRetryAll = () => {
  downloader.retryAll();
  excelDownloader.retryAll();
  ElMessage.success("已开始重试");
};

// ==================== 计数统计 ====================

const uploadCounts = computed(() => ({
  loading: uploadFiles.value.filter((f) => f.status === "UDLoading").length,
  paused: uploadFiles.value.filter((f) => f.status === "paused").length,
  success: uploadFiles.value.filter((f) => f.status === "success").length,
  error: uploadFiles.value.filter((f) => ["error", "fail"].includes(f.status))
    .length,
  cancelled: uploadFiles.value.filter((f) => f.status === "cancelled").length,
}));

const downloadCounts = computed(() => ({
  loading: downloadFiles.value.filter((f) => f.status === "UDLoading").length,
  paused: downloadFiles.value.filter((f) => f.status === "paused").length,
  success: downloadFiles.value.filter((f) => f.status === "success").length,
  error: downloadFiles.value.filter((f) =>
    ["error", "fail", "cancelled"].includes(f.status),
  ).length,
  cancelled: downloadFiles.value.filter((f) => f.status === "cancelled").length,
}));

// ==================== 服务端文件操作 ====================

/** 删除服务端文件 */
const handleDeleteFile = (row: any) => {
  const name = row.fileName || row.name || "";
  ElMessageBox.confirm(
    `确定要删除服务端文件 "${name}" 吗？此操作不可恢复！`,
    "删除确认",
    {
      confirmButtonText: "确定删除",
      cancelButtonText: "取消",
      type: "warning",
    },
  )
    .then(async () => {
      try {
        const res: any = await deleteServerFile(name);
        if (res.success) {
          ElMessage.success(`文件 "${name}" 已删除`);
          fetchServerFiles();
        } else {
          ElMessage.error(res.message || "删除失败");
        }
      } catch (err: any) {
        ElMessage.error(`删除失败: ${err.message || "未知错误"}`);
      }
    })
    .catch(() => {});
};

/** 批量下载 */
const batchDownload = () => {
  if (!serverFileSelection.value.length) return;
  serverFileSelection.value.forEach((row) => handleDownload(row));
};

/** 批量删除 */
const batchDelete = () => {
  if (!serverFileSelection.value.length) return;
  const names = serverFileSelection.value
    .map((r) => r.fileName || r.name || "")
    .join("、");
  ElMessageBox.confirm(
    `确定要删除选中的 ${serverFileSelection.value.length} 个文件吗？此操作不可恢复！\n${names}`,
    "批量删除确认",
    {
      confirmButtonText: "确定删除",
      cancelButtonText: "取消",
      type: "warning",
    },
  )
    .then(async () => {
      try {
        await Promise.all(
          serverFileSelection.value.map((row) => {
            const name = row.fileName || row.name || "";
            return deleteServerFile(name);
          }),
        );
        ElMessage.success(`已删除 ${serverFileSelection.value.length} 个文件`);
        serverFileTableRef.value?.clearSelection();
        fetchServerFiles();
      } catch (err: any) {
        ElMessage.error(`批量删除失败: ${err.message || "未知错误"}`);
      }
    })
    .catch(() => {});
};

// ==================== 下载辅助 ====================

/** 构造下载文件参数，为分片下载提供正确的代理 URL */
const handleDownload = async (row: any) => {
  const name = row.fileName || row.name || "";

  console.log(
    `[handleDownload] 开始下载: "${name}", isStreamSave=${isStreamSave.value}`,
  );

  // 🚀 流式保存：内部处理了兼容性检测 + 用户取消 + 错误回退
  const fileHandle = isStreamSave.value
    ? await Downloader.pickSaveFile(name)
    : undefined;

  console.log(
    `[handleDownload] pickSaveFile 返回:`,
    fileHandle ? `FileHandle(${fileHandle.name})` : fileHandle,
  );

  // null = 用户取消；undefined = API 不可用，回退到普通模式
  if (fileHandle === null) {
    ElMessage.info("已取消保存");
    return;
  }

  downloader.downloadFile(
    {
      url: `/api/download/${encodeURIComponent(name)}`,
      fileName: name,
      size: row.size,
    },
    fileHandle ?? undefined,
  );
};

// ==================== 调试 ====================
(window as any).test1 = uploader;
(window as any).test2 = downloader;
</script>

<template>
  <div class="app-container">
    <!-- ====== Header ====== -->
    <el-card class="header-card" shadow="hover">
      <div class="header-content">
        <h1 class="title">
          <el-icon :size="32" color="#409EFF"><Upload /></el-icon>
          File-UD 文件传输测试平台
        </h1>
        <p class="subtitle">支持秒传、断点续传、分片上传下载</p>
      </div>
    </el-card>

    <!-- ====== 全局进度 ====== -->
    <el-row :gutter="16" class="stats-row">
      <el-col :span="12">
        <el-card shadow="hover" class="progress-card">
          <div class="progress-header">
            <span class="section-title">📤 上传进度</span>
            <span class="progress-text"
              >{{ uploadStats.transferredFormatSize }} /
              {{ uploadStats.totalFormatSize }}</span
            >
          </div>
          <el-progress
            :percentage="uploadStats.totalPercent"
            :stroke-width="16"
          />
          <div class="progress-speed">平均速度: {{ uploadStats.speed }}</div>
          <div
            class="progress-speed"
            v-if="
              uploadStats.totalPercent > 0 && uploadStats.totalPercent < 100
            "
          >
            预计剩余: {{ uploadStats.estimatedTimeFormatted }}
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover" class="progress-card">
          <div class="progress-header">
            <span class="section-title">📥 下载进度</span>
            <span class="progress-text"
              >{{ downloadStats.transferredFormatSize }} /
              {{ downloadStats.totalFormatSize }}</span
            >
          </div>
          <el-progress
            :percentage="downloadStats.totalPercent"
            :stroke-width="16"
          />
          <div class="progress-speed">平均速度: {{ downloadStats.speed }}</div>
          <div
            class="progress-speed"
            v-if="
              downloadStats.totalPercent > 0 && downloadStats.totalPercent < 100
            "
          >
            预计剩余: {{ downloadStats.estimatedTimeFormatted }}
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ====== 上传区域 ====== -->
    <el-card class="section-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="section-title"
            >📤 文件上传 ({{ uploadFiles.length }})</span
          >
          <span class="header-stats">
            <span class="stat-badge pending"
              >等待
              {{
                uploadFiles.filter((f) => f.status === "pending").length
              }}</span
            >
            <span class="stat-badge loading"
              >上传中 {{ uploadCounts.loading }}</span
            >
            <span class="stat-badge success"
              >完成 {{ uploadCounts.success }}</span
            >
            <span class="stat-badge error" v-if="uploadCounts.error"
              >失败 {{ uploadCounts.error }}</span
            >
          </span>
        </div>
      </template>

      <div class="action-bar">
        <el-button-group>
          <el-button type="primary" :icon="Upload" @click="uploader.open()"
            >选择文件</el-button
          >
          <el-button
            :type="isChunkUpload ? 'warning' : 'success'"
            plain
            @click="toggleUploadMode"
          >
            {{ isChunkUpload ? "分片上传" : "普通上传" }}
          </el-button>
          <el-button
            :icon="VideoPause"
            @click="pauseAll"
            :disabled="!uploadCounts.loading"
            >暂停</el-button
          >
          <el-button
            :icon="VideoPlay"
            type="success"
            @click="resumeAll"
            :disabled="!uploadCounts.paused"
            >继续</el-button
          >
          <el-button
            :icon="Refresh"
            type="warning"
            @click="retryAll"
            :disabled="!uploadCounts.error"
            >重试</el-button
          >
          <el-button :icon="CircleClose" type="danger" @click="cancelAll"
            >取消</el-button
          >
          <el-button :icon="Delete" @click="clearUploadFiles">清空</el-button>
        </el-button-group>
      </div>

      <el-table :data="uploadFiles" empty-text="暂无上传文件">
        <el-table-column label="文件名" min-width="200">
          <template #default="{ row }">
            <div class="file-name-cell">
              <el-icon :size="18"
                ><component :is="getFileIcon(row.extension)"
              /></el-icon>
              <span>{{ row.fileName }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="90"
          ><template #default="{ row }">{{
            row.formatSize
          }}</template></el-table-column
        >
        <el-table-column label="进度" width="180">
          <template #default="{ row }">
            <el-progress
              :percentage="row.percent"
              :status="row.status === 'error' ? 'exception' : undefined"
              :stroke-width="8"
            />
          </template>
        </el-table-column>
        <el-table-column label="预计剩余" width="90">
          <template #default="{ row }">
            {{
              row.status === "UDLoading" && row.speed?.estimatedTimeFormatted
                ? row.speed.estimatedTimeFormatted
                : "-"
            }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]" size="small">{{
              statusTextMap[row.status] || row.status
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="80">
          <template #default="{ row }">
            {{
              row.status === "success"
                ? row.transferTime?.durationFormatted || "-"
                : "-"
            }}
          </template>
        </el-table-column>
        <el-table-column label="平均速度" width="100">
          <template #default="{ row }">
            {{
              row.status === "success"
                ? row.speed?.averageSpeedFormatted || "-"
                : "-"
            }}
          </template>
        </el-table-column>
        <el-table-column label="哈希" width="80">
          <template #default="{ row }">{{
            row.hashPercent ? `${row.hashPercent}%` : "-"
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'UDLoading'"
              size="small"
              :icon="VideoPause"
              @click="row.pause()"
              >暂停</el-button
            >
            <el-button
              v-if="row.status === 'paused'"
              size="small"
              type="success"
              :icon="VideoPlay"
              @click="row.resume()"
              >继续</el-button
            >
            <el-button
              v-if="['error', 'fail', 'cancelled'].includes(row.status)"
              size="small"
              type="warning"
              :icon="Refresh"
              @click="row.retry()"
              >重试</el-button
            >
            <el-button
              v-if="row.status === 'UDLoading' || row.status === 'paused'"
              size="small"
              :icon="CircleClose"
              type="danger"
              @click="row.cancel()"
              >取消</el-button
            >
            <el-button
              v-if="
                ['success', 'error', 'fail', 'cancelled'].includes(row.status)
              "
              size="small"
              type="danger"
              :icon="Delete"
              @click="row.remove()"
              >删除</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- ====== 服务端文件列表 ====== -->
    <el-card class="section-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="section-title"
            >📁 服务端文件 ({{ serverFiles.length }})</span
          >
          <div style="display: flex; gap: 8px">
            <el-button
              size="small"
              type="primary"
              :disabled="!serverFileSelection.length"
              @click="batchDownload"
            >
              批量下载 ({{ serverFileSelection.length }})
            </el-button>
            <el-button
              size="small"
              type="danger"
              :disabled="!serverFileSelection.length"
              @click="batchDelete"
            >
              批量删除 ({{ serverFileSelection.length }})
            </el-button>
            <el-button size="small" :icon="Refresh" @click="fetchServerFiles"
              >刷新</el-button
            >
          </div>
        </div>
      </template>
      <el-table
        ref="serverFileTableRef"
        :data="serverFiles"
        empty-text="暂无文件"
        @selection-change="serverFileSelection = $event"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column label="文件名" min-width="220">
          <template #default="{ row }">
            <div class="file-name-cell">
              <el-icon :size="18"
                ><component :is="getFileIcon(row.extension)"
              /></el-icon>
              <span>{{ row.fileName || row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="90"
          ><template #default="{ row }">{{
            row.formatSize || row.size
          }}</template></el-table-column
        >
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="handleDownload(row)">
              {{ isChunkDownload ? "分片下载" : "直接下载" }}
            </el-button>
            <el-button
              size="small"
              type="danger"
              :icon="Delete"
              @click="handleDeleteFile(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- ====== 下载区域 ====== -->
    <el-card class="section-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="section-title"
            >📥 文件下载 ({{ downloadFiles.length }})</span
          >
          <span class="header-stats">
            <span class="stat-badge loading"
              >下载中 {{ downloadCounts.loading }}</span
            >
            <span class="stat-badge success"
              >完成 {{ downloadCounts.success }}</span
            >
            <span class="stat-badge error" v-if="downloadCounts.error"
              >失败 {{ downloadCounts.error }}</span
            >
          </span>
        </div>
      </template>

      <div class="action-bar">
        <el-button-group>
          <el-button
            :type="isChunkDownload ? 'warning' : 'success'"
            plain
            @click="toggleDownloadMode"
          >
            {{ isChunkDownload ? "分片下载" : "普通下载" }}
          </el-button>
          <el-button
            :type="isStreamSave ? 'primary' : 'info'"
            plain
            @click="isStreamSave = !isStreamSave"
          >
            {{ isStreamSave ? "🚀 流式保存" : "💾 内存合并" }}
          </el-button>
          <el-button
            @click="
              excelDownloader.downloadFile({
                fileName: 'excel_' + Date.now(),
                url: '',
                size: 0,
              } as any)
            "
          >
            POST下载Excel
          </el-button>
          <el-button
            :icon="VideoPause"
            @click="dlPauseAll"
            :disabled="!downloadCounts.loading"
            >暂停</el-button
          >
          <el-button
            :icon="VideoPlay"
            type="success"
            @click="dlResumeAll"
            :disabled="!downloadCounts.paused"
            >继续</el-button
          >
          <el-button
            :icon="Refresh"
            type="warning"
            @click="dlRetryAll"
            :disabled="!downloadCounts.error"
            >重试</el-button
          >
          <el-button :icon="CircleClose" type="danger" @click="dlCancelAll"
            >取消</el-button
          >
        </el-button-group>
      </div>

      <el-table :data="downloadFiles" empty-text="暂无下载任务">
        <el-table-column label="文件名" min-width="200">
          <template #default="{ row }">
            <div class="file-name-cell">
              <el-icon :size="18"
                ><component :is="getFileIcon(row.extension)"
              /></el-icon>
              <span>{{ row.fileName }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="90"
          ><template #default="{ row }">{{
            row.formatSize
          }}</template></el-table-column
        >
        <el-table-column label="进度" width="180">
          <template #default="{ row }">
            <el-progress
              :percentage="row.percent"
              :status="row.status === 'error' ? 'exception' : undefined"
              :stroke-width="8"
            />
          </template>
        </el-table-column>
        <el-table-column label="预计剩余" width="90">
          <template #default="{ row }">
            {{
              row.status === "UDLoading" && row.speed?.estimatedTimeFormatted
                ? row.speed.estimatedTimeFormatted
                : "-"
            }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]" size="small">{{
              statusTextMap[row.status] || row.status
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="80">
          <template #default="{ row }">
            {{
              row.status === "success"
                ? row.transferTime?.durationFormatted || "-"
                : "-"
            }}
          </template>
        </el-table-column>
        <el-table-column label="平均速度" width="100">
          <template #default="{ row }">
            {{
              row.status === "success"
                ? row.speed?.averageSpeedFormatted || "-"
                : "-"
            }}
          </template>
        </el-table-column>
        <el-table-column label="哈希" width="80">
          <template #default="{ row }">{{
            row.hashPercent ? `${row.hashPercent}%` : "-"
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'UDLoading'"
              size="small"
              :icon="VideoPause"
              @click="row.pause()"
              >暂停</el-button
            >
            <el-button
              v-if="row.status === 'paused'"
              size="small"
              type="success"
              :icon="VideoPlay"
              @click="row.resume()"
              >继续</el-button
            >
            <el-button
              v-if="['error', 'fail', 'cancelled'].includes(row.status)"
              size="small"
              type="warning"
              :icon="Refresh"
              @click="row.retry()"
              >重试</el-button
            >
            <el-button
              v-if="row.status === 'UDLoading' || row.status === 'paused'"
              size="small"
              :icon="CircleClose"
              type="danger"
              @click="row.cancel()"
              >取消</el-button
            >
            <el-button
              v-if="
                ['success', 'error', 'fail', 'cancelled'].includes(row.status)
              "
              size="small"
              type="danger"
              :icon="Delete"
              @click="row.remove()"
              >删除</el-button
            >
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

/* Header */
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
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.subtitle {
  font-size: 14px;
  opacity: 0.9;
  margin: 0;
}

/* Stats */
.stats-row {
  margin-bottom: 20px;
}
.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.progress-text {
  font-size: 14px;
  color: #606266;
}
.progress-speed {
  margin-top: 10px;
  font-size: 13px;
  color: #909399;
}

/* Section Cards */
.section-card {
  margin-bottom: 20px;
}
.section-title {
  font-size: 16px;
  font-weight: bold;
  color: #303133;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.action-bar {
  margin-bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Header Stats Badges */
.header-stats {
  display: flex;
  gap: 8px;
  font-size: 13px;
}
.stat-badge {
  padding: 2px 10px;
  border-radius: 12px;
  color: white;
}
.stat-badge.pending {
  background: #909399;
}
.stat-badge.loading {
  background: #409eff;
}
.stat-badge.success {
  background: #67c23a;
}
.stat-badge.error {
  background: #f56c6c;
}

/* File Cell */
.file-name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Table */
::deep(.el-table th) {
  background-color: #f5f7fa;
  font-weight: 600;
}
::deep(.el-table td) {
  padding: 10px 0;
}
::deep(.el-progress-bar__outer) {
  background-color: #ebeef5;
}
</style>
