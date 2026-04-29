// 压缩插件
export { CompressImagePlugin } from "./compress/compress-image-plugin";
export type { ImageCompressPluginOptions } from "./compress/compress-image-plugin";

// 水印插件
export { WatermarkPlugin } from "./watermark/watermark-plugin";
export type { WatermarkPluginOptions } from "./watermark/watermark-plugin";

// 验证插件
export { FileValidatorPlugin } from "./validator/file-validator-plugin";
export type { FileValidatorPluginOptions } from "./validator/file-validator-plugin";
export { ImageValidatorPlugin } from "./validator/image-validator-plugin";
export type { ImageValidatorOptions } from "./validator/image-validator-plugin";
export { VideoValidatorPlugin } from "./validator/video-validator-plugin";
export type { VideoValidatorOptions } from "./validator/video-validator-plugin";

// 智能重试插件
export { SmartRetryPlugin } from "./retry/smart-retry-plugin";
export type { SmartRetryConfig } from "./retry/smart-retry-plugin";

export {BasePlugin} from './base-plugin'
