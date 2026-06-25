// 压缩插件
export { CompressImagePlugin } from "./uploader/compress/compress-image-plugin";
export type { ImageCompressPluginOptions } from "./uploader/compress/compress-image-plugin";

// 水印插件
export { WatermarkPlugin } from "./uploader/watermark/watermark-plugin";
export type { WatermarkPluginOptions } from "./uploader/watermark/watermark-plugin";

// 验证插件
export { FileValidatorPlugin } from "./uploader/validator/file-validator-plugin";
export type { FileValidatorPluginOptions } from "./uploader/validator/file-validator-plugin";
export { ImageValidatorPlugin } from "./uploader/validator/image-validator-plugin";
export type { ImageValidatorOptions } from "./uploader/validator/image-validator-plugin";
export { VideoValidatorPlugin } from "./uploader/validator/video-validator-plugin";
export type { VideoValidatorOptions } from "./uploader/validator/video-validator-plugin";

// 智能重试插件（上传/下载通用）
export { SmartRetryPlugin } from "./retry/smart-retry-plugin";
export type { SmartRetryConfig } from "./retry/smart-retry-plugin";

export { BasePlugin } from "./base-plugin";
