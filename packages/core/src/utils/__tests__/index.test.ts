import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatFileSize,
  formatSpeed,
  formatDuration,
  generateFileId,
  mergeObjects,
  getFileExtension,
  isFileActive,
  isPlainObject,
  extractPathFromFunction,
  sleep,
  validator,
  computeTransferTime,
  // createReactiveFile is internal, tested indirectly
} from "../index";

// ==================== formatFileSize ====================
describe("formatFileSize", () => {
  it("返回 0 B 当 bytes 为 0", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("返回 0 B 当 bytes 为 null / undefined / NaN", () => {
    expect(formatFileSize(null)).toBe("0 B");
    expect(formatFileSize(undefined)).toBe("0 B");
    expect(formatFileSize(NaN)).toBe("0 B");
    expect(formatFileSize("abc")).toBe("0 B");
  });

  it("返回 0 B 当 bytes 为负数", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(formatFileSize(-100)).toBe("0 B");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("正确格式化 Bytes 级别", () => {
    expect(formatFileSize(512)).toBe("512.00 Bytes");
  });

  it("正确格式化 KB 级别", () => {
    expect(formatFileSize(1024)).toBe("1.00 KB");
    expect(formatFileSize(1536)).toBe("1.50 KB");
  });

  it("正确格式化 MB 级别", () => {
    expect(formatFileSize(1048576)).toBe("1.00 MB"); // 1024 * 1024
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatFileSize(20 * 1024 * 1024)).toBe("20.00 MB");
  });

  it("正确格式化 GB 级别", () => {
    expect(formatFileSize(1073741824)).toBe("1.00 GB"); // 1024^3
  });

  it("正确格式化 TB 级别", () => {
    expect(formatFileSize(1099511627776)).toBe("1.00 TB"); // 1024^4
  });

  it("支持自定义小数位数", () => {
    expect(formatFileSize(1024, 0)).toBe("1 KB");
    expect(formatFileSize(1536, 3)).toBe("1.500 KB");
  });
});

// ==================== formatSpeed ====================
describe("formatSpeed", () => {
  it("返回 0 B/s 当速度为 0", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
  });

  it("正确格式化 B/s", () => {
    expect(formatSpeed(500)).toBe("500.00 B/s");
  });

  it("正确格式化 KB/s", () => {
    expect(formatSpeed(1024)).toBe("1.00 KB/s");
  });

  it("正确格式化 MB/s", () => {
    expect(formatSpeed(1024 * 1024)).toBe("1.00 MB/s");
  });

  it("正确格式化 GB/s", () => {
    expect(formatSpeed(1024 * 1024 * 1024)).toBe("1.00 GB/s");
  });
});

// ==================== formatDuration ====================
describe("formatDuration", () => {
  it("返回 0s 当毫秒为 0", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("正确格式化秒数", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(59900)).toBe("59s");
  });

  it("正确格式化分钟+秒", () => {
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("正确格式化小时+分钟+秒", () => {
    expect(formatDuration(3665000)).toBe("1h 1m 5s");
    expect(formatDuration(7385000)).toBe("2h 3m 5s");
  });
});

// ==================== generateFileId ====================
describe("generateFileId", () => {
  it("返回以 file_ 开头的字符串", () => {
    const id = generateFileId();
    expect(id).toMatch(/^file_/);
  });

  it("连续调用生成不同的 ID", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateFileId()));
    expect(ids.size).toBe(100);
  });
});

// ==================== mergeObjects ====================
describe("mergeObjects", () => {
  it("合并两个对象", () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };
    const result = mergeObjects(target, source);
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("source 为 undefined 时返回 target 浅拷贝", () => {
    const target = { a: 1 };
    const result = mergeObjects(target);
    expect(result).toEqual({ a: 1 });
    expect(result).not.toBe(target); // 浅拷贝，不是同一个引用
  });

  it("source 为 null 时返回 target 浅拷贝", () => {
    const target = { a: 1 };
    const result = mergeObjects(target, null as any);
    expect(result).toEqual({ a: 1 });
  });

  it("target 为数组时抛出 TypeError", () => {
    expect(() => mergeObjects([] as any)).toThrow(TypeError);
  });

  it("source 为数组时抛出 TypeError", () => {
    expect(() => mergeObjects({ a: 1 }, [] as any)).toThrow(TypeError);
  });

  it("target 为 null 时抛出 TypeError", () => {
    expect(() => mergeObjects(null as any)).toThrow(TypeError);
  });
});

// ==================== getFileExtension ====================
describe("getFileExtension", () => {
  it("返回扩展名", () => {
    expect(getFileExtension("test.mp4")).toBe("mp4");
    expect(getFileExtension("image.PNG")).toBe("PNG");
    expect(getFileExtension(".gitignore")).toBe("gitignore");
  });

  it("无扩展名时返回空字符串", () => {
    expect(getFileExtension("Makefile")).toBe("");
    expect(getFileExtension(undefined)).toBe("");
  });

  it("多个点的文件名", () => {
    expect(getFileExtension("archive.tar.gz")).toBe("gz");
  });
});

