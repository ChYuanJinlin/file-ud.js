<script setup lang="ts">
import { FileUD, UploadFile } from "@file-ud.js/core";
import {
  uploadFile,
  upload,
  getFileList,
  checkFile,
  createUploadTask,
  mergeChunks,
} from "./api";
import {
  CompressImagePlugin,
  FileValidatorPlugin,
  WatermarkPlugin,
  SmartRetryPlugin, // ✅ 新增：智能重试插件
} from "@file-ud.js/plugins";

import { ref } from "vue";
import Uploader from "@file-ud.js/core/uploader";
import { uploadMonitor } from "@file-ud.js/core/utils";
import { IFile } from "@file-ud.js/core/types";

const isChunk = ref(true);
FileUD.startUploadLogger({
  enabled: true,
});
const test1 = FileUD.createUploader<{
  url: string;
}>("test1", {
  action: "/api/upload-chunk",
  // file: "file",

  file({ formData, uploadFile, chunkIndex, data }) {
    formData.append("file", data);
    formData.append("fileHash", uploadFile.chunkManager?.fileHash!);
    formData.append("fileName", uploadFile.File.name);
    formData.append("chunkIndex", chunkIndex?.toString()!);
    formData.append(
      "totalChunks",
      uploadFile.chunkManager?.totalChunks.toString()!,
    );
  },
  multiple: true,
  chunkOptions: isChunk.value
    ? {
        // retries: null,
      }
    : null,
});

// ✅ 新增：使用智能重试插件
// test1.use(
//   new SmartRetryPlugin({
//     maxRetries: 3, // 最多重试 3 次
//     strategy: "exponential", // 指数退避策略
//     initialDelay: 1000, // 初始延迟 1 秒
//     maxDelay: 30000, // 最大延迟 30 秒
//     showRetryNotification: true, // 显示重试通知
//   }),
// );

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
    fileHash: uploadFile.chunkManager?.fileHash!,
    fileName: uploadFile.fileName,
  });

  console.log("📋 check-file 返回:", data);

  // ✅ 情况1：真正的秒传 - 文件已完整存在
  if (data.exists && data.isInstantUpload === true) {
    console.log("⚡ 秒传成功，跳过上传和合并");
    return {
      ...data,
      url: data.fileInfo.url,
      isInstantUpload: true, // 明确标记为秒传// ✅ 自动移除重复文件
    };
  }

  // ✅ 情况2：分片可复用但文件不存在 - 需要重新上传以创建新文件
  if (data.canReuseChunks === true) {
    console.log("🔄 分片可复用，但需要重新上传以创建新文件");
    // 返回空数组，让前端重新上传所有分片
    // 后端会检测到分片已存在，直接返回成功（秒传分片）
    return {
      uploadedChunks:data.uploadedChunks, // 告诉前端需要上传所有分片
      fileHash: data.fileHash || "",
      shouldRemove: false, // ❌ 不移除，需要继续上传
    };
  }

  // ✅ 情况3：普通断点续传或新文件
  if (!data.exists) {
    // 检查是否有已上传的分片
    if (data.uploadedChunks && data.uploadedChunks.length > 0) {
      console.log(
        `🔄 断点续传: ${data.uploadedChunks.length}/${data.totalChunks} 分片已上传`,
      );
      return {
        uploadedChunks: data.uploadedChunks,
        fileHash: data.fileHash || "",
        shouldRemove: false,
      };
    }

    // 新文件，需要创建任务
    console.log("📝 新文件，创建上传任务");
    await createUploadTask({
      fileHash: uploadFile.chunkManager?.fileHash,
      fileName: uploadFile.fileName,
      totalChunks: uploadFile.chunkManager?.totalChunks!,
      fileSize: uploadFile.File.size,
    });

    return {
      uploadedChunks: [],
      fileHash: "",
      shouldRemove: false,
    };
  }

  // 默认返回
  return {
    fileHash: data.fileHash || "",
    shouldRemove: false,
  };
};

const files = ref<UploadFile[]>([]);
Uploader.onError = (err) => {
  console.log("🚀 ~ err:1", err);
};
test1.on("files-complete", (fileList) => {
  uploadMonitor.printReport();
});
test1.onSuccess = (res) => {
  console.log("🚀 ~ res:", res);
};
test1.onUpdate = (fileList) => {
  files.value = fileList;
};
const handlerChunk = () => {
  if (isChunk.value) {
    test1.updateConfig({
      chunkOptions: null,
    });
    isChunk.value = false;
  } else {
    isChunk.value = true;
    test1.updateConfig({
      chunkOptions: {},
    });
  }
};
getFileList({
  page: 1,
  pageSize: 10,
}).then((res) => {
  console.log("🚀 ~ submit ~ res:", res);
});

// ✅ 新增：演示 setFiles 方法 - 文件回显功能
const loadSavedFiles = () => {
  // 模拟从服务端或 localStorage 获取已保存的文件列表
  const savedFiles: IFile[] = [
    {
      fileId: "file_001",
      fileName: "example-photo.jpg",
      File: new File([], "example-photo.jpg"), // 实际使用时需要从服务器下载或用户重新选择
      url: "https://example.com/photos/example-photo.jpg",
      percent: 100,
      status: "success" as const,
      formatSize: "2.35 MB",
      extension: ".jpg",
    },
    {
      fileId: "file_002",
      fileName: "demo-video.mp4",
      File: new File([], "demo-video.mp4"),
      url: "https://example.com/videos/demo-video.mp4",
      percent: 100,
      status: "success" as const,
      formatSize: "15.80 MB",
      extension: ".mp4",
    },
  ];

  // 回显文件列表（清空现有）
  test1.setFiles(savedFiles);
  console.log("✅ 文件回显成功", test1.files);
};
window.test1 = test1
</script>

<template>
  <div>
    <button @click="test1.open()">上传文件</button>
    <button @click="test1.clearFiles()">清除文件列表</button>
    <button @click="loadSavedFiles()">🔄 回显文件（清空后回显）</button>
    <button @click="handlerChunk()">
      {{ isChunk ? "普通上传" : "大文件上传" }}
    </button>
    <button @click="test1.pauseAll()">全部暂停</button>
    <button @click="test1.resumeAll()">全部继续</button>
    <button @click="test1.cancelAll()">全部取消</button>
    <button @click="test1.retryAll()">全部重试</button>
    总的大小:{{ test1.totalBytes }} 总进度:{{ test1.totalPercent }} 总速度:{{
      test1.uploadSpeed?.averageSpeedFormatted
    }}
    {{ test1.uploadedFormatSize }}/{{ test1.totalFormatSize }}

    <div v-for="item in files" :key="item.fileId">
      进度{{ item.percent }} 状态{{ item.status }} 文件名{{ item.fileName }} md5
      效验状态{{ item.hashPercent }}%

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
  </div>
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
</style>
