import { IUploaderPlugin, PluginContext } from "@file-ud.js/core/types";
import { UploadFile } from "@file-ud.js/core";

/**
 * 智能重试策略配置
 */
export interface SmartRetryConfig {
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 重试策略：fixed(固定延迟) | exponential(指数退避) | linear(线性增长) */
  strategy?: "fixed" | "exponential" | "linear";
  /** 初始延迟时间（毫秒，默认 1000） */
  initialDelay?: number;
  /** 最大延迟时间（毫秒，默认 30000） */
  maxDelay?: number;
  /** 仅对特定错误码重试（空数组表示对所有错误重试） */
  retryableErrors?: string[];
  /** 是否显示重试提示（默认 true） */
  showRetryNotification?: boolean;
}

/**
 * 智能重试插件
 * 
 * 功能特性：
 * - 支持多种重试策略（固定延迟、指数退避、线性增长）
 * - 可配置重试次数和延迟时间
 * - 自动过滤可重试的错误类型
 * - 提供重试进度通知
 * 
 * @example
 * ```typescript
 * import { SmartRetryPlugin } from '@file-ud.js/plugins';
 * 
 * const uploader = FileUD.createUploader("test", {
 *   // ... 其他配置
 * });
 * 
 * // 使用指数退避策略，最多重试 5 次
 * uploader.use(new SmartRetryPlugin({
 *   maxRetries: 5,
 *   strategy: "exponential",
 *   initialDelay: 1000,
 *   maxDelay: 30000,
 * }));
 * ```
 */
export class SmartRetryPlugin implements IUploaderPlugin {
  name = "SmartRetryPlugin";
  version = "1.0.0";
  desc = "智能重试策略插件，支持指数退避、线性增长等多种重试策略";
  priority = 10; // 较高优先级，在其他插件之前执行

  private config: Required<SmartRetryConfig>;
  private retryCountMap = new Map<string, number>(); // 文件ID -> 重试次数
  private retryTimerMap = new Map<string, ReturnType<typeof setTimeout>>(); // 文件ID -> 重试定时器

  constructor(config: SmartRetryConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      strategy: config.strategy ?? "exponential",
      initialDelay: config.initialDelay ?? 1000,
      maxDelay: config.maxDelay ?? 30000,
      retryableErrors: config.retryableErrors ?? [],
      showRetryNotification: config.showRetryNotification ?? true,
    };
  }

  /**
   * 插件初始化
   */
  install(uploader: any, options?: any): void {
    console.log(`✅ [${this.name}] 插件已安装`, this.config);
  }

  /**
   * 上传失败时触发
   */
  onError(error: Error, file: UploadFile, context: PluginContext): void {
    const fileId = file.fileId;
    const currentRetries = this.retryCountMap.get(fileId) || 0;

    // 检查是否超过最大重试次数
    if (currentRetries >= this.config.maxRetries) {
      console.warn(
        `[${this.name}] 文件 ${file.fileName} 已达到最大重试次数 (${this.config.maxRetries})，停止重试`
      );
      this.cleanup(fileId);
      return;
    }

    // 检查是否为可重试的错误
    if (!this.isRetryableError(error)) {
      console.log(
        `[${this.name}] 文件 ${file.fileName} 的错误不可重试，跳过重试`
      );
      return;
    }

    // 计算延迟时间
    const delay = this.calculateDelay(currentRetries);

    // 设置重试定时器
    const timer = setTimeout(() => {
      console.log(
        `[${this.name}] 文件 ${file.fileName} 第 ${currentRetries + 1}/${this.config.maxRetries} 次重试（延迟 ${delay}ms）`
      );

      // 更新重试计数
      this.retryCountMap.set(fileId, currentRetries + 1);

      // 触发重试
      file.retry();

      // 清除定时器引用
      this.retryTimerMap.delete(fileId);
    }, delay);

    this.retryTimerMap.set(fileId, timer);

    // 显示重试通知
    if (this.config.showRetryNotification) {
      console.info(
        `[${this.name}] ⏳ 文件 ${file.fileName} 将在 ${delay}ms 后自动重试...`
      );
    }
  }

  /**
   * 上传成功时清理重试状态
   */
  onSuccess(response: any, file: UploadFile, context: PluginContext): void {
    this.cleanup(file.fileId);
  }

  /**
   * 文件移除时清理重试状态
   */
  destroy(): void {
    // 清除所有待执行的重试定时器
    this.retryTimerMap.forEach((timer) => clearTimeout(timer));
    this.retryTimerMap.clear();
    this.retryCountMap.clear();
    console.log(`🗑️ [${this.name}] 插件已销毁`);
  }

  /**
   * 判断错误是否可重试
   */
  private isRetryableError(error: any): boolean {
    // 如果没有配置可重试错误列表，则对所有错误重试
    if (this.config.retryableErrors.length === 0) {
      return true;
    }

    // 检查错误码是否在可重试列表中
    const errorCode = error.code || error.message || "";
    return this.config.retryableErrors.some((code) =>
      errorCode.includes(code)
    );
  }

  /**
   * 计算延迟时间
   */
  private calculateDelay(retryCount: number): number {
    const { strategy, initialDelay, maxDelay } = this.config;

    let delay: number;

    switch (strategy) {
      case "fixed":
        // 固定延迟
        delay = initialDelay;
        break;

      case "linear":
        // 线性增长：delay = initialDelay * (retryCount + 1)
        delay = initialDelay * (retryCount + 1);
        break;

      case "exponential":
      default:
        // 指数退避：delay = initialDelay * 2^retryCount
        delay = initialDelay * Math.pow(2, retryCount);
        break;
    }

    // 限制最大延迟时间
    return Math.min(delay, maxDelay);
  }

  /**
   * 清理文件的重试状态
   */
  private cleanup(fileId: string): void {
    // 清除待执行的定时器
    const timer = this.retryTimerMap.get(fileId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimerMap.delete(fileId);
    }

    // 清除重试计数
    this.retryCountMap.delete(fileId);
  }
}
