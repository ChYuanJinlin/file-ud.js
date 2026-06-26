import { AxiosProgressEvent } from "axios";
import { ChunkOptions, onInitChunkCallback } from "../types";
import UploadFile from "./UploadFile";
import PQueue from "p-queue";
import {
  calculateFileMD5,
  formatSpeed,
  formatFileSize,
  logger,
  computeTransferTime,
} from "../utils";
import { getCachedHash, saveFileHash } from "../utils/transferDB";
import ChunkManager from "../chunkManager";

export default class UploadChunkManager extends ChunkManager {
  uploadFile: UploadFile;

  uploadErrorFileCallBack: (() => void)[] = [];
  /**
   * 初始化上传任务
   */
  constructor(ChunkOptions: ChunkOptions, file: UploadFile) {
    super(ChunkOptions, file);

    this.uploadFile = file;

    logger.debug("uploadChunkManager", "创建新的 uploadChunkManager 实例", {
      fileId: file.fileId,
      fileName: file.fileName,
      totalChunks: this.totalChunks,
      completedChunks: this.completedChunks,
    });
  }

  // ==================== 抽象方法实现（适配 ChunkManager 基类） ====================

  protected getTag(): string {
    return "uploadChunkManager";
  }

  protected async computeFileIdentifier(): Promise<string> {
    return this.getFileHash(this.uploadFile.File);
  }

  protected async doInit(): Promise<any> {
    return this.initUpload();
  }