// ==================== isFileActive ====================
describe("isFileActive", () => {
  it("活跃状态返回 true", () => {
    expect(isFileActive({ status: "UDLoading" } as any)).toBe(true);
    expect(isFileActive({ status: "paused" } as any)).toBe(true);
    expect(isFileActive({ status: "fail" } as any)).toBe(true);
    expect(isFileActive({ status: "merging" } as any)).toBe(true);
  });

  it("非活跃状态返回 false", () => {
    expect(isFileActive({ status: "pending" } as any)).toBe(false);
    expect(isFileActive({ status: "success" } as any)).toBe(false);
    expect(isFileActive({ status: "cancelled" } as any)).toBe(false);
    expect(isFileActive({ status: "error" } as any)).toBe(false);
  });
});

// ==================== isPlainObject ====================
describe("isPlainObject", () => {
  it("纯对象返回 true", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("null / 数组 / 基本类型返回 false", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(123)).toBe(false);
    expect(isPlainObject(new Date())).toBe(true); // new Date 的 typeof 是 object，非数组
  });
});

// ==================== extractPathFromFunction ====================
describe("extractPathFromFunction", () => {
  it("提取引号内的路径", () => {
    expect(extractPathFromFunction("fetch('/api/upload')")).toBe("/api/upload");
    expect(extractPathFromFunction('fetch("/api/download")')).toBe("/api/download");
    expect(extractPathFromFunction("fetch(`/api/data`)")).toBe("/api/data");
  });

  it("无匹配时返回 null", () => {
    expect(extractPathFromFunction("no path here")).toBeNull();
    expect(extractPathFromFunction("")).toBeNull();
  });
});

// ==================== sleep ====================
describe("sleep", () => {
  it("在指定时间后 resolve", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // 允许微小偏差
  });
});

// ==================== validator.size ====================
describe("validator.size", () => {
  it("文件大小未超过限制返回 true", () => {
    expect(validator.size(100, 200)).toBe(true);
  });

  it("文件大小等于限制返回 true", () => {
    expect(validator.size(200, 200)).toBe(true);
  });

  it("文件大小超过限制返回 false", () => {
    expect(validator.size(300, 200)).toBe(false);
  });
});

// ==================== validator.limit ====================
describe("validator.limit", () => {
  it("文件数量未超限返回 true", () => {
    expect(validator.limit(5, 3)).toBe(true);
  });

  it("文件数量等于或超过限制返回 false", () => {
    expect(validator.limit(5, 5)).toBe(false);
    expect(validator.limit(5, 6)).toBe(false);
  });
});

// ==================== validator.type ====================
describe("validator.type", () => {
  const makeFile = (fileName: string, type: string) =>
    ({ fileName, File: { type } } as any);

  it("通配符类型匹配", () => {
    expect(validator.type(["image/*"], makeFile("test.png", "image/png"))).toBe(true);
    expect(validator.type(["video/*"], makeFile("test.mp4", "video/mp4"))).toBe(true);
    expect(validator.type(["image/*"], makeFile("test.pdf", "application/pdf"))).toBe(
      false,
    );
  });

  it("扩展名匹配", () => {
    expect(validator.type([".jpg", ".png"], makeFile("photo.jpg", "image/jpeg"))).toBe(
      true,
    );
    expect(validator.type([".mp4"], makeFile("video.avi", "video/avi"))).toBe(false);
  });

  it("MIME 类型精确匹配", () => {
    expect(
      validator.type(["image/png"], makeFile("icon.png", "image/png")),
    ).toBe(true);
    expect(
      validator.type(["image/png"], makeFile("icon.jpg", "image/jpeg")),
    ).toBe(false);
  });

  it("空 accept 返回 true", () => {
    expect(validator.type([], makeFile("test.txt", "text/plain"))).toBe(true);
  });
});

// ==================== computeTransferTime ====================
describe("computeTransferTime", () => {
  let timeInfo: { startTime: number; endTime: number; duration: number; durationFormatted: string };

  beforeEach(() => {
    timeInfo = { startTime: 0, endTime: 0, duration: 0, durationFormatted: "" };
  });

  it("start() 设置起始时间和重置值", () => {
    computeTransferTime(timeInfo).start();
    expect(timeInfo.startTime).toBeGreaterThan(0);
    expect(timeInfo.endTime).toBe(0);
    expect(timeInfo.duration).toBe(0);
  });

  it("end() 计算耗时和格式化", () => {
    computeTransferTime(timeInfo).start();
    timeInfo.startTime = Date.now() - 5000; // 模拟 5 秒前开始
    computeTransferTime(timeInfo).end();
    expect(timeInfo.duration).toBeGreaterThanOrEqual(4000);
    expect(timeInfo.durationFormatted).toMatch(/\ds/);
  });
});
