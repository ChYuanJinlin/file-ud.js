import PQueue from "p-queue";

/**
 * 全局文件级并发控制器（单例）
 *
 * 支持三层配置（优先级从高到低）：
 * 1. maxUploadConcurrent / maxDownloadConcurrent — 上传/下载独立限制
 * 2. maxSharedConcurrent — 全局共享限制（上传+下载平等共享）
 * 3. 无限制（都不设置或设为 0）
 *
 * 例如：
 *   - 只设 maxUploadConcurrent=2：上传最多 2 个文件并行，下载无限制
 *   - 只设 maxSharedConcurrent=3：上传+下载加起来最多 3 个文件并行
 *   - 同时设 maxUploadConcurrent=2 + maxDownloadConcurrent=1：上传 2 个 + 下载 1 个，互不影响
 *
 * 不控制分片并发，分片并发由 ChunkManager 内部的 PQueue 独立管理。
 */
export default class FileConcurrencyController {
  private static instance: FileConcurrencyController;

  // 上传专用队列
  private uploadQueue: PQueue | null = null;
  private _maxUploadConcurrent: number = 0;

  // 下载专用队列
  private downloadQueue: PQueue | null = null;
  private _maxDownloadConcurrent: number = 0;

  // 全局共享 fallback 队列
  private sharedQueue: PQueue | null = null;
  private _maxSharedConcurrent: number = 0;

  static getInstance(): FileConcurrencyController {
    if (!FileConcurrencyController.instance) {
      FileConcurrencyController.instance = new FileConcurrencyController();
    }
    return FileConcurrencyController.instance;
  }

  // ==================== 上传专用 ====================

  /** 上传专用文件并发数（0 = 不限制，会回退到 sharedQueue 或完全不限制） */
  set maxUploadConcurrent(n: number) {
    if (n === this._maxUploadConcurrent) return;
    this._maxUploadConcurrent = n;
    if (n > 0) {
      this.uploadQueue = new PQueue({ concurrency: n });
      (this.uploadQueue as any).__v_skip = true;
    } else {
      this.uploadQueue = null;
    }
  }

  get maxUploadConcurrent(): number {
    return this._maxUploadConcurrent;
  }

  // ==================== 下载专用 ====================

  /** 下载专用文件并发数（0 = 不限制，会回退到 sharedQueue 或完全不限制） */
  set maxDownloadConcurrent(n: number) {
    if (n === this._maxDownloadConcurrent) return;
    this._maxDownloadConcurrent = n;
    if (n > 0) {
      this.downloadQueue = new PQueue({ concurrency: n });
      (this.downloadQueue as any).__v_skip = true;
    } else {
      this.downloadQueue = null;
    }
  }

  get maxDownloadConcurrent(): number {
    return this._maxDownloadConcurrent;
  }

  // ==================== 共享 fallback ====================

  /** 全局共享文件并发数（上传+下载平等共享，当独立限制未设置时使用） */
  set maxSharedConcurrent(n: number) {
    if (n === this._maxSharedConcurrent) return;
    this._maxSharedConcurrent = n;
    if (n > 0) {
      this.sharedQueue = new PQueue({ concurrency: n });
      (this.sharedQueue as any).__v_skip = true;
    } else {
      this.sharedQueue = null;
    }
  }

  get maxSharedConcurrent(): number {
    return this._maxSharedConcurrent;
  }

  /** @deprecated 兼容旧 API，等同于 maxSharedConcurrent */
  set maxConcurrent(n: number) {
    this.maxSharedConcurrent = n;
  }

  get maxConcurrent(): number {
    return this._maxSharedConcurrent;
  }

  // ==================== 运行任务 ====================

  /** 获取上传实际使用的队列 */
  private getUploadQueue(): PQueue | null {
    return this.uploadQueue || this.sharedQueue;
  }

  /** 获取下载实际使用的队列 */
  private getDownloadQueue(): PQueue | null {
    return this.downloadQueue || this.sharedQueue;
  }

  /**
   * 在"上传"文件并发池中运行任务
   * 优先级：uploadQueue > sharedQueue > 无限制
   */
  async runAsUpload<T>(fn: () => Promise<T>): Promise<T> {
    const queue = this.getUploadQueue();
    if (!queue) return fn();
    return queue.add(fn) as Promise<T>;
  }

  /**
   * 在"下载"文件并发池中运行任务
   * 优先级：downloadQueue > sharedQueue > 无限制
   */
  async runAsDownload<T>(fn: () => Promise<T>): Promise<T> {
    const queue = this.getDownloadQueue();
    if (!queue) return fn();
    return queue.add(fn) as Promise<T>;
  }
}
