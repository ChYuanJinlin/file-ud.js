import { AxiosProgressEvent } from "axios";
import { ChunkOptions } from "../types";
import UploadFile from "./UploadFile";
import { calculateFileMD5, formatSpeed, sleep } from "../utils";
import {
  saveUploadTask,
  updateChunkStatus,
  getUploadTask,
  deleteUploadTask,
  getCachedHash,
  saveFileHash,
} from "../utils/uploadDB";

export default class ChunkManager {
  chunkSize: number = 0;
  maxConcurrent: number = 5;
  public uploadedChunkIndex: number = 0;
  retries: number = 0;
  retryDelay: number = 1000; // 重试延迟，默认1秒
  timeout: number = 30000; // 超时时间，默认30秒
  enableResume: boolean = false; // 是否启用断点续传
  chunk: Blob | null = null; // 当前分片数据
  public totalChunks: number = 0;
  public uploadedChunks: boolean[] = [];
  public uploadEndTime = 0;
  public completedChunks = 0;
  public totalUploadTime = 0;
  public uploadStartTime = performance.now();
  uploadErrorFileCallBack: (() => void)[] = [];
  public uploadStatsInfos: {
    totalTime: number;
    fileSize: number;
    completedChunks: number | undefined;
    averageSpeed: number;
  } = {
    totalTime: 0,
    fileSize: 0,
    completedChunks: undefined,
    averageSpeed: 0,
  };
  uploadFile: UploadFile;
  totalUploadedSize: number = 0;
  config: ChunkOptions; // 保存配置

  // 新增属性
  public fileHash: string = ""; // 文件MD5哈希
  public uploadId: string = ""; // 服务端返回的上传ID
  private failedChunks: number[] = []; // 失败的分片索引
  private retryCountMap: Map<number, number> = new Map(); // 每个分片的重试次数
  // 暂停/恢复控制
  private isPaused: boolean = false; // 是否处于暂停状态
  private pauseResolve?: () => void; // 暂停时的 Promise resolve
  private activeUploads: Set<Promise<void>> = new Set(); // 当前活跃的上传任务

  // 网速计算所需的内部状态
  private lastUpdateTime: number = 0;
  private lastUploadedBytes: number = 0;

  constructor(ChunkOptions: ChunkOptions, file: UploadFile) {
    this.config = ChunkOptions; // 保存配置
    this.chunkSize = ChunkOptions.chunkSize || 1024 * 1024 * 5; // 默认5MB
    this.maxConcurrent = ChunkOptions.maxConcurrent || 5; // 默认同时上传5个分片
    this.retries = ChunkOptions.retries || 3; // 默认重试3次
    this.retryDelay = ChunkOptions.retryDelay || 1000; // 默认重试延迟1秒
    this.timeout = ChunkOptions.timeout || 30000; // 默认超时30秒
    this.enableResume = ChunkOptions.enableResume || false; // 默认不启用断点续传
    this.totalChunks = Math.ceil(file.File.size / this.chunkSize);
    this.uploadFile = file;
    this.uploadedChunks = Array(this.totalChunks).fill(false);

    // 如果提供了自定义uploadId，使用它
    if (ChunkOptions.uploadId) {
      this.uploadId = ChunkOptions.uploadId;
    }
  }

