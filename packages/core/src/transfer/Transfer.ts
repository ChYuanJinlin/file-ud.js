import {
  beforeTransferCallBack,
  ErrorCallBack,
  EventName,
  IFile,
  IUDPlugin,
  onInitChunkCallback,
  OnMergeChunkCallBack,
  speedInfo,
  successCallback,
  TimeInfo,
  UpdateCallBack,
} from "../types";
import { formatDuration, formatFileSize, formatSpeed, isFileActive } from "../utils";
import { EventEmitter } from "../utils/event-emitter";
import TransferFile from "./TransferFile";

export default class Transfer<
  T extends TransferFile<T> = TransferFile<any>,
  D = any,
> extends EventEmitter {
  /** 当前传输任务的文件列表 */
  public files: T[] = [];
  /** 当前正在上传或下载任务的文件列表 用来判断当前文件是否全部上传完成 */
  public activeFiles: T[] = [];

  /** 总字节数 */
  public totalBytes: number = 0;

  /** 已传输的总字节数 */
  public transferredBytes: number = 0;
  /** 总的已传输的总字节数 */
  public totalTransferredBytes: number = 0;
  /** 全局已传输的总大小（格式化字符串），如 "125.50 MB" */
  public transferredFormatSize: string = "0 B";
  public lastLoadedMap = new Map();
  public plugins: IUDPlugin<T>[] = [];
  /** 插件间共享数据（如 MD5 计算结果等），由插件自行存取 */
  public pluginSharedData = new Map<string, any>();
  /** 全局待传输的总大小（格式化字符串），如 "256.80 MB" */
  public totalFormatSize: string = "0 B";

  /** 全局传输速率信息 (瞬时速度、平均速度等) */
  public speed: speedInfo = {
    currentSpeed: 0,
    averageSpeed: 0,
    currentSpeedFormatted: "0 B/s",
    averageSpeedFormatted: "0 B/s",
    estimatedTimeRemaining: -1,
    estimatedTimeFormatted: "计算中...",
  };

  /** 全局传输进度百分比 (0-100) */
  public totalPercent: number = 0;

  /** 是否处于加载/传输状态 */
  public loading: boolean = false;

  /** 传输时间统计信息 (开始时间、结束时间、耗时) */
  public transferTime: TimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };

  /** 内部定时器 ID，用于防抖更新 */
  public __updateTimer__: number | undefined = undefined;
  public updateCallback: UpdateCallBack<T> | null | undefined = null;
  public onInitChunkCallback: onInitChunkCallback<T> | null = null;
  public OnMergeChunkCallBack: OnMergeChunkCallBack | null = null;
  public beforeTransferCallback: beforeTransferCallBack<T> | null | undefined =
    null;

  public static onError: ErrorCallBack;
  public successCallback: successCallback<D> = () => null;
  /**
   * 触发更新回调（requestAnimationFrame 防抖）
   *
   * 用 rAF 替代 setTimeout，确保同一帧内多次调用只执行一次，
   * 多文件并发场景下所有文件的 Proxy set 共享同一个 rAF 调度。
   * @private
   */
  public triggerUpdate(): void {
    if (this.__updateTimer__ !== undefined) return; // 已调度，跳过
    this.__updateTimer__ = requestAnimationFrame(() => {
      this.__updateTimer__ = undefined;
      // 计算并更新全局上传速率
      this.speed = this.calculateGlobalUploadSpeed();

      this.updateCallback?.([...this.files]);
    });
  }

  /**
   * 更新全局统计信息（内部方法）
   * @private
   */
  public updateGlobalStats() {
    // 重新计算总字节数（兼容下载场景：下载文件没有 File 对象，fallback 到 size 属性）
    this.totalBytes = this.files.reduce((sum, file) => {
      return sum + (file.File?.size || file.size || 0);
    }, 0);

    // 更新格式化后的总大小
    this.totalFormatSize = formatFileSize(this.totalBytes);

    // 计算总进度（按文件大小加权，避免简单平均导致的进度不准）
    if (this.files.length > 0 && this.totalBytes > 0) {
      let weightedPercent = 0;
      this.files.forEach((file) => {
        const fileSize = file.File?.size || file.size || 0;
        if (fileSize > 0) {
          weightedPercent += (file.percent || 0) * fileSize;
        }
      });
      this.totalPercent = Math.round(weightedPercent / this.totalBytes);
    } else {
      this.totalPercent = 0;
    }
  }
  /**
   * 重置上状态为初始值（统一重置逻辑）
   * @private
   */
  public resetState(): void {
    this.transferredBytes = 0;
    this.totalBytes = 0;
    this.totalFormatSize = "0 B";
    this.transferredFormatSize = "0 B";

    this.totalTransferredBytes = 0;
    this.speed = {
      currentSpeedFormatted: "",
      averageSpeedFormatted: "",
      currentSpeed: 0,
      averageSpeed: 0,
      estimatedTimeRemaining: -1,
      estimatedTimeFormatted: "计算中...",
    };
    this.transferTime = {
      startTime: 0,
      endTime: 0,
      duration: 0,
      durationFormatted: "0s",
    };
    this.totalPercent = 0;
    this.activeFiles = [];
    // 注意：不重置 this.events，保留用户已注册的事件监听器
    this.files = [];
    // Object.create 场景下可能为 undefined，忽略
    this.lastLoadedMap?.clear();
    this.plugins = [];
    // ✅ 重置回调为安全的默认值，避免 Object.create 场景下出现 undefined
    this.successCallback = () => null;
    this.updateCallback = null;
    this.beforeTransferCallback = null;
    this.onInitChunkCallback = null;
    this.OnMergeChunkCallBack = null;
  }
  set onUpdate(callback: UpdateCallBack<T>) {
    this.updateCallback = callback;
  }

  set onInitChunk(callback: onInitChunkCallback<T>) {
    this.onInitChunkCallback = callback;
  }

  set onMergeChunk(callback: OnMergeChunkCallBack) {
    this.OnMergeChunkCallBack = callback;
  }
  set onSuccess(callback: successCallback<D>) {
    this.successCallback = callback;
  }
  set onbeforeTransfer(callback: beforeTransferCallBack<T>) {
    this.beforeTransferCallback = callback;
  }
  /**
   * 注册插件
   * @param plugin 插件实例
   * @param options 插件配置
   */
  use(plugin: IUDPlugin<T> | IUDPlugin<T>[], options?: any): this {
    const plugins = Array.isArray(plugin) ? plugin : [plugin];

    for (const p of plugins) {
      // 检查是否已注册
      if (this.plugins.some((existing) => existing.name === p.name)) {
        console.warn(`插件 ${p.name} 已存在，跳过注册`);
        continue;
      }

      // 调用插件的 install 方法
      if (p.install) {
        p.install(this, options);
      }
      p.created?.(this);
      this.plugins.push(p);
      console.log(`✅ 插件已注册: ${p.name} v${p.version || "1.0.0"}`);
    }

    // 按优先级排序
    this.plugins.sort((a, b) => (a.priority || 50) - (b.priority || 50));

    return this;
  }

  /**
   * 移除插件
   * @param name 插件名称
   */
  unuse(name: string): this {
    const index = this.plugins.findIndex((p) => p.name === name);
    if (index !== -1) {
      const plugin = this.plugins[index];
      plugin.destroy?.();
      this.plugins.splice(index, 1);
      console.log(`🗑️ 插件已移除: ${name}`);
    }
    return this;
  }

  /**
   * 获取插件
   * @param name 插件名称
   */
  getPlugin(name?: string): IUDPlugin<T> | IUDPlugin<T>[] | undefined {
    if (name) {
      return this.plugins.find((p) => p.name === name);
    }
    return [...this.plugins];
  }

  /**
   * 执行插件钩子
   * @param hook 钩子名称
   * @param args 参数
   */
  async runHook<K extends keyof IUDPlugin>(
    hook: K,
    ...args: any[]
  ): Promise<any[]> {
    const results: any[] = [];

    for (const plugin of this.plugins) {
      const handler = plugin[hook];
      if (handler && typeof handler === "function") {
        const result = await (handler as any).apply(plugin, args);
        results.push(result);
      }
    }

    return results;
  }
  /**
   * 计算全局上传速率(所有文件的聚合)
   * @returns 全局速率对象
   * @private
   */
  private calculateGlobalUploadSpeed(): speedInfo {
    let totalCurrentSpeed = 0;
    let transferTotaldBytes = 0;
    let totalFileSize = 0;
    let activeFileCount = 0;

    // 遍历所有正在上传的文件，累加速率和字节数
    this.files.forEach((file) => {
      if (isFileActive(file)) {
        activeFileCount++;

        // 累加文件大小（用于计算平均速度）
        totalFileSize += file.File?.size || file.size || 0;

        // 使用统一方法获取已上传字节数
        transferTotaldBytes += this.getFileBytes(file);
        // 如果文件有速度信息，累加瞬时速度
        if (file.speed) {
          totalCurrentSpeed += file.speed.currentSpeed;
        }
      } else if (file.status === "success") {
        // 已完成文件也计入总大小（用于计算整体平均速度）
        totalFileSize += file.File?.size || file.size || 0;
        transferTotaldBytes += file.File?.size || file.size || 0;
      }
    });

    // 计算全局平均速度：总已上传字节 / 总耗时
    let globalAverageSpeed = 0;
    if (transferTotaldBytes > 0 && activeFileCount > 0) {
      // 找到最早开始上传的文件的时间
      let earliestStartTime = Date.now();
      this.files.forEach((file) => {
        if (isFileActive(file) && file.transferTime.startTime > 0) {
          earliestStartTime = Math.min(
            earliestStartTime,
            file.transferTime.startTime,
          );
        }
      });

      const totalTime = (Date.now() - earliestStartTime) / 1000;
      if (totalTime > 0) {
        globalAverageSpeed = transferTotaldBytes / totalTime;
      }
    }

    // 更新全局已上传大小（使用 formatFileSize 格式化）
    this.transferredFormatSize = formatFileSize(transferTotaldBytes);

    // 计算全局预计剩余时间
    const remainingBytes = Math.max(0, totalFileSize - transferTotaldBytes);
    let estimatedTimeRemaining = -1;
    let estimatedTimeFormatted = "计算中...";

    if (globalAverageSpeed > 0 && remainingBytes > 0) {
      estimatedTimeRemaining = Math.ceil(remainingBytes / globalAverageSpeed);
      estimatedTimeFormatted = formatDuration(estimatedTimeRemaining * 1000);
    } else if (remainingBytes <= 0 && transferTotaldBytes > 0) {
      estimatedTimeRemaining = 0;
      estimatedTimeFormatted = "即将完成";
    }

    return {
      currentSpeed: totalCurrentSpeed,
      averageSpeed: globalAverageSpeed,
      currentSpeedFormatted: formatSpeed(totalCurrentSpeed),
      averageSpeedFormatted: formatSpeed(globalAverageSpeed),
      estimatedTimeRemaining,
      estimatedTimeFormatted,
    };
  }

  /**
   * 获取文件的已上传字节数（统一获取逻辑）
   * @param file 文件实例
   * @returns 已上传字节数
   * @private
   */
  private getFileBytes(file: T): number {
    return file.chunkManager
      ? file.chunkManager.totalChunkSize
      : file.__transferBytes__ || 0;
  }
}
