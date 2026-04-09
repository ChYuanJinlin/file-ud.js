<script setup lang="ts">
import { FileUD } from "@file-ud.js/core";
import { uploadFile, upload, getFileList } from "./api";
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
const test1 = FileUD.createUploader("test1", {
  action: "/api/upload-chunk",
  file: "file",
  logConfig: {
    enabled: true,
    level: 2, // WARN
    showTimestamp: true,
    enableColors: false, // 生产环境禁用颜色
  },
  // file(obj, formData) {
  //   formData.append("file", obj.chunkManager?.chunk!);
  //   formData.append("fileName", obj.File.name);
  //   formData.append("chunkIndex", obj.chunkManager?.uploadedChunkIndex.toString()!);
  //   formData.append("totalChunks", obj.chunkManager?.totalChunks.toString()!);
  //   formData.append("uploadId", obj.chunkManager?.uploadId!);

  // },
  multiple: true,
  chunkOptions: isChunk.value ? {} : null,
});

const test2 = FileUD.createUploader("test2", {
  action: "/upload",
  file: "file",
});

const files = ref<IFile[]>([]);
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
    <button @click="submit()">提交</button>
    <button @click="test1.clearFiles()">清除文件列表</button>
    <button @click="handlerChunk">
      {{ isChunk ? "普通上传" : "大文件上传" }}
    </button>
    <button @click="test1.clearFiles()">全部暂停</button>
    <button @click="test1.clearFiles()">全部继续</button>
    <button @click="test1.clearFiles()">全部取消</button>
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
      <button @click="test1.clearFiles()">重新上传</button>
      <button @click="test1.clearFiles()">暂停</button>
      <button @click="test1.clearFiles()">继续</button>
      <button @click="test1.clearFiles()">取消</button>
      <button @click="test1.clearFiles()">删除</button>
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
