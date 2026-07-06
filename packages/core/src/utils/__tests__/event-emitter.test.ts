import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "../event-emitter";

describe("EventEmitter", () => {
  let emitter: EventEmitter;

  // 使用自定义事件名进行测试（不耦合具体类型定义）
  type TestEvents = {
    foo: (arg1: string) => void;
    bar: (n: number, s: string) => void;
    empty: () => void;
  };

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  // ==================== on + emit ====================
  describe("on / emit", () => {
    it("注册并触发事件", () => {
      const cb = vi.fn();
      (emitter as any).on("foo", cb);
      (emitter as any).emit("foo", "hello");
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith("hello");
    });

    it("支持多参数", () => {
      const cb = vi.fn();
      (emitter as any).on("bar", cb);
      (emitter as any).emit("bar", 42, "world");
      expect(cb).toHaveBeenCalledWith(42, "world");
    });

    it("同一事件注册多个回调", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      (emitter as any).on("foo", cb1);
      (emitter as any).on("foo", cb2);
      (emitter as any).emit("foo", "test");
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it("未注册事件 emit 返回 false", () => {
      const result = (emitter as any).emit("foo", "nobody");
      expect(result).toBe(false);
    });

    it("已注册事件 emit 返回 true", () => {
      (emitter as any).on("foo", vi.fn());
      const result = (emitter as any).emit("foo", "test");
      expect(result).toBe(true);
    });

    it("回调异常不影响其他回调", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const cbGood = vi.fn();
      (emitter as any).on("foo", () => {
        throw new Error("oops!");
      });
      (emitter as any).on("foo", cbGood);
      (emitter as any).emit("foo", "test");
      expect(cbGood).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("on 返回 this 支持链式调用", () => {
      const result = (emitter as any).on("foo", vi.fn());
      expect(result).toBe(emitter);
    });
  });

  // ==================== once ====================
  describe("once", () => {
    it("只执行一次后自动移除", () => {
      const cb = vi.fn();
      (emitter as any).once("foo", cb);
      (emitter as any).emit("foo", "a");
      (emitter as any).emit("foo", "b");
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith("a");
    });

    it("once 返回 this 支持链式调用", () => {
      const result = (emitter as any).once("foo", vi.fn());
      expect(result).toBe(emitter);
    });
  });

  // ==================== off ====================
  describe("off", () => {
    it("移除指定回调", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      (emitter as any).on("foo", cb1);
      (emitter as any).on("foo", cb2);
      (emitter as any).off("foo", cb1);
      (emitter as any).emit("foo", "test");
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it("不传 callback 时清空该事件所有回调", () => {
      const cb = vi.fn();
      (emitter as any).on("foo", cb);
      (emitter as any).off("foo");
      (emitter as any).emit("foo", "test");
      expect(cb).not.toHaveBeenCalled();
    });

    it("off 返回 this", () => {
      expect((emitter as any).off("foo")).toBe(emitter);
    });
  });

  // ==================== listenerCount ====================
  describe("listenerCount", () => {
    it("返回监听器数量", () => {
      expect((emitter as any).listenerCount("foo")).toBe(0);
      (emitter as any).on("foo", vi.fn());
      (emitter as any).on("foo", vi.fn());
      expect((emitter as any).listenerCount("foo")).toBe(2);
    });
  });

  // ==================== removeAllListeners ====================
  describe("removeAllListeners", () => {
    it("移除指定事件的所有监听器", () => {
      (emitter as any).on("foo", vi.fn());
      (emitter as any).on("bar", vi.fn());
      (emitter as any).removeAllListeners("foo");
      expect((emitter as any).listenerCount("foo")).toBe(0);
      expect((emitter as any).listenerCount("bar")).toBe(1);
    });

    it("不传参数移除所有事件的监听器", () => {
      (emitter as any).on("foo", vi.fn());
      (emitter as any).on("bar", vi.fn());
      (emitter as any).removeAllListeners();
      expect((emitter as any).listenerCount("foo")).toBe(0);
      expect((emitter as any).listenerCount("bar")).toBe(0);
    });

    it("返回 this", () => {
      expect((emitter as any).removeAllListeners()).toBe(emitter);
    });
  });

  // ==================== 边界情况 ====================
  describe("边界情况", () => {
    it("Object.create(null) 实例也能正常工作", () => {
      const obj = Object.create(EventEmitter.prototype);
      // ensureEvents 应该在首次调用时初始化 events Map
      (obj as any).on("foo", vi.fn());
      expect((obj as any).events).toBeDefined();
    });
  });
});