  protected async doChunkTransfer(
    chunkIndex: number,
    signal?: AbortSignal,
  ): Promise<{ data: any; chunkSize: number }> {
    await this.uploadChunk(chunkIndex, signal);
    const file = this.uploadFile.File;
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, file.size) - 1;
    return { data: this.response, chunkSize: end - start + 1 };
  }

  protected async doMergeChunks(): Promise<any> {
    return this.mergeChunks();
  }

  /**
   * 计算文件MD5哈希值
   * 优化: 使用与分片上传相同的 chunkSize,减少重复I/O
   */
  private async computeFileHash(): Promise<string> {
    if (!this.fileHash) {
      // ✅ 创建 AbortController，用于在文件被删除时中断 MD5 计算
      const hashAbortController = new AbortController();

      // ✅ 将 controller 保存到实例中，以便 cancelUpload 可以调用 abort()
      (this as any).__hashAbortController__ = hashAbortController;

      try {
        const up = this.uploadFile.up;

        // 获取插件上下文
        const context = (this.uploadFile as any).__pluginContext || {
          transfer: up,
          file: this.uploadFile,
          shared: up["pluginSharedData"],
          config: up.config,
        };
        this.uploadFile.proxy.hashLoading = true;

        // 调用工具函数计算 MD5，并传入进度回调和中断信号
        this.fileHash = await calculateFileMD5(
          this.uploadFile.File,
          async (percent: number) => {
            // ✅ 关键检查：如果文件已被取消，立即中止计算
            if (this.isCancelled) {
              hashAbortController.abort();
              throw new Error("文件已取消，停止计算指纹");
            }

            // 更新 context 状态为 hashing
            context.status = "hashing";
            this.uploadFile.proxy.status = "hashing";
            context.message = `正在计算文件指纹: ${percent}%`;
            logger.debug(
              "uploadChunkManager",
              `computeFileHash 被调用: ${context.message}`,
            );
            // 通过 runHook 调用插件的 onProgress 钩子
            await up["runHook"](
              "onProgress",
              percent,
              this.uploadFile,
              context,
            );

            this.uploadFile.proxy.hashPercent = percent;
          },
          hashAbortController.signal, // ✅ 传递中断信号
        );
      } catch (error) {
        // ✅ 如果是取消导致的错误，不记录为错误日志，直接重新抛出
        if (error instanceof Error && error.message.includes("取消")) {
          logger.info("uploadChunkManager", "MD5 计算已取消", {
            fileId: this.uploadFile.fileId,
            fileName: this.uploadFile.fileName,
          });
          throw error; // ✅ 重新抛出，让上层知道被取消了
        }

        logger.error(
          "uploadChunkManager",
          "计算文件哈希失败，使用备用标识",
          error,
        );
        // 如果计算失败，使用时间戳作为备用标识
        this.fileHash = `fallback_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2)}`;
      } finally {
        this.uploadFile.proxy.hashLoading = false;
        // ✅ 清理 AbortController
        delete (this as any).__hashAbortController__;
      }
    }
    return this.fileHash;
  }

  private async getFileHash(file: File): Promise<string> {
    // 1. 生成快速指纹
    const quickFingerprint = `${file.name}_${file.lastModified}_${file.size}`;

    // 添加调试日志：记录每次调用 getFileHash 的文件名
    logger.debug("uploadChunkManager", `getFileHash 被调用: ${file.name}`, {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      fingerprint: quickFingerprint,
      fileId: this.uploadFile.fileId,
    });

    // 2. 从 IndexedDB 中查找缓存
    const cached = await getCachedHash(quickFingerprint);
    if (cached) {
      logger.info("uploadChunkManager", `Hash 缓存命中:: ${file.name}`, {
        fileName: file.name,
        fileId: this.uploadFile.fileId,
      });
      this.uploadFile.hashPercent = 100;
      return cached;
    }

    // 3. 未命中，实际计算 Hash
    logger.info(
      "uploadChunkManager",
      `Hash 缓存未命中，开始计算: ${file.name}`,
    );
    const hash = await this.computeFileHash(); // 计算文件哈希

    // 4. 存入缓存
    await saveFileHash(file, hash);

    // ✅ 5. 如果启用了文件缓存，将 File 对象保存到 IndexedDB
    const up = this.uploadFile.up;
    if (up.config?.chunkOptions?.enableFileCache) {
      try {
        const { saveFileToCache } = await import("../utils/fileCache");
        await saveFileToCache(hash, file);
        logger.debug(
          "uploadChunkManager",
          `✅ 文件已缓存到 IndexedDB: ${file.name}`,
          { fileHash: hash, fileSize: file.size },
        );
      } catch (error) {
        logger.warn(
          "uploadChunkManager",
          `⚠️ 文件缓存失败（不影响上传）: ${file.name}`,
          error,
        );
      }
    }

    return hash;
  }
  /**
   * 初始化上传
   */
  private async initUpload(): Promise<
    ReturnType<onInitChunkCallback<any>> | undefined
  > {
    const up = this.uploadFile.transfer;
    this.fileHash = await this.getFileHash(this.uploadFile.File);
    // 添加文件级别的开始上传日志（用于监控模块）
    logger.info(
      "uploadChunkManager",
      `开始上传文件: ${this.uploadFile.fileName}`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        fileSize: this.uploadFile.File.size,
        totalChunks: this.totalChunks,
        chunkSize: this.chunkSize,
      },
    );

    // 秒传检查：如果配置了 onInitChunkCallback，优先调用服务端接口检查文件是否存在
    if (up.onInitChunkCallback) {
      try {
        logger.debug(
          "uploadChunkManager",
          "调用 onInitChunk 回调检查秒传/断点续传",
          {
            fileId: this.uploadFile.fileId,
            fileName: this.uploadFile.fileName,
            fileHash: this.fileHash,
          },
        );

        const initResult = await up.onInitChunkCallback(
          this.uploadFile,
          this.totalChunks,
          this.fileHash,
        );

        if (initResult?.fileHash) {
          logger.info("uploadChunkManager", "初始化成功", {
            fileHash: this.fileHash,
            fileId: this.uploadFile.fileId,
          });

          // ✅ 检查是否为真正的秒传（后端明确标记）
          if (initResult.isInstantUpload === true) {
            logger.info("uploadChunkManager", "⚡ 检测到秒传标记，文件已存在", {
              fileHash: this.fileHash,
              fileName: this.uploadFile.fileName,
              shouldRemove: initResult.shouldRemove,
            });

            // 标记为真正的秒传
            this.isInstantTransfer = true;
            this.completedChunks = this.totalChunks;
            this.totalChunkSize = this.uploadFile.File.size;
            this.countedChunks = new Set(
              Array.from({ length: this.totalChunks }, (_, i) => i),
            );
            this.chunks = new Array(this.totalChunks).fill(true);
            this.uploadFile.proxy.percent = 100;
            this.uploadFile.proxy.status = "success";

            // 秒传文件设置速度（瞬时完成，无实际传输耗时）
            this.uploadFile.proxy.speed = {
              currentSpeed: 0,
              averageSpeed: 0,
              currentSpeedFormatted: "0 B/s",
              averageSpeedFormatted: "0 B/s",
              estimatedTimeRemaining: 0,
              estimatedTimeFormatted: "秒传完成",
            };

            // ✅ 关键修复：更新全局统计信息（总进度、总大小）
            const up = this.uploadFile.transfer;
            up.updateGlobalStats();

            // 更新上传速度
            up.triggerUpdate();

            // ✅ 如果需要移除文件，则从文件列表中移除
            if (initResult.shouldRemove === true) {
              logger.info("uploadChunkManager", "🗑️ 秒传成功，自动移除文件", {
                fileName: this.uploadFile.fileName,
              });

              // 触发秒传成功事件
              up.emit("instant-upload", {
                file: this.uploadFile.proxy,
                reason: "文件已存在，自动移除",
              });

              // 移除文件（调用 UploadFile 实例的 remove 方法）
              this.uploadFile.remove();
            }

            return Promise.resolve(initResult);
          }

          // 秒传判断：如果服务端返回的已上传分片数量等于总分片数，说明文件已存在
          if (
            initResult.chunks &&
            Array.isArray(initResult.chunks) &&
            (initResult.chunks?.length === this.totalChunks ||
              initResult.chunks === undefined ||
              initResult.chunks === null)
          ) {
            logger.info(
              "uploadChunkManager",
              "✅ 秒传成功！文件已存在于服务端",
              {
                fileHash: this.fileHash,
                fileName: this.uploadFile.fileName,
                uploadedChunksCount: initResult.chunks?.length,
                totalChunks: this.totalChunks,
                shouldRemove: initResult.shouldRemove,
              },
            );

            this.completedChunks = this.totalChunks;
            this.totalChunkSize = this.uploadFile.File.size;
            this.countedChunks = new Set(
              Array.from({ length: this.totalChunks }, (_, i) => i),
            ); // 标记所有分片为已累加
            this.chunks = new Array(this.totalChunks).fill(true);

            // 🔑 全部分片已上传但未合并，进度卡在 99%，留给 completeMerge() 设 100%
            this.uploadFile.proxy.percent = 99;

            // ✅ 关键修复：更新全局统计信息（总进度、总大小）
            const up = this.uploadFile.transfer;
            up.updateGlobalStats();

            // 更新上传速度
            up.triggerUpdate();

            // ✅ 如果需要移除文件，则从文件列表中移除
            if (initResult.shouldRemove === true) {
              logger.info("uploadChunkManager", "🗑️ 秒传成功，自动移除文件", {
                fileName: this.uploadFile.fileName,
              });

              // 触发秒传成功事件
              up.emit("instant-upload", {
                file: this.uploadFile.proxy,
                reason: "文件已存在，自动移除",
              });

              // 移除文件（调用 UploadFile 实例的 remove 方法）
              this.uploadFile.remove();
            }

            return Promise.resolve(initResult);
          }

          // 断点续传：如果服务端返回部分已上传分片
          if (
            initResult.chunks &&
            Array.isArray(initResult.chunks) &&
            initResult.chunks?.length > 0
          ) {
            logger.info("uploadChunkManager", "恢复已上传分片（断点续传）", {
              uploadedChunksCount: initResult.chunks.length,
              totalChunks: this.totalChunks,
              percent: Math.round(
                (initResult.chunks.length / this.totalChunks) * 100,
              ),
            });
            this.completedChunks = 0;
            initResult.chunks.forEach((index: number) => {
              if (index >= 0 && index < this.totalChunks) {
                this.chunks[index] = true;
                this.completedChunks++;
                this.countedChunks.add(index);
                this.totalChunkSize += this.chunkSize;
              }
            });

            // 更新文件进度
            this.updateProgress();

            // ✅ 关键修复：更新全局统计信息（总进度、总大小）
            const up = this.uploadFile.transfer;
            up.updateGlobalStats();
            up.triggerUpdate();

            return; // 已恢复进度，直接返回
          }
        }
      } catch (error) {
        logger.warn("uploadChunkManager", "初始化失败", error);
        this.uploadFile.proxy.status = "error";
        // 降级到本地 IndexedDB 存储
        return Promise.reject(error);
      }
    }
  }

  /**
   * 带重试机制的分片上传
   */
  private async uploadChunkWithRetry(chunkIndex: number): Promise<void> {
    const maxRetries = this.retries;
    let retryCount = this.retryCountMap.get(chunkIndex) || 0;

    // 提取公共的上传执行逻辑（避免重复代码）
    const executeUpload = async (): Promise<void> => {
      // 使用 AbortController 实现真正的超时控制
      const abortController = new AbortController();

      // ✅ 保存 AbortController 引用，以便取消时可以中止
      this.abortControllers.push(abortController);

      const timeoutId = this.timeout > 0
        ? setTimeout(() => {
            abortController.abort();
          }, this.timeout)
        : (null as any);

      try {
        // 传递 signal 给 UploadFile.upload，实现真正的超时取消
        await this.uploadChunk(chunkIndex, abortController.signal);

        // 上传成功，清除超时定时器
        if (timeoutId !== null) clearTimeout(timeoutId);

        // ✅ 从数组中移除已完成的 AbortController
        const index = this.abortControllers.indexOf(abortController);
        if (index > -1) {
          this.abortControllers.splice(index, 1);
        }
      } catch (error) {
        // 确保清除定时器
        if (timeoutId !== null) clearTimeout(timeoutId);

        // ✅ 从数组中移除已完成的 AbortController
        const index = this.abortControllers.indexOf(abortController);
        if (index > -1) {
          this.abortControllers.splice(index, 1);
        }

        // 添加详细的错误日志
        if (error instanceof Error && error.name === "AbortError") {
          logger.error(
            "uploadChunkManager",
            `分片 ${chunkIndex + 1} 被取消（可能是超时或手动取消）`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              timeout: this.timeout,
              error: error.message,
            },
          );
        }

        throw error;
      }
    };

    // 如果 retries 为 null，禁用自动重试，只尝试一次
    if (maxRetries === null) {
      try {
        await executeUpload();
        // 上传成功，重置重试计数
        this.retryCountMap.set(chunkIndex, 0);
        return;
      } catch (error: any) {
        // 自动重试被禁用，直接标记为失败
        this.failedChunks.push(chunkIndex);

        logger.error(
          "uploadChunkManager",
          `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${
            this.totalChunks
          } 上传失败（自动重试已禁用，请手动重试）`,
          {
            fileId: this.uploadFile.fileId,
            fileName: this.uploadFile.fileName,
            chunkIndex,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        this.setFileStatusToFail();
        throw error;
      }
    }

    // 正常重试逻辑
    while (retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          logger.warn(
            "uploadChunkManager",
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 第 ${retryCount} 次重试`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              retryCount,
            },
          );
        }

        await executeUpload();

        // 上传成功，重置重试计数
        this.retryCountMap.set(chunkIndex, 0);

        if (retryCount > 0) {
          logger.info(
            "uploadChunkManager",
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 重试成功（共重试 ${retryCount} 次）`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              retryCount,
            },
          );
        }

        return;
      } catch (error: any) {
        retryCount++;
        this.retryCountMap.set(chunkIndex, retryCount);

        if (retryCount > maxRetries) {
          this.failedChunks.push(chunkIndex);

          logger.error(
            "uploadChunkManager",
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 最终失败（已重试 ${maxRetries} 次）`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              retryCount: maxRetries,
              error: error instanceof Error ? error.message : String(error),
            },
          );

          return;
        }

        // 指数退避重试延迟
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
        logger.debug(
          "uploadChunkManager",
          `分片 ${chunkIndex} 将在 ${delay}ms 后重试`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 设置文件状态为失败（统一处理，避免重复代码）
   */
  protected setFileStatusToFail(): void {
    if (this.retries === null) {
      setTimeout(() => {
        this.uploadFile.proxy.status = "fail";
      }, 0);
    }
  }

  /**
   * 上传单个分片
   */
  private async uploadChunk(
    chunkIndex: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.uploadFile.File.size);
    const chunk = this.uploadFile.File.slice(start, end);
    this.chunk = chunk; // 暂存当前分片，供外部访问
    const chunkSizeValue = chunk.size;

    logger.debug(
      "uploadChunkManager",
      `开始上传分片 ${chunkIndex + 1}/${this.totalChunks}`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        chunkIndex,
        size: chunkSizeValue,
        start,
        end,
      },
    );

    // 创建独立的 FormData，作为参数传递给 upload 方法
    // 不要保存到实例级别，避免多文件并发时被覆盖
    const chunkFormData = new FormData();
    this.uploadFile.setFile(chunk, chunkFormData, chunkIndex);

    try {
      // 传递 signal 实现真正的超时控制
      // 传递 chunkFormData 作为请求参数，避免使用共享的 this.uploadFile.formData
      await this.uploadFile.upload(
        (res) => {
          // 使用 countedChunks 来防止重复累加
          this.response = res; // 暂存最新的响应数据，供外部访问

          // 关键只有当该分片未被标记为已上传时，才进行累加
          if (!this.chunks[chunkIndex]) {
            this.chunks[chunkIndex] = true;

            // 先累加字节数
            this.totalChunkSize += chunkSizeValue;

            // 再累加完成分片计数
            this.completedChunks++;

            // 标记为已计数，防止重试时重复累加
            this.countedChunks.add(chunkIndex);

            // 更新进度
            this.updateProgress();

            // 触发分片上传成功事件
            const up = this.uploadFile.transfer;
            up.emit("chunk-success", {
              chunkIndex,
              totalChunks: this.totalChunks,
              completedChunks: this.completedChunks,
              percent: this.uploadFile.proxy.percent || 0,
              file: this.uploadFile.proxy,
            });

            logger.info(
              "uploadChunkManager",
              `分片 ${chunkIndex + 1}/${this.totalChunks} 上传成功`,
              {
                fileId: this.uploadFile.fileId,
                fileName: this.uploadFile.fileName,
                chunkIndex,
                completedChunks: this.completedChunks,
                totalChunks: this.totalChunks,
                percent: this.uploadFile.proxy.percent,
              },
            );
          } else {
            logger.debug(
              "uploadChunkManager",
              `分片 ${chunkIndex + 1}/${this.totalChunks} 已上传，跳过累加`,
              {
                completedChunks: this.completedChunks,
                totalChunks: this.totalChunks,
              },
            );
          }

          // 从失败列表中移除
          const failIndex = this.failedChunks.indexOf(chunkIndex);
          if (failIndex > -1) {
            this.failedChunks.splice(failIndex, 1);
          }
        },
        signal,
        chunkFormData,
      ); // 传递 chunkFormData 作为参数

      return Promise.resolve();
    } catch (error) {
      // 分片失败时，不要回退 completedChunks！
      // 只标记 chunks 为 false，等待重试成功后再累加
      // 这样进度只会增加不会减少，避免进度回退导致用户体验差
      this.chunks[chunkIndex] = false;

      logger.error(
        "uploadChunkManager",
        `分片 ${chunkIndex + 1}/${this.totalChunks} 上传失败`,
        {
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
          chunkIndex,
          error: error instanceof Error ? error.message : String(error),
          completedChunks: this.completedChunks,
          totalChunks: this.totalChunks,
          progress: this.uploadFile.proxy.percent,
        },
      );

      // 触发分片上传失败事件
      const up = this.uploadFile.transfer;
      up.emit("chunk-error", {
        chunkIndex,
        totalChunks: this.totalChunks,
        error: error instanceof Error ? error.message : String(error),
        file: this.uploadFile.proxy,
      });

      throw error;
    }
  }

  /**
   * 合并所有分片
   */
  private async mergeChunks(): Promise<any> {
    const up = this.uploadFile.up;

    try {
      // 调用用户提供的合并回调
      const onMerge = up.OnMergeChunkCallBack;
      const response = onMerge ? await onMerge(this) : undefined;

      // ✅ 上传成功后清理文件缓存（如果启用了缓存）
      if (up.config?.chunkOptions?.enableFileCache && this.fileHash) {
        try {
          const { removeFileFromCache } = await import("../utils/fileCache");
          await removeFileFromCache(this.fileHash);
          logger.debug(
            "uploadChunkManager",
            `✅ 上传成功，已清理文件缓存: ${this.uploadFile.fileName}`,
            { fileHash: this.fileHash },
          );
        } catch (error) {
          logger.warn(
            "uploadChunkManager",
            `⚠️ 清理文件缓存失败（不影响上传）: ${this.uploadFile.fileName}`,
            error,
          );
        }
      }

      // 触发合并成功事件
      up.emit("merge-success", {
        file: this.uploadFile.proxy,
        response,
      });

      return response;
    } catch (error) {
      this.uploadFile.proxy.status = "fail";

      // 触发合并失败事件
      up.emit("merge-error", {
        file: this.uploadFile.proxy,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * 计算上传统计信息（统一处理，避免重复代码）
   */
  private calculateUploadStats(): void {
    this.chunkStatsInfos = {
      totalTime: this.totalChunkTime,
      fileSize: this.uploadFile.File.size,
      completedChunks: this.completedChunks,
      averageSpeed:
        this.uploadFile.File.size / (this.totalChunkTime / 1000) / 1024, // KB/s
    };
  }

  /**
   * 检查统计信息并触发合并
   */
  protected async checkStatistics() {
    // 计算总耗时
    this.chunkEndTime = performance.now();
    this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;

    // 基于 completedChunks 判断是否所有分片都完成了
    // chunks 可能会因为重试、断点续传等场景导致状态不一致
    // completedChunks 是可靠的计数器，只要累加了就说明分片确实上传成功了
    const allSuccess = this.completedChunks === this.totalChunks;

    logger.debug("uploadChunkManager", `检查统计信息`, {
      fileId: this.uploadFile.fileId,
      fileName: this.uploadFile.fileName,
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
      allSuccess,
      uploadedChunksTrue: this.chunks.filter((u) => u).length,
      failedChunks: this.failedChunks.length,
    });
    if (allSuccess) {
      // 所有分片上传成功，执行合并
      await this.handleAllChunksSuccess();
    } else if (this.failedChunks.length > 0) {
      // 如果已取消或已暂停，跳过自动重试
      if (this.isCancelled || this.isPaused) {
        logger.info("uploadChunkManager", "上传已取消或暂停，跳过自动重试", {
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
          isCancelled: this.isCancelled,
          isPaused: this.isPaused,
          failedChunks: this.failedChunks.length,
        });
        return;
      }
      // 有失败分片，执行重试逻辑
      await this.handleFailedChunks();
    } else {
      // 没有失败分片，但也没有全部完成（可能是被取消了）
      logger.warn("uploadChunkManager", `上传未完成`, {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        completedChunks: this.completedChunks,
        totalChunks: this.totalChunks,
      });
    }
  }

  /**
   * 处理所有分片成功的情况
   */
  protected async handleAllChunksSuccess(): Promise<void> {
    // 调用合并接口
    try {
      // 🔑 进入合并阶段
      this.uploadFile.proxy.status = "merging";
      this.uploadFile.transfer.emit("merging", {
        file: this.uploadFile.proxy,
        completedChunks: this.completedChunks,
        totalChunks: this.totalChunks,
      });

      const mergeResult = await this.mergeChunks();

      // 🔑 合并完成后才推到 100%
      this.uploadFile.proxy.percent = 100;

      this.uploadFile.onSuccess(mergeResult);
    } catch (error) {
      this.uploadFile.onError(error);
    }

    // 🔑 更新速度必须在 merge 之后，避免 merge 请求的 XHR 进度事件覆盖速度
    this.calculateAndUpdateSpeed(this.uploadFile.File.size);

    const totalTime = this.totalChunkTime / 1000;
    const averageSpeed =
      totalTime > 0 ? this.uploadFile.File.size / totalTime : 0;
    this.uploadFile.proxy.speed = {
      currentSpeed: 0, // 上传已完成，瞬时速度为 0
      averageSpeed,
      currentSpeedFormatted: "0 B/s",
      averageSpeedFormatted: formatSpeed(averageSpeed),
      estimatedTimeRemaining: 0,
      estimatedTimeFormatted: "已完成",
    };

    // 使用统一方法计算上传统计信息
    this.calculateUploadStats();
  }

  /**
   * 处理失败分片的情况（自动重试）
   */
  protected async handleFailedChunks(): Promise<void> {
    // 如果 retries 为 null，禁用自动重试，直接报错
    if (this.retries === null) {
      logger.warn(
        "uploadChunkManager",
        `发现 ${this.failedChunks.length} 个失败分片，自动重试已禁用，请手动重试`,
        {
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
          failedChunks: this.failedChunks,
        },
      );

      // this.setFileStatusToFail();
      this.uploadFile.onError(new Error("部分分片上传失败"));
      return;
    }

    // 正常重试逻辑（retries >= 0）
    logger.warn(
      "uploadChunkManager",
      `发现 ${this.failedChunks.length} 个失败分片，开始自动重试`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        failedChunks: this.failedChunks,
      },
    );

    await this.retryFailedChunks();

    // ✅ 重试完成后，检查是否还有失败分片
    if (this.failedChunks.length > 0) {
      // 重试后仍然有失败分片，设置文件状态为失败
      this.handleRetryFailure();
    } else {
      // 重试成功，所有分片都完成了，继续检查统计信息
      await this.checkStatistics();
    }
  }

  /**
   * 处理重试失败的情况（统一错误处理）
   */
  private handleRetryFailure(): void {
    logger.error(
      "uploadChunkManager",
      `重试后仍有 ${this.failedChunks.length} 个分片失败，设置文件状态为失败`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        failedChunks: this.failedChunks,
      },
    );

    // this.setFileStatusToFail();
    this.uploadFile.onError(new Error("部分分片上传失败，重试后仍未成功"));
  }

  /**
   * 重试失败的分片
   */
  public async retryFailedChunks(): Promise<void> {
    // ✅ 重置取消和暂停标志，允许重试
    this.isCancelled = false;
    this.isPaused = false;

    const failedChunksCopy = [...this.failedChunks];
    this.failedChunks = [];

    for (const chunkIndex of failedChunksCopy) {
      // 重置该分片的重试计数，允许手动重试时重新尝试
      this.retryCountMap.set(chunkIndex, 0);

      try {
        await this.uploadChunkWithRetry(chunkIndex);
      } catch (error) {
        this.failedChunks.push(chunkIndex);
      }
    }

    // 重试完成后，检查统计信息并触发合并或错误处理
    await this.checkStatistics();
  }

  /**
   * 取消上传
   *
   * 取消所有正在进行的分片上传任务，并清理相关资源。
   * 与 pause 不同，cancel 会完全停止上传，无法恢复。
   *
   * @example
   * ```typescript
   * file.cancel();
   * console.log(file.status); // "cancelled"
   * ```
   */
  public cancelUpload(): void {
    logger.info(
      "uploadChunkManager",
      `开始取消文件 ${this.uploadFile.fileName} 的上传`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        activeControllers: this.abortControllers.length,
      },
    );

    // ✅ 关键：设置取消标志，阻止新分片启动
    this.isCancelled = true;

    // ✅ 关键修复：如果正在计算 MD5，立即中断
    const hashController = (this as any).__hashAbortController__;
    if (hashController) {
      try {
        hashController.abort();
        logger.debug("uploadChunkManager", `已中止 MD5 计算`);
      } catch (error) {
        logger.warn("uploadChunkManager", `中止 MD5 计算时出错:`, error);
      }
    }

    // ✅ 中止所有活跃的 HTTP 请求
    this.abortControllers.forEach((controller) => {
      try {
        controller.abort();
        logger.debug("uploadChunkManager", `已中止一个分片的 HTTP 请求`);
      } catch (error) {
        logger.warn("uploadChunkManager", `中止分片请求时出错:`, error);
      }
    });

    // 清空 AbortController 数组
    this.abortControllers = [];

    // 设置为暂停状态，阻止新分片启动
    this.isPaused = true;

    // 唤醒所有等待中的分片上传任务，让它们检查取消状态
    if (this.pauseResolves.length > 0) {
      this.pauseResolves.forEach((resolve) => resolve());
      this.pauseResolves = [];
    }

    // 清空活跃上传任务集合
    this.activeUploads.clear();

    // 更新文件状态为已取消
    this.uploadFile.proxy.status = "cancelled";

    logger.info(
      "uploadChunkManager",
      `文件 ${this.uploadFile.fileName} 已取消上传`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        completedChunks: this.completedChunks,
        totalChunks: this.totalChunks,
      },
    );

    // 触发取消事件
    const up = this.uploadFile.transfer;
    up.emit("cancel", this.uploadFile.proxy);
  }

  /**
   * 暂停上传
   *
   * 暂停所有正在进行的分片上传,但保持当前进度。
   * 会等待当前活跃的分片完成后暂停新分片的启动。
   *
   * @example
   * ```typescript
   * file.pause();
   * console.log(file.status); // "paused"
   * ```
   */
  public pause(): void {
    if (this.isPaused) {
      return;
    }

    this.isPaused = true;
    this.uploadFile.proxy.status = "paused";
    logger.info(
      "uploadChunkManager",
      `文件 ${this.uploadFile.fileName} 已暂停`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        completedChunks: this.completedChunks,
        totalChunks: this.totalChunks,
      },
    );
  }

  /**
   * 恢复上传
   *
   * 从暂停的位置继续上传分片。
   *
   * @example
   * ```typescript
   * file.resume();
   * console.log(file.status); // "UDLoading"
   * ```
   */
  public async resume(): Promise<void> {
    if (!this.isPaused) {
      return;
    }

    this.isPaused = false;
    this.uploadFile.proxy.status = "UDLoading";

    // 触发恢复事件
    const up = this.uploadFile.transfer;
    up.emit("resume", this.uploadFile.proxy);

    logger.info(
      "uploadChunkManager",
      `文件 ${this.uploadFile.fileName} 已恢复`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        completedChunks: this.completedChunks,
        totalChunks: this.totalChunks,
      },
    );

    // 唤醒所有等待中的分片上传任务
    if (this.pauseResolves.length > 0) {
      this.pauseResolves.forEach((resolve) => resolve());
      this.pauseResolves = [];
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
   * 获取失败分片的数量
   * @returns 失败分片数量
   */
  public getFailedChunksCount(): number {
    return this.failedChunks.length;
  }

  /**
   * 等待恢复（用于暂停/恢复机制）
   * @private
   */
  protected async waitForResume(): Promise<void> {
    if (!this.isPaused) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.pauseResolves.push(() => resolve());
    });

    // ✅ 关键修复：唤醒后检查是否已取消
    if (this.isCancelled) {
      logger.info("uploadChunkManager", `分片上传被取消，停止执行`, {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
      });
      throw new Error("Upload cancelled");
    }
  }

  /**
   * 更新上传进度
   *
   * ✅ 简单直接的进度计算：completedChunks / totalChunks * 100%
   * completedChunks 只在分片真正上传成功时才累加
   */
  public updateProgress() {
    // 不再在此处自增 completedChunks，而是由调用方（uploadChunk 成功回调）确保状态一致
    // 此处仅负责根据当前的 completedChunks 计算百分比

    // 防止除以0
    if (this.totalChunks === 0) {
      this.uploadFile.proxy.percent = 100;
      return;
    }

    // 简单直接的进度计算
    let percent = Math.floor((this.completedChunks / this.totalChunks) * 100);

    // 边界保护：确保不超过 100%
    percent = Math.min(100, Math.max(0, percent));

    // 🔑 分片传输阶段进度最高 99%，100% 留给合并完成后
    if (this.completedChunks >= this.totalChunks) {
      percent = 99;
    }

    this.uploadFile.proxy.percent = percent;

    // 计算并更新全局上传速度
    this.calculateAndUpdateSpeed(this.totalChunkSize);
  }

  public async startUpload() {
    const up = this.uploadFile.transfer;

    // 触发分片上传开始事件
    up.emit("chunk-upload-start", {
      file: this.uploadFile.proxy,
      totalChunks: this.totalChunks,
      chunkSize: this.chunkSize,
    });

    // 重置所有状态（避免重新上传时使用旧值）
    this.totalChunkSize = 0;
    this.uploadFile.__transferBytes__ = 0;
    this.chunkStartTime = performance.now(); // 重置开始时间
    this.countedChunks.clear(); // 重置已计数分片集合

    // 重置速度计算状态（避免第二次上传时速度计算错误）
    this.lastUpdateTime = 0;
    this.lastChunkBytes = 0;

    // ✅ 关键修复：重置取消和暂停标志，允许重新开始上传
    this.isCancelled = false;
    this.isPaused = false;

    // 重新创建 PQueue，确保使用正确的并发配置
    this.queue = new PQueue({ concurrency: this.maxConcurrent });

    // 初始化总字节数（只在首次上传时）
    if (!this.uploadFile.__hasCountedTotalBytes__) {
      up.totalTransferredBytes += this.uploadFile.File.size;
      up.totalBytes += this.uploadFile.File.size;
      up.totalFormatSize = formatFileSize(up.totalBytes);
      this.uploadFile.__hasCountedTotalBytes__ = true;
    }

    // 🔑 根据分片大小动态计算超时下限（假设最低网速 50 KB/s）
    //    20MB 分片 → 约 409 秒，1MB 分片 → 约 20 秒
    //    timeout 为 0 时跳过，永不超时
    if (this.timeout > 0) {
      const minTimeoutBySize = Math.ceil((this.chunkSize / 51200) * 1000);
      this.timeout = Math.max(this.timeout, 60000, minTimeoutBySize);
    }

    try {
      const res = await this.initUpload();

      // ✅ 关键修复：区分真正的秒传和断点续传
      if (this.completedChunks === this.totalChunks) {
        if (this.isInstantTransfer) {
          // 真正的秒传：文件已存在，无需合并，直接成功
          logger.info(
            "uploadChunkManager",
            "⚡ 秒传成功，文件已存在，跳过合并",
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              fileHash: this.fileHash,
            },
          );

          // 记录开始和结束时间（秒传耗时几乎为0）
          this.chunkStartTime = performance.now();
          this.chunkEndTime = performance.now();
          this.totalChunkTime = 0;

          // 计算上传统计信息
          this.calculateUploadStats();

          // 触发成功回调，传递秒传标记
          this.uploadFile.onSuccess({
            isInstantUpload: true,
            url: res?.url,
            message: "文件已存在，秒传成功",
          });

          return;
        } else {
          // 断点续传：所有分片已上传但未合并，需要执行合并
          logger.info("uploadChunkManager", "所有分片已上传，执行合并", {
            fileId: this.uploadFile.fileId,
            fileName: this.uploadFile.fileName,
            completedChunks: this.completedChunks,
            totalChunks: this.totalChunks,
          });

          // 记录开始时间（如果是断点续传，需要重新计算）
          if (!this.chunkStartTime) {
            this.chunkStartTime = performance.now();
          }

          try {
            // 🔑 进入合并阶段
            this.uploadFile.proxy.status = "merging";
            this.uploadFile.transfer.emit("merging", {
              file: this.uploadFile.proxy,
              completedChunks: this.completedChunks,
              totalChunks: this.totalChunks,
            });

            const mergeResult = await this.mergeChunks();

            // 🔑 合并完成后才推到 100%
            this.uploadFile.proxy.percent = 100;

            // 记录总耗时
            this.chunkEndTime = performance.now();
            this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;

            // 🔑 更新速度（断点续传也可能触发 merge XHR 覆盖速度，必须在 merge 之后）
            this.calculateAndUpdateSpeed(this.uploadFile.File.size);
            const resumeTotalTime = this.totalChunkTime / 1000;
            const resumeAvgSpeed =
              resumeTotalTime > 0
                ? this.uploadFile.File.size / resumeTotalTime
                : 0;
            this.uploadFile.proxy.speed = {
              currentSpeed: 0,
              averageSpeed: resumeAvgSpeed,
              currentSpeedFormatted: "0 B/s",
              averageSpeedFormatted: formatSpeed(resumeAvgSpeed),
              estimatedTimeRemaining: 0,
              estimatedTimeFormatted: "已完成",
            };

            // 使用统一方法计算上传统计信息
            this.calculateUploadStats();

            // 触发成功回调
            this.uploadFile.onSuccess(mergeResult);

            logger.info("uploadChunkManager", "文件传输完成（断点续传）", {
              totalTime: this.totalChunkTime,
              completedChunks: this.completedChunks,
              totalChunks: this.totalChunks,
            });
          } catch (error) {
            // 合并失败，触发错误回调
            this.chunkEndTime = performance.now();
            this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;
            this.uploadFile.onError(error);
          }

          return;
        }
      }
      computeTransferTime(this.uploadFile.proxy.transferTime).start();
      // 使用信号量控制并发
      await this.uploadWithConcurrency();

      computeTransferTime(this.uploadFile.proxy.transferTime).end();

      // ✅ 关键修复：上传完成后检查统计信息并触发合并
      await this.checkStatistics();
    } catch (error) {
      // 错误时也要检查统计信息，确保正确更新状态和进度

      await this.checkStatistics();

      // 记录耗时
      this.chunkEndTime = performance.now();
      this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;

      // 如果 checkStatistics 没有处理错误（比如还有失败分片），则抛出错误
      if (this.failedChunks.length > 0) {
        throw error;
      }
    }
  }

  /**
   * 使用信号量控制并发上传
   */
  protected async uploadWithConcurrency(): Promise<void> {
    const uploadPromises: Promise<void>[] = [];
    const chunkStartTimes: number[] = [];
    const chunkDurations: number[] = [];

    // 确保队列已初始化
    if (!this.queue) {
      throw new Error("PQueue not initialized. Call startUpload() first.");
    }

    for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
      // 跳过已上传的分片（断点续传场景）
      if (this.chunks[chunkIndex]) {
        continue;
      }

      this.chunkIndex = chunkIndex + 1;

      // 在每个分片上传前检查暂停状态
      uploadPromises.push(
        this.queue
          .add(async () => {
            // ✅ 在真正开始上传前检查是否暂停或取消
            await this.waitForResume();

            // 记录分片开始时间
            chunkStartTimes[chunkIndex] = performance.now();

            try {
              await this.uploadChunkWithRetry(chunkIndex);
              // 记录分片耗时
              chunkDurations[chunkIndex] =
                performance.now() - chunkStartTimes[chunkIndex];
            } catch (error) {
              // 记录失败分片的耗时（如果有）
              if (chunkStartTimes[chunkIndex]) {
                chunkDurations[chunkIndex] =
                  performance.now() - chunkStartTimes[chunkIndex];
              }
              throw error;
            }
          })
          .catch((_error) => {
            if (
              _error instanceof Error &&
              (_error.message === "Upload cancelled" ||
                _error.message === "Transfer cancelled")
            ) {
              this.failedChunks.push(chunkIndex);
            }
            throw _error;
          }),
      );
    }

    await Promise.allSettled(uploadPromises);

    // 计算分片上传统计信息
    this.chunkStats = {
      averageTime:
        chunkDurations.filter((d) => d > 0).reduce((a, b) => a + b, 0) /
          chunkDurations.filter((d) => d > 0).length || 0,
      maxTime: Math.max(...chunkDurations.filter((d) => d > 0)),
      minTime: Math.min(...chunkDurations.filter((d) => d > 0)),
    };
  }
}
