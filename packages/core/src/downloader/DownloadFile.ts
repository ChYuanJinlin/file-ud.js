import axios from "axios";
import { IDownloadFile } from "../types";
import TransferFile from "../transfer/TransferFile";

import {
  computeTransferTime,
  createReactiveDownloadFile,
  isPlainObject,
  logger,
} from "../utils";
import ChunkManager from "../chunkManager";
import DownloadChunkManager from "./DownloadChunkManager";
import Downloader from ".";
import Transfer from "../transfer/Transfer";
import { XHRInterceptor } from "../xhr-intercepto";

/**
 * 文件下载实例类
 * 负责单个文件的下载逻辑、状态管理、速率计算和生命周期控制
 *
 * @template T - 下载成功后的响应数据类型
 */
export default class DownloadFile<T = any> extends TransferFile<
  DownloadFile,
  T
> {
  /**
   * 分片管理器实例
   * 每个文件拥有独立的 downloadChunkManager,实现并发控制、断点续传和失败隔离
   */
  public downloadChunkManager: DownloadChunkManager | null = null;
  public dl: Downloader<T>;

  /**
   * 🔑 文件创建时保存 action 快照，防止切换模式后重试时用到错误的 action
   */
  private _action: NonNullable<DownloadFile["dl"]["config"]>["action"] | undefined;

  /**
   * 流式保存的 FileHandle（File System Access API）
   * 如果设置了 fileHandle，下载完成后通过流式写入文件，不触发浏览器下载对话框
   */
  public fileHandle: FileSystemFileHandle | null | undefined = null;

  /**
   * 分片下载专用 headers 队列（如 Range）
   * 并发分片各自 push，拦截器 shift 取走，避免并发覆盖导致 Range 头错乱
   * 函数 action 下，用户不需要手动处理分片 headers
   */
  public _chunkHeadersQueue: Record<string, string>[] = [];

  public static interceptor: XHRInterceptor<DownloadFile>;

  /**
   * 全局共享的 WeakMap
   * 用于存储 XHR 实例与文件上下文的映射关系,支持拦截器透明注入
   */
  private static xhrToFileMap = new WeakMap<XMLHttpRequest, DownloadFile>();

  /**
   * 全局共享的当前下载文件队列
   * 用于在拦截器中查找匹配的 XHR
   */
  private static currentQueue: DownloadFile[] = [];

  /**
   * 跟踪已分配到 XHR 的文件集合
   * 用于按顺序分配 XHR 实例,避免冲突
   */
  private static assignedFiles = new Set<DownloadFile>();

  constructor(file: IDownloadFile, transfer: Transfer) {
    super(file, transfer);
    this.dl = transfer as unknown as Downloader<T>;
    // 🔑 文件创建时保存 action 快照，重试/恢复时始终使用创建时的 action
    this._action = this.dl.config?.action;
    this.proxy = createReactiveDownloadFile(this, transfer);

    // 存储流式保存的 fileHandle
    if (file.fileHandle) {
      this.fileHandle = file.fileHandle;
    }

    // 如果是分片下载（检查 chunkOptions 配置），在构造时就创建 downloadChunkManager
    if (this.dl.config?.chunkOptions) {
      this.downloadChunkManager = new DownloadChunkManager(
        this.dl.config.chunkOptions,
        this,
      );
      this.chunkManager = this.downloadChunkManager;

      // 如果回显数据中包含分片信息，初始化状态（基类统一实现）
      if (file.totalChunks !== undefined) {
        this.initChunkManagerFromRestore(file);
      }
    }

    this.initInterceptor();

    // 添加到队列
    DownloadFile.currentQueue.push(this);

    DownloadFile.interceptor.install();
  }

  /**
   * 执行普通下载的重试（模板方法覆写）
   */
  protected async doRetryTransfer(): Promise<T> {
    return this.download();
  }

  /**
   * 从回显数据初始化 downloadChunkManager 状态
   */
  private async initChunkManagerFromRestore(
    file: IDownloadFile,
  ): Promise<void> {
    if (!this.downloadChunkManager) {
      logger.warn(
        "DownloadFile",
        "initChunkManagerFromRestore: downloadChunkManager 不存在",
      );
      return;
    }

    logger.info(
      "DownloadFile",
      `从回显数据初始化分片下载状态: ${this.fileName}`,
      {
        fileId: this.fileId,
        totalChunks: file.totalChunks,
        completedChunks: file.completedChunks,
        chunkIndexes: file.chunkIndexes?.length || 0,
        fileHash: file.fileHash,
      },
    );

    if (file.totalChunks !== undefined) {
      this.downloadChunkManager.totalChunks = file.totalChunks;
    }

    if (file.completedChunks !== undefined) {
      this.downloadChunkManager.completedChunks = file.completedChunks;
    }

    if (file.totalChunks !== undefined) {
      this.downloadChunkManager.chunks = new Array(file.totalChunks).fill(
        false,
      );
    }

    if (file.chunkIndexes && file.chunkIndexes.length > 0) {
      file.chunkIndexes.forEach((index) => {
        if (
          this.downloadChunkManager &&
          index >= 0 &&
          index < this.downloadChunkManager.totalChunks
        ) {
          this.downloadChunkManager.chunks[index] = true;
        }
      });
    } else if (
      file.completedChunks !== undefined &&
      this.downloadChunkManager
    ) {
      for (
        let i = 0;
        i < file.completedChunks && i < this.downloadChunkManager.totalChunks;
        i++
      ) {
        this.downloadChunkManager.chunks[i] = true;
      }
    }

    if (file.fileHash) {
      (this.downloadChunkManager as any).fileHash = file.fileHash;
    }

    if (this.downloadChunkManager.totalChunks > 0) {
      const percent = Math.round(
        (this.downloadChunkManager.completedChunks /
          this.downloadChunkManager.totalChunks) *
          100,
      );
      this.percent = percent;
      this.proxy.percent = percent;
    }

    if (
      this.downloadChunkManager.completedChunks ===
        this.downloadChunkManager.totalChunks &&
      this.downloadChunkManager.totalChunks > 0
    ) {
      // 🔑 全部分片已传输完，但合并尚未开始 — 进度卡在 99%，状态留给 start() 流转
      this.percent = 99;
      this.proxy.percent = 99;
    }

    this.transfer.updateGlobalStats();
    this.transfer.triggerUpdate();
  }

  /**
   * 执行下载
   */
  public async download(): Promise<T> {
    this.proxy.loading = true;
    // 🔑 重试场景：cancel 的 finally 块已将文件移出 currentQueue，
    //    拦截器需要在队列中找到文件才能匹配 XHR 并绑定进度回调
    //    同时清理 assignedFiles 残留，避免新 XHR 被分配到错误文件
    DownloadFile.interceptor?.cleanupFile?.(this as any);
    if (!DownloadFile.currentQueue.includes(this as any)) {
      DownloadFile.currentQueue.push(this as any);
    }
    return new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.transfer.loading = true;

      (async () => {
        try {
          if (!this._action) {
            logger.warn("DownloadFile", "请设置下载地址");
            reject(new Error("请设置下载地址"));
            return;
          }

          // 记录下载开始时间
          if (!this.downloadChunkManager) {
            computeTransferTime(this.proxy.transferTime).start();
          }
          if (!this.transfer.transferTime.startTime) {
            computeTransferTime(this.transfer.transferTime).start();
          }

          let result:
            | boolean
            | undefined
            | null
            | { [key: string]: any };
          if (this.dl.beforeTransferCallback) {
            try {
              result = await this.dl.beforeTransferCallback(this);
              if (!result) {
                reject(new Error("beforeTransferCallback 返回 false"));
                return;
              }
            } catch (error) {
              reject(error);
              return;
            }
          }

          this.proxy.status !== "cancelled" &&
            (this.proxy.status = "UDLoading");

          const response = await this._doHttpRequest({
            data: isPlainObject(result) ? result : undefined,
          });
          const res = response.data;
          // 🚀 流式保存：先确保文件成功落盘，再触发 onSuccess → 避免保存失败时
          //    status 已是 "success" 但 percent 未到 100 的状态不一致
          if (this.fileHandle) {
            await DownloadFile.writeToFileHandle(this.fileHandle, res);
          } else {
            Downloader.saveBlob(this.fileName, res as Blob);
          }
          this.proxy.percent = 100;
          this.onSuccess(res);
          // 🔑 双重保险：绕开 proxy，直接写原始对象上的 status，
          //    确保无论 proxy setter 链路如何，底层值一定正确
          (this as any).status = "success";

          resolve(res);
        } catch (err: any) {
          if (this.isCancel !== true) {
            this.proxy.status = "error";
          }
          this.onError(err);
          reject(err);
        } finally {
          // 记录下载结束时间
          if (!this.downloadChunkManager) {
            computeTransferTime(this.proxy.transferTime).end();
          }
          this.proxy.loading = false;
          this.transfer.loading = false;

          // 清理队列和活跃文件列表（防止内存泄漏）
          const queueIdx = DownloadFile.currentQueue.indexOf(this as any);
          if (queueIdx !== -1) {
            DownloadFile.currentQueue.splice(queueIdx, 1);
          }
          DownloadFile.assignedFiles.delete(this as any);
          // 🔑 同步清理拦截器内部的 assignedFiles 集合，
          //    否则重试时文件被标记为"已分配"会绕过主匹配逻辑（仅靠 fallback 兜底）
          DownloadFile.interceptor?.cleanupFile(this as any);

          // 🔑 兜底移除（取消/失败场景），带 indexOf 保护避免 splice(-1, 1) 误删
          const activeIdx = this.transfer.activeFiles.indexOf(this);
          if (activeIdx !== -1) {
            this.transfer.activeFiles.splice(activeIdx, 1);
          }
        }
      })();
    });
  }

  /**
   * 更新当前文件的下载进度和已传输字节数（模板方法）
   *
   * - 普通下载：从 event.loaded/event.total 直接计算百分比和字节数
   * - 分片下载：由 downloadChunkManager 独立维护进度，此处无需额外操作
   *
   * 当响应没有 Content-Length 头（event.total === 0）时：
   * - __transferBytes__ 使用 event.loaded 记录实际已下载字节数
   * - 百分比无法精确计算，使用基于 loaded 的模拟进度（0~99%），完成时跳到 100%
   */
  protected updateLocalProgress(event: ProgressEvent): void {
    if (!this.downloadChunkManager) {
      const fileSize = this.File?.size || this.size || 0;

      if (event.lengthComputable && event.total > 0) {
        // 已知总大小：精确计算百分比，但上限卡在 99%
        // 🔑 最后一个 progress 事件 loaded===total 时，响应体可能还在传输中，
        //    此时 status 仍是 "UDLoading"，若 percent=100 会造成视觉不一致
        //    100% 只在 onSuccess 之后显式设置
        this.proxy.percent = Math.min(
          99,
          Math.floor((event.loaded * 100) / event.total),
        );
        this.__transferBytes__ = Math.floor(
          fileSize * (this.proxy.percent / 100),
        );
      } else if (event.loaded > 0) {
        // 未知总大小：记录已下载字节数，用模拟进度（避免一直是 0%）
        this.__transferBytes__ = event.loaded;
        // 使用对数衰减模拟进度，越到后面增长越慢，最大到 99%
        this.proxy.percent = Math.min(
          99,
          Math.floor(Math.log2(event.loaded / 1024 + 1) * 10),
        );
      } else {
        this.__transferBytes__ = 0;
      }
    }
  }

  /**
   * 返回下载的分片管理器
   */
  protected getChunkManager(): ChunkManager | null {
    return this.downloadChunkManager;
  }

  /**
   * 下载单个分片（Range 请求）
   *
   * - 字符串 action：直接走 axios，Range 头在 overrides.headers 中显式传入
   * - 函数 action：通过 _chunkHeadersQueue 告知拦截器注入 Range 头，
   *   最终由 cfg.action(this) 调用用户的 axios 函数
   *
   * @param start  - 分片起始字节偏移
   * @param end    - 分片结束字节偏移（含）
   * @param signal - AbortSignal，用于超时/取消
   * @returns 分片的 Blob 数据
   */
  public async downloadChunk(
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const rangeHeader = { Range: `bytes=${start}-${end}` };

    // 🔑 把本分片的 headers 推入队列，拦截器在 XHR send 时 shift 取出
    //     并发分片各自 push → send 各自 shift，避免单属性被覆盖
    this._chunkHeadersQueue.push(rangeHeader);

    try {
      const response = await this._doHttpRequest({
        headers: rangeHeader,
        signal,
      });

      return response.data instanceof Blob
        ? response.data
        : new Blob([response.data]);
    } finally {
      // 🔑 清理队列中未被拦截器消费的残留（请求失败/取消等情况）
      const idx = this._chunkHeadersQueue.indexOf(rangeHeader);
      if (idx !== -1) {
        this._chunkHeadersQueue.splice(idx, 1);
      }
    }
  }

  /**
   * 统一 HTTP 请求方法（download() 和 downloadChunk() 共用）
   *
   * action 不区分普通/分片，只按类型分发：
   *   - 字符串 action → 始终走 axios（分片时 headers 里带 Range，普通时不带）
   *   - 函数 action → 始终调 cfg.action(this)（分片时 _chunkHeadersQueue 已 push，拦截器自动注入 Range）
   */
  private async _doHttpRequest(overrides?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    data?: any;
  }): Promise<any> {
    const cfg = this.dl.config;
    this.__transferBytes__ = 0;
    if (!cfg) {
      throw new Error("下载配置不存在，请检查 DownloaderConfig");
    }

    const method = cfg.axiosOptions?.method || "get";
    const headers: Record<string, string> = {
      ...cfg.headers,
      ...overrides?.headers,
    };

    // ======== 字符串 action：始终 axios ========
    if (typeof this._action === "string") {
      return (cfg.axiosInstance || axios)({
        url: this._action,
        method,
        headers,
        data: overrides?.data,
        responseType: cfg.axiosOptions?.responseType || "blob",
        timeout: cfg.timeout,
        signal: overrides?.signal,
      });
    } else if (typeof this._action === "function") {
      // 🔑 函数 action：通过 XHR 拦截器机制处理取消，不暴露 signal 给用户
      if (overrides?.signal) {
        overrides.signal.addEventListener(
          "abort",
          () => this.abort?.(),
          { once: true },
        );
      }
      const actionResult = this._action(this);
      const res = await Promise.resolve(actionResult);
      // 支持函数返回字符串 URL：核心代码自动发起 axios 请求
      if (typeof res === "string") {
        return (cfg.axiosInstance || axios)({
          url: res,
          method,
          headers,
          data: overrides?.data,
          responseType: cfg.axiosOptions?.responseType || "blob",
          timeout: cfg.timeout,
          signal: overrides?.signal,
        });
      }
      return { data: res };
    }
    // action 既不是字符串也不是函数 → 配置错误
    throw new Error("action 必须是字符串 URL 或函数");
  }

  /**
   * 获取文件大小（下载场景：无 File 对象，fallback 到 size 属性）
   */
  public getFileSize(): number {
    return this.File?.size || this.size || 0;
  }

  /**
   * 通过 FileHandle 流式写入 Blob 数据到磁盘
   *
   * 使用 File System Access API，直接写入用户选择的文件位置。
   * 绕过浏览器内存限制，适合大文件下载。
   *
   * @param fileHandle - 文件句柄
   * @param data - 要写入的数据（Blob 或可转为 Blob）
   */
  /**
   * 从下载列表中移除当前文件，取消进行中的下载
   */
  remove() {
    // 取消下载
    if (this.downloadChunkManager) {
      this.downloadChunkManager.cancel();
    } else {
      this.abort?.();
    }

    const dl = this.transfer;

    // 从文件列表中移除
    dl.files = dl.files.filter((f) => f.fileId !== this.fileId);

    // 重新计算全局统计信息
    dl.updateGlobalStats();

    dl.triggerUpdate();
    dl.emit("remove", this.proxy as any);
  }

  public static async writeToFileHandle(
    fileHandle: FileSystemFileHandle,
    data: Blob | any,
  ): Promise<void> {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(data instanceof Blob ? data : new Blob([data]));
      await writable.close();
      logger.info("DownloadFile", "流式写入完成");
    } catch (err: any) {
      logger.error("DownloadFile", "流式写入文件失败", err);
      throw err;
    }
  }
}
