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
} from "@file-ud.js/plugins";

import { ref } from "vue";
import Uploader from "@file-ud.js/core/uploader";
import { IFile } from "@file-ud.js/core/types";
import { uploadMonitor } from "@file-ud.js/core/utils";

const isChunk = ref(true);
FileUD.startUploadLogger({
  enabled: true,
});
const test1 = FileUD.createUploader("test1", {
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
        retries: null,
      }
    : null,
});
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
  
  // ✅ 关键修复：只有当文件真正存在时才秒传
  if (data.exists && data.canReuseChunks !== true) {
    // 真正的秒传：文件已存在
    console.log("⚡ 秒传成功，跳过上传和合并");
    return {
      ...data,
      isInstantUpload: true, // ✅ 明确标记为秒传，前端不会调用合并接口
    };
  } else if (data.canReuseChunks) {
    // 分片可复用但目标文件不存在，需要重新上传
    console.log("🔄 分片可复用，但需要重新上传以创建新文件");
    // 返回空数组，让前端重新上传所有分片
    // 后端会检测到分片已存在，直接返回成功（秒传分片）
    return {
      uploadedChunks: [],
      fileHash: "",
    };
  } else {
    // 文件不存在，需要创建任务并上传
    await createUploadTask({
      fileHash: uploadFile.chunkManager?.fileHash,
      fileName: uploadFile.fileName,
      totalChunks: uploadFile.chunkManager?.totalChunks!,
      fileSize: uploadFile.File.size,
    });
    return {
      uploadedChunks: [],
      fileHash: "",
    };
  }
};
const test2 = FileUD.createUploader("test2", {
  action: "/upload",
  file: "file",
});

const files = ref<UploadFile[]>([]);
Uploader.onError = (err) => {
  console.log("🚀 ~ err:1", err);
};
test1.on("files-complete", (fileList) => {
  uploadMonitor.printReport();
});
test1.onSuccess = (res) => {
  console.log(res);
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
const submit = async () => {
  try {
    await test1.submit();
    console.log("提交完成");
    getFileList({
      page: 1,
      pageSize: 10,
    }).then((res) => {
      console.log("🚀 ~ submit ~ res:", res);
    });
  } catch (error) {
    console.error("🚀 ~ submit ~ error:", error);
  }
};
window.test1 = test1;
window.test2 = test2;
window.FileUD = FileUD;
</script>

<template>
  <div>
    <!-- <button @click="submit()">提交</button> -->
    <button @click="test1.clearFiles()">清除文件列表</button>
    <button @click="handlerChunk">
      {{ isChunk ? "普通上传" : "大文件上传" }}
    </button>
    <button @click="test1.pauseAll()">全部暂停</button>
    <button @click="test1.resumeAll()">全部继续</button>
    <button @click="test1.cancelAll()">全部取消</button>
    <button @click="test1.retryAll()">全部重试</button>
    总的大小:{{ test1.totalBytes }} 总进度:{{ test1.totalPercent }} 总速度:{{
      test1.uploadSpeed?.averageSpeedFormatted
    }}

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
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
