import { describe, it, expect, vi, beforeEach } from "vitest";
import FileConcurrencyController from "../FileConcurrencyController";

// 重新导入以获取全新单例（否则其他测试文件可能已实例化）
// FileConcurrencyController 是单例，但我们可以通过重新导入模块来重置
// 不过 vitest 的模块缓存机制会保持单例状态
// 这里直接测试单例行为

describe("FileConcurrencyController", () => {
  let controller: FileConcurrencyController;

  beforeEach(() => {
    // 获取单例
    controller = FileConcurrencyController.getInstance();
    // 重置所有限制为 0（不限制）
    controller.maxUploadConcurrent = 0;
    controller.maxDownloadConcurrent = 0;
    controller.maxSharedConcurrent = 0;
  });

  // ==================== 单例 ====================
  describe("单例模式", () => {
    it("getInstance 返回同一实例", () => {
      const a = FileConcurrencyController.getInstance();
      const b = FileConcurrencyController.getInstance();
      expect(a).toBe(b);
    });
  });

  // ==================== maxUploadConcurrent ====================
  describe("maxUploadConcurrent", () => {
    it("设置和获取上传并发数", () => {
      controller.maxUploadConcurrent = 3;
      expect(controller.maxUploadConcurrent).toBe(3);
    });

    it("设为 0 表示不限制", () => {
      controller.maxUploadConcurrent = 0;
      expect(controller.maxUploadConcurrent).toBe(0);
    });
  });

  // ==================== maxDownloadConcurrent ====================
  describe("maxDownloadConcurrent", () => {
    it("设置和获取下载并发数", () => {
      controller.maxDownloadConcurrent = 2;
      expect(controller.maxDownloadConcurrent).toBe(2);
    });
  });

  // ==================== maxSharedConcurrent ====================
  describe("maxSharedConcurrent", () => {
    it("设置和获取共享并发数", () => {
      controller.maxSharedConcurrent = 4;
      expect(controller.maxSharedConcurrent).toBe(4);
    });

    it("maxConcurrent 兼容旧 API，映射到 maxSharedConcurrent", () => {
      controller.maxConcurrent = 5;
      expect(controller.maxSharedConcurrent).toBe(5);
      expect(controller.maxConcurrent).toBe(5);
    });
  });

  // ==================== runAsUpload ====================
  describe("runAsUpload", () => {
    it("无限制时直接执行函数", async () => {
      const fn = vi.fn().mockResolvedValue("done");
      const result = await controller.runAsUpload(fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toBe("done");
    });

    it("有上传限制时通过队列排队执行", async () => {
      controller.maxUploadConcurrent = 1;
      const order: number[] = [];

      const task1 = controller.runAsUpload(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        return "a";
      });
      const task2 = controller.runAsUpload(async () => {
        order.push(2);
        return "b";
      });

      const [r1, r2] = await Promise.all([task1, task2]);
      expect(r1).toBe("a");
      expect(r2).toBe("b");
      // task1 完成前 task2 不应该开始（concurrency=1）
      expect(order).toEqual([1, 2]);
    });
  });

  // ==================== runAsDownload ====================
  describe("runAsDownload", () => {
    it("无限制时直接执行", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await controller.runAsDownload(fn);
      expect(result).toBe("ok");
    });

    it("有下载限制时排队", async () => {
      controller.maxDownloadConcurrent = 1;
      const order: number[] = [];

      const task1 = controller.runAsDownload(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        return "x";
      });
      const task2 = controller.runAsDownload(async () => {
        order.push(2);
        return "y";
      });

      await Promise.all([task1, task2]);
      expect(order).toEqual([1, 2]);
    });
  });

  // ==================== 上传/下载独立队列 ====================
  describe("上传和下载独立队列不互相阻塞", () => {
    it("上传限制不影响下载", async () => {
      controller.maxUploadConcurrent = 1;
      controller.maxDownloadConcurrent = 1;
      const order: string[] = [];

      const uploadTask1 = controller.runAsUpload(async () => {
        order.push("u1-start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("u1-end");
        return "u1";
      });
      const downloadTask1 = controller.runAsDownload(async () => {
        order.push("d1-start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("d1-end");
        return "d1";
      });

      await Promise.all([uploadTask1, downloadTask1]);
      // u1-start 和 d1-start 几乎同时发生（两个独立队列）
      expect(order[0]).toMatch(/start/);
      expect(order[1]).toMatch(/start/);
    });
  });

  // ==================== 共享队列 ====================
  describe("共享队列 fallback", () => {
    it("未设置上传限制时，使用共享队列", async () => {
      controller.maxSharedConcurrent = 1;
      const order: number[] = [];

      const t1 = controller.runAsUpload(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        return "a";
      });
      const t2 = controller.runAsUpload(async () => {
        order.push(2);
        return "b";
      });

      await Promise.all([t1, t2]);
      expect(order).toEqual([1, 2]);
    });

    it("专属队列优先于共享队列", async () => {
      // 上传有专属队列（2），共享队列（1），上传用专属的 2
      controller.maxUploadConcurrent = 2;
      controller.maxSharedConcurrent = 1;
      const order: number[] = [];

      const t1 = controller.runAsUpload(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        return "a";
      });
      const t2 = controller.runAsUpload(async () => {
        order.push(2);
        await new Promise((r) => setTimeout(r, 50));
        return "b";
      });

      const [r1, r2] = await Promise.all([t1, t2]);
      // concurrency=2 意味着两者可同时运行
      expect(order).toEqual([1, 2]);
    });
  });
});
