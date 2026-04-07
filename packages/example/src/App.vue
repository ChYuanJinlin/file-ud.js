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

const test1 = FileUD.createUploader("test1", {
  action: "upload",
  file: "file",
  multiple: true,
});

const test2 = FileUD.createUploader("test2", {
  action: "/upload",
  file: "file",
});

const files = ref<IFile[]>([]);
Uploader.onError = (err) => {
  console.log("🚀 ~ err:1", err);
};
test1.onSuccess = (res) => {
  console.log(res);
};
test1.onUpdate = (fileList) => {
  files.value = fileList;
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
    总的大小:{{ test1.totalBytes }} 总进度:{{ test1.totalPercent }} 总速度:{{ test1.uploadSpeed?.averageSpeedFormatted }}
    <div v-for="item in files" :key="item.fileId">
      进度{{ item.percent }} 状态{{ item.status }} 文件名{{ item.fileName }}

      <img
        style="width: 200px; height: 200px"
        :src="item.url"
        alt=""
        srcset=""
      />
      <video width="500" height="500" :src="item.url" controls></video>
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
