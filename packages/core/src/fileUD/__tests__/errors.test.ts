import { describe, it, expect, vi } from "vitest";

// errors.ts 顶部 import Uploader 会触发全量依赖链 → 循环引用
// TransferFile extends 失败。mock 掉 Uploader 打破链条。
vi.mock("../../uploader", () => ({
  default: {
    uploadFile: null,
    onError: null,
    emit: vi.fn(),
  },
}));

import { FileUDError, ErrorCode, ErrorLevel } from "../errors";

describe("FileUDError", () => {
  // ==================== 构造 ====================
  describe("构造", () => {
    it("基本构造", () => {
      const err = new FileUDError(ErrorCode.NETWORK, "网络连接失败");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("FileUDError");
      expect(err.code).toBe(ErrorCode.NETWORK);
      expect(err.message).toBe("网络连接失败");
      expect(err.level).toBe(ErrorLevel.ERROR);
    });

    it("包含上下文信息", () => {
      const err = new FileUDError(ErrorCode.FILE_TOO_LARGE, "文件过大", {
        fileName: "video.mp4",
        fileSize: 2147483648,
      });
      expect(err.context.fileName).toBe("video.mp4");
      expect(err.context.fileSize).toBe(2147483648);
      expect(err.context.timestamp).toBeGreaterThan(0);
    });

    it("包含错误选项", () => {
      const err = new FileUDError(ErrorCode.UPLOAD_FAILED, "上传失败", {}, {
        retryable: true,
        recoverable: false,
      });
      expect(err.options.retryable).toBe(true);
      expect(err.options.recoverable).toBe(false);
      // 默认值
      expect(err.options.userVisible).toBe(true);
    });

    it("包含原始错误 (cause)", () => {
      const cause = new Error("底层网络错误");
      const err = new FileUDError(ErrorCode.NETWORK, "网络错误", {}, {}, cause);
      expect(err.cause).toBe(cause);
    });
  });

  // ==================== determineLevel ====================
  describe("错误级别自动判定", () => {
    it("通用错误 (1000-1999) → ERROR", () => {
      expect(new FileUDError(ErrorCode.UNKNOWN, "").level).toBe(ErrorLevel.ERROR);
      expect(new FileUDError(ErrorCode.TIMEOUT, "").level).toBe(ErrorLevel.ERROR);
    });

    it("文件验证错误 (2000-2999) → WARNING", () => {
      expect(new FileUDError(ErrorCode.FILE_TOO_LARGE, "").level).toBe(ErrorLevel.WARNING);
      expect(new FileUDError(ErrorCode.INVALID_TYPE, "").level).toBe(ErrorLevel.WARNING);
    });

    it("上传/下载错误 (3000-4999) → ERROR", () => {
      expect(new FileUDError(ErrorCode.UPLOAD_FAILED, "").level).toBe(ErrorLevel.ERROR);
      expect(new FileUDError(ErrorCode.CHUNK_UPLOAD_FAILED, "").level).toBe(ErrorLevel.ERROR);
    });

    it("插件错误 (5000+) → CRITICAL", () => {
      expect(new FileUDError(ErrorCode.PLUGIN_ERROR, "").level).toBe(ErrorLevel.CRITICAL);
    });
  });

  // ==================== getChineseDescription ====================
  describe("getChineseDescription", () => {
    it("返回中文描述", () => {
      const err = new FileUDError(ErrorCode.NETWORK, "");
      expect(err.getChineseDescription()).toBe("网络错误");
    });

    it("传入其他错误码返回对应描述", () => {
      const err = new FileUDError(ErrorCode.UNKNOWN, "");
      expect(err.getChineseDescription(ErrorCode.FILE_TOO_LARGE)).toBe("文件过大");
    });

    it("未知错误码返回 '未知错误'", () => {
      const err = new FileUDError(9999 as any, "");
      expect(err.getChineseDescription()).toBe("未知错误");
    });
  });

  // ==================== setContext ====================
  describe("setContext", () => {
    it("设置上下文并返回 this", () => {
      const err = new FileUDError(ErrorCode.UNKNOWN, "");
      const result = err.setContext({ chunkIndex: 3 });
      expect(result).toBe(err);
      expect(err.context.chunkIndex).toBe(3);
    });
  });

  // ==================== setCode ====================
  describe("setCode", () => {
    it("更新错误码和级别", () => {
      const err = new FileUDError(ErrorCode.UNKNOWN, "");
      err.setCode(ErrorCode.FILE_LIMIT_EXCEEDED);
      expect(err.code).toBe(ErrorCode.FILE_LIMIT_EXCEEDED);
      expect(err.level).toBe(ErrorLevel.WARNING); // 2000+ → WARNING
    });
  });

  // ==================== setOptions ====================
  describe("setOptions", () => {
    it("更新错误选项", () => {
      const err = new FileUDError(ErrorCode.UNKNOWN, "");
      err.setOptions({ retryable: true });
      expect(err.options.retryable).toBe(true);
    });
  });

  // ==================== toJSON ====================
  describe("toJSON", () => {
    it("序列化为 JSON", () => {
      const err = new FileUDError(ErrorCode.NETWORK, "网络错误", { fileName: "a.mp4" });
      const json = err.toJSON() as any;
      expect(json.name).toBe("FileUDError");
      expect(json.code).toBe(ErrorCode.NETWORK);
      expect(json.level).toBe(ErrorLevel.ERROR);
      expect(json.message).toBe("网络错误");
      expect(json.context.fileName).toBe("a.mp4");
      expect(json.options.recoverable).toBe(true);
    });
  });
});

// ==================== ErrorCode 枚举值不冲突 ====================
describe("ErrorCode", () => {
  it("所有枚举值唯一", () => {
    const values = Object.values(ErrorCode).filter((v) => typeof v === "number");
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("通用错误范围 1000-1999", () => {
    const general = [
      ErrorCode.UNKNOWN,
      ErrorCode.ABORTED,
      ErrorCode.TIMEOUT,
      ErrorCode.NETWORK,
    ];
    general.forEach((code) => {
      expect(code).toBeGreaterThanOrEqual(1000);
      expect(code).toBeLessThan(2000);
    });
  });
});

// ==================== ErrorLevel 枚举 ====================
describe("ErrorLevel", () => {
  it("包含所有级别", () => {
    expect(ErrorLevel.INFO).toBe("info");
    expect(ErrorLevel.WARNING).toBe("warn");
    expect(ErrorLevel.ERROR).toBe("error");
    expect(ErrorLevel.CRITICAL).toBe("critical");
  });
});