  /**
   * 计算文件MD5哈希值
   * 优化: 使用与分片上传相同的 chunkSize,减少重复I/O
   */
  private async computeFileHash(): Promise<string> {
    if (!this.fileHash) {
      try {
        const up = this.uploadFile.__uploader__;

        console.log(
          `开始计算文件MD5 (分片大小: ${this.chunkSize / 1024 / 1024}MB)...`,
        );

        // 获取插件上下文
        const context = (this.uploadFile as any).__pluginContext || {
          uploader: up,
          file: this.uploadFile,
          shared: up["pluginSharedData"],
          config: up.config,
        };
        this.uploadFile.proxy.hashLoading = true;
        // 调用工具函数计算 MD5，并传入进度回调
        this.fileHash = await calculateFileMD5(
          this.uploadFile.File,
          async (percent: number) => {
            // 更新 context 状态为 hashing
            context.status = "hashing";
            this.uploadFile.proxy.status = "hashing";
            context.message = `正在计算文件指纹: ${percent}%`;

            // 通过 runHook 调用插件的 onProgress 钩子
            await up["runHook"](
              "onProgress",
              percent,
              this.uploadFile,
              context,
            );

            this.uploadFile.proxy.hashPercent = percent;

            console.log(`MD5 计算进度: ${percent}%`);
          },
        );

        console.log(`文件MD5计算完成: ${this.fileHash}`);
      } catch (error) {
        console.error("计算文件MD5失败:", error);
        // 如果计算失败，使用时间戳作为备用标识
        this.fileHash = `fallback_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      } finally {
        this.uploadFile.proxy.hashLoading = false;
      }
    }
    return this.fileHash;
  }

  private async getFileHash(file: File): Promise<string> {
    // 1. 生成快速指纹
    const quickFingerprint = `${file.name}_${file.lastModified}_${file.size}`;

    // 2. 从 IndexedDB 中查找缓存
    const cached = await getCachedHash(quickFingerprint);
    if (cached) {
      console.log("命中 Hash 缓存，直接使用");
      this.uploadFile.hashPercent = 100;
      return cached;
    }

    // 3. 未命中，实际计算 Hash
    console.log("未命中缓存，开始计算 Hash...");
    const hash = await this.computeFileHash(); // 计算文件哈希

    // 4. 存入缓存
    await saveFileHash(file, hash);
    return hash;
  }
  /**
   * 初始化上传（获取uploadId或检查已上传分片）
   */
  private async initUpload(): Promise<void> {
    const up = this.uploadFile.__uploader__;

    this.fileHash = await this.getFileHash(this.uploadFile.File);

    // 如果启用了断点续传，尝试从 IndexedDB 恢复进度
    if (this.enableResume) {
      const savedProgress = await this.loadProgress();
      if (savedProgress && savedProgress.uploadedChunks) {
        // 从保存的进度中恢复
        this.uploadId = this.fileHash; // 使用 fileHash 作为任务ID
        // 恢复 uploadedChunks 状态
        savedProgress.uploadedChunks.forEach((index: number) => {
          if (index >= 0 && index < this.totalChunks) {
            this.uploadedChunks[index] = true;
            this.completedChunks++;
          }
        });
        console.log(
          `恢复上传进度: 已完成 ${this.completedChunks}/${this.totalChunks} 个分片`,
        );
        return;
      }
    }

    // 调用用户提供的初始化回调
    const onInit = up.onInitCallback;
    if (onInit) {
      try {
        console.log("调用用户自定义的初始化回调...");
        const result = await onInit(
          this.uploadFile,
          this.totalChunks,
          this.fileHash,
        );

        this.uploadId = result.uploadId;

        // 如果返回了已上传的分片列表，更新状态
        if (result.uploadedChunks && Array.isArray(result.uploadedChunks)) {
          result.uploadedChunks.forEach((index: number) => {
            if (index >= 0 && index < this.totalChunks) {
              this.uploadedChunks[index] = true;
              this.completedChunks++;
            }
          });
          console.log(`服务器已有 ${this.completedChunks} 个分片`);
        }

        console.log(`上传初始化成功, uploadId: ${this.uploadId}`);
      } catch (error) {
        console.error("初始化回调执行失败:", error);
        throw new Error(
          `分片上传初始化失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      // 如果没有提供onInit回调，生成本地uploadId
      console.warn("未提供 onInit 回调，使用本地生成的 uploadId");
      this.uploadId = this.generateUploadId();
    }
  }

  /**
   * 生成唯一的uploadId
   */
  private generateUploadId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * 上传单个分片（带超时和重试）
   */
  private async uploadChunkWithRetry(chunkIndex: number): Promise<void> {
    const maxRetries = this.retries;
    let retryCount = this.retryCountMap.get(chunkIndex) || 0;

    while (retryCount <= maxRetries) {
      try {
        // 注意：真正的超时控制需要在 UploadFile.upload 中支持 signal 参数
        // 当前实现通过 Promise.race 模拟超时
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(`分片 ${chunkIndex} 上传超时 (${this.timeout}ms)`),
            );
          }, this.timeout);
        });

        // 使用 Promise.race 实现超时控制
        await Promise.race([this.uploadChunk(chunkIndex), timeoutPromise]);

        // 上传成功，重置重试计数
        this.retryCountMap.set(chunkIndex, 0);
        return;
      } catch (error: any) {
        retryCount++;
        this.retryCountMap.set(chunkIndex, retryCount);

        if (retryCount > maxRetries) {
          console.error(
            `分片 ${chunkIndex} 上传失败，已达到最大重试次数 (${maxRetries})`,
          );
          this.failedChunks.push(chunkIndex);
          throw error;
        }

        // 指数退避策略：delay = baseDelay * 2^(retryCount-1)
        const delay = this.retryDelay * Math.pow(2, retryCount - 1);
        console.log(
          `分片 ${chunkIndex} 上传失败，${delay}ms 后第 ${retryCount}/${maxRetries} 次重试...`,
        );
        await sleep(delay);
      }
    }
  }

  /**
   * 上传单个分片
   */
  private async uploadChunk(chunkIndex: number): Promise<void> {
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.uploadFile.File.size);
    const chunk = this.uploadFile.File.slice(start, end);
    this.chunk = chunk; // 暂存当前分片，供外部访问
    const chunkSizeValue = chunk.size;
    console.log(`开始上传分片 ${chunkIndex + 1}/${this.totalChunks}`, {
      chunkIndex,
      chunkSize: chunk.size,
      start,
      end,
      uploadId: this.uploadId,
    });
    this.uploadFile.formData = new FormData();
    this.uploadFile.setFile(chunk);
    try {
      await this.uploadFile.upload((res) => {
        // 完成的分片
        this.completedChunks++;
        this.totalUploadedSize += chunkSizeValue;
        this.uploadedChunks[chunkIndex] = true;
        console.log(`分片 ${chunkIndex + 1}/${this.totalChunks} 上传成功`);

        // 从失败列表中移除
        const failIndex = this.failedChunks.indexOf(chunkIndex);
        if (failIndex > -1) {
          this.failedChunks.splice(failIndex, 1);
        }

        // 如果启用了断点续传，更新单个分片状态（更高效）
        if (this.enableResume) {
          updateChunkStatus(this.fileHash, chunkIndex, true).catch((error) => {
            console.warn("更新分片状态失败:", error);
          });
        }
      });
    } catch (error) {
      console.error(
        `分片文件${this.uploadFile.File.name}上传失败,当前分片下标${chunkIndex}`,
      );
      this.uploadedChunks[chunkIndex] = false;
      return Promise.reject(error);
    }
  }

  /**
   * 合并所有分片
   */
  private async mergeChunks(): Promise<any> {
    const up = this.uploadFile.__uploader__;

    console.log(`开始合并分片, uploadId: ${this.uploadId}`);

    try {
      // 调用用户提供的合并回调
      const onMerge = up.onMergeCallback;
      if (onMerge) {
        const response = await onMerge(
          this.uploadFile,
          this.uploadId,
          this.fileHash,
          this.totalChunks,
        );

        console.log("分片合并成功", response);

        // 清除保存的进度
        if (this.enableResume) {
          await this.clearProgress();
        }

        return response;
      } else {
        // 如果没有提供onMerge回调，直接认为成功
        console.warn("未提供 onMerge 回调，跳过合并步骤");

        // 清除保存的进度
        if (this.enableResume) {
          await this.clearProgress();
        }

        return undefined;
      }
    } catch (error) {
      console.error("分片合并失败:", error);
      throw error;
    }
  }

  /**
   * 检查统计信息并触发合并
   */
  private async checkStatistics() {
    // 计算总耗时
    this.uploadEndTime = performance.now();
    this.totalUploadTime = this.uploadEndTime - this.uploadStartTime;

    // 检查结果
    const allSuccess = this.uploadedChunks.every((uploaded) => uploaded);

    if (allSuccess) {
      // 所有分片上传成功，调用合并接口
      try {
        const mergeResult = await this.mergeChunks();
        this.uploadFile.onScuccess(mergeResult);
      } catch (error) {
        this.uploadFile.onError(error);
        return;
      }

      // 添加上传统计信息
      this.uploadStatsInfos = {
        totalTime: this.totalUploadTime,
        fileSize: this.uploadFile.File.size,
        completedChunks: this.completedChunks,
        averageSpeed:
          this.uploadFile.File.size / (this.totalUploadTime / 1000) / 1024, // KB/s
      };

      const timeText = `总耗时: ${(this.totalUploadTime / 1000).toFixed(
        2,
      )}秒, 平均速度: ${this.uploadStatsInfos.averageSpeed.toFixed(2)} KB/s`;

      console.log(`🎉 上传完成! ${timeText}`);
      console.log("上传统计:", this.uploadStatsInfos);

      console.log(`上传文件 ${this.uploadFile.File.name} 完成 ${timeText}`);
    } else {
      // 有分片失败，尝试重试
      if (this.failedChunks.length > 0) {
        console.log(`发现 ${this.failedChunks.length} 个失败分片，尝试重试...`);
        await this.retryFailedChunks();
      } else {
        this.uploadFile.onError(new Error("部分分片上传失败"));
      }
    }
  }

  /**
   * 重试失败的分片
   */
  public async retryFailedChunks(): Promise<void> {
    const failedChunksCopy = [...this.failedChunks];
    this.failedChunks = [];

    for (const chunkIndex of failedChunksCopy) {
      try {
        await this.uploadChunkWithRetry(chunkIndex);
      } catch (error) {
        console.error(`重试分片 ${chunkIndex} 仍然失败`);
        this.failedChunks.push(chunkIndex);
      }
    }

    // 如果还有失败的，再次检查
    if (this.failedChunks.length > 0) {
      console.error(`仍有 ${this.failedChunks.length} 个分片上传失败`);
      this.uploadFile.onError(
        new Error(`${this.failedChunks.length} 个分片上传失败`),
      );
    }
  }

  /**
   * 保存上传进度到 IndexedDB
   */
  private async saveProgress(): Promise<void> {
    if (!this.enableResume) return;

    try {
      // 构建分片状态数组
      const chunks = this.uploadedChunks.map((uploaded, index) => ({
        index,
        uploaded,
      }));

      // 使用 IndexedDB 保存任务
      await saveUploadTask({
        id: this.fileHash,
        filename: this.uploadFile.fileName,
        size: this.uploadFile.File.size,
        chunkSize: this.chunkSize,
        totalChunks: this.totalChunks,
        chunks,
        createdAt: Date.now(), // 首次创建时设置
      });
    } catch (error) {
      console.warn("保存上传进度失败:", error);
    }
  }

  /**
   * 从 IndexedDB 加载上传进度
   */
  private async loadProgress(): Promise<any> {
    if (!this.enableResume) return null;

    try {
      const task = await getUploadTask(this.fileHash);

      if (task) {
        // 检查是否是同一个文件（通过哈希和大小）
        if (
          task.id === this.fileHash &&
          task.size === this.uploadFile.File.size
        ) {
          // 转换数据格式以兼容原有逻辑
          return {
            uploadId: task.id,
            uploadedChunks: task.chunks
              .filter(
                (chunk: { index: number; uploaded: boolean }) => chunk.uploaded,
              )
              .map(
                (chunk: { index: number; uploaded: boolean }) => chunk.index,
              ),
            completedChunks: task.chunks.filter(
              (chunk: { index: number; uploaded: boolean }) => chunk.uploaded,
            ).length,
          };
        }
      }
    } catch (error) {
      console.warn("加载上传进度失败:", error);
    }
    return null;
  }

  /**
   * 清除保存的上传进度
   */
  private async clearProgress(): Promise<void> {
    if (!this.enableResume) return;

    try {
      await deleteUploadTask(this.fileHash);
      console.log("已清除上传进度缓存");
    } catch (error) {
      console.warn("清除上传进度失败:", error);
    }
  }

  /**
   * 取消上传
   */
  public cancelUpload(): void {
    console.log("上传已取消");
  }

  /**
   * 暂停上传
   *
   * 暂停所有正在进行的分片上传,但保持当前进度。
   * 对于普通上传,会中止 XHR 请求。
   * 对于分片上传,会等待当前活跃的分片完成后暂停新分片的启动。
   *
   * @example
   * ```typescript
   * file.pause();
   * console.log(file.status); // "paused"
   * ```
   */
  public pause(): void {
    if (this.isPaused) {
      console.warn("上传已处于暂停状态");
      return;
    }

    this.isPaused = true;
    this.uploadFile.proxy.status = "paused";

    console.log(`⏸️ 上传已暂停 (${this.uploadFile.fileName})`);

    // 如果是普通上传(没有 ChunkManager),直接 abort
    if (
      !this.uploadFile.chunkManager ||
      this.uploadFile.chunkManager === this
    ) {
      // 检查是否是普通上传(通过检查是否有 chunkIndex 参数)
      const isChunkedUpload = this.uploadId !== "";

      if (!isChunkedUpload && this.uploadFile.abort) {
        this.uploadFile.abort();
        console.log("普通上传已中止");
      }
    }
  }

  /**
   * 恢复上传
   *
   * 从暂停的位置继续上传。
   * 对于分片上传,会继续上传未完成的分片。
   * 对于普通上传,需要重新开始(因为 XHR 无法恢复)。
   *
   * @example
   * ```typescript
   * file.resume();
   * console.log(file.status); // "uploading"
   * ```
   */
  public async resume(): Promise<void> {
    if (!this.isPaused) {
      console.warn("上传未处于暂停状态");
      return;
    }

    this.isPaused = false;
    this.uploadFile.proxy.status = "uploading";

    console.log(`▶️ 上传已恢复 (${this.uploadFile.fileName})`);

    // 如果是分片上传,继续上传剩余分片
    if (this.uploadId) {
      // 检查是否还有未完成的分片
      const hasUnfinishedChunks = this.uploadedChunks.some(
        (uploaded) => !uploaded,
      );

      if (hasUnfinishedChunks) {
        console.log("继续上传剩余分片...");
        await this.startUpload();
      } else {
        console.log("所有分片已完成,执行合并...");
        await this.mergeChunks();
      }
    } else {
      // 普通上传无法恢复,需要重新开始
      console.warn("普通上传无法恢复,将重新开始上传");
      this.uploadFile.rest();
    }
  }

  /**
   * 检查是否处于暂停状态
   * @returns 是否暂停
   */
  public getPaused(): boolean {
    return this.isPaused;
  }

  /**
   * 等待直到不再暂停(用于异步流程中的暂停检查)
   * @returns Promise,当恢复时 resolve
   */
  private async waitForResume(): Promise<void> {
    if (!this.isPaused) {
      return;
    }

    return new Promise((resolve) => {
      this.pauseResolve = resolve;
    });
  }

  public updateProgress(
    progressEvent: ProgressEvent | AxiosProgressEvent,
  ): number {
    const completedSize = this.completedChunks * this.chunkSize; // 已完成分片的总大小
    const currentChunkProgress = progressEvent.loaded; // 当前分片已上传大小
    const totalUploaded = completedSize + currentChunkProgress;

    // 计算并更新全局上传速率
    this.calculateAndUpdateSpeed(totalUploaded);

    return Math.round((totalUploaded * 100) / this.uploadFile.File.size);
  }

  /**
   * 计算并更新全局上传速率
   * @param currentUploadedBytes 当前已上传字节数
   */
  private calculateAndUpdateSpeed(currentUploadedBytes: number): void {
    const now = performance.now();

    // 首次调用，初始化基准值
    if (this.lastUpdateTime === 0) {
      this.lastUpdateTime = now;
      this.lastUploadedBytes = currentUploadedBytes;
      return;
    }

    // 计算时间差（秒）
    const timeDiff = (now - this.lastUpdateTime) / 1000;

    // 避免除以零或时间间隔过短(防抖)
    if (timeDiff < 0.1) {
      return;
    }

    // 计算字节差
    const bytesDiff = currentUploadedBytes - this.lastUploadedBytes;

    // 计算瞬时速度 (bytes/s)
    const currentSpeed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

    // 计算平均速度：总上传字节数 / 总耗时
    const totalTime = (now - this.uploadStartTime) / 1000;
    const averageSpeed = totalTime > 0 ? currentUploadedBytes / totalTime : 0;

    // 更新全局静态属性
    this.uploadFile.__uploader__.uploadSpeed = {
      currentSpeed,
      averageSpeed,
      currentSpeedFormatted: formatSpeed(currentSpeed),
      averageSpeedFormatted: formatSpeed(averageSpeed),
    };

    // 更新基准值
    this.lastUpdateTime = now;
    this.lastUploadedBytes = currentUploadedBytes;
  }

  public async startUpload() {
    console.log(`开始上传，最大并发数: ${this.maxConcurrent}`);

    // 第一步：初始化上传（获取uploadId、检查已上传分片）
    await this.initUpload();

    // 如果所有分片都已上传，直接合并
    if (this.completedChunks === this.totalChunks) {
      console.log("所有分片已上传，直接合并");
      await this.mergeChunks();
      return;
    }

    try {
      // 使用信号量控制并发
      await this.uploadWithConcurrency();

      // 检查是否有失败的分片
      // if (this.failedChunks.length > 0) {
      //   console.log(`发现 ${this.failedChunks.length} 个失败分片，尝试重试...`);
      //   await this.retryFailedChunks();
      // }
      this.checkStatistics();
    } catch (error) {
      // 错误时也记录耗时
      this.uploadEndTime = performance.now();
      this.totalUploadTime = this.uploadEndTime - this.uploadStartTime;
      console.error(
        `上传过程发生错误，总耗时: ${(this.totalUploadTime / 1000).toFixed(
          2,
        )}秒`,
        error,
      );
      this.uploadFile.onError(error);
      return;
    }
  }

  /**
   * 使用信号量控制并发上传
   */
  private async uploadWithConcurrency(): Promise<void> {
    console.log(`开始上传，最大并发数: ${this.maxConcurrent}`);
    const uploadPromises: Promise<void>[] = [];
    const chunkStartTimes: number[] = []; // 记录每个分片开始时间
    const chunkDurations: number[] = []; // 记录每个分片耗时

    for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
      this.uploadedChunkIndex = chunkIndex + 1;

      // 记录分片开始时间
      chunkStartTimes[chunkIndex] = performance.now();

      const promise = this.uploadChunk(chunkIndex).then(() => {
        // 记录分片耗时
        chunkDurations[chunkIndex] =
          performance.now() - chunkStartTimes[chunkIndex];

        console.log(
          `分片 ${chunkIndex} 耗时: ${chunkDurations[chunkIndex].toFixed(2)}ms`,
        );
      });

      uploadPromises.push(promise);

      // 并发控制：当达到最大并发数时，等待其中一个完成
      if (uploadPromises.length >= this.maxConcurrent) {
        console.log(`达到并发限制 ${this.maxConcurrent}，等待任务完成...`);

        await Promise.race(uploadPromises);
      }
    }
    console.log("所有分片已启动，等待最终完成...");
    await Promise.allSettled(uploadPromises);

    // 统计信息
    const completedDurations = chunkDurations.filter(
      (duration) => duration > 0,
    );
    if (completedDurations.length > 0) {
      const avgChunkTime =
        completedDurations.reduce((a, b) => a + b, 0) /
        completedDurations.length;
      const maxChunkTime = Math.max(...completedDurations);
      const minChunkTime = Math.min(...completedDurations);
      console.log(
        `平均分片耗时 ${avgChunkTime.toFixed(
          2,
        )}ms, 最慢分片 ${maxChunkTime.toFixed(
          2,
        )}ms, 最快分片 ${minChunkTime.toFixed(2)}ms`,
      );
    }
  }
}
