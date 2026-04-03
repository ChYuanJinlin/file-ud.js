import { EventCallback, EventName } from "../types";

export class EventEmitter  {
  events = new Map<EventName, Set<Function>>();

  //   订阅事件
  on<K extends EventName>(eventName: K, callback: EventCallback<K>): this {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }
    this.events.get(eventName)!.add(callback);
    return this;
  }
  // 发布事件
  emit<K extends EventName>(
    eventName: K,
    ...args: Parameters<EventCallback<K>>
  ) {
    const callbacks = this.events.get(eventName);
    if (!callbacks || callbacks.size === 0) {
      return false;
    }

    callbacks.forEach((callback) => {
      try {
        callback.call(this, ...args);
      } catch (error) {
        console.error(`Error in event listener for "${eventName}":`, error);
      }
    });

    return true;
  }

  // 只执行一次
  once<K extends EventName>(eventName: K, callback: EventCallback<K>): this {
    const onceWrapper = ((...args: any[]) => {
      (callback as any)(...args);
      this.off(eventName, onceWrapper as any);
    }) as any as EventCallback<K>;

    return this.on(eventName, onceWrapper);
  }

  // 移除事件监听器
  off<K extends EventName>(eventName: K, callback?: EventCallback<K>): this {
    const callbacks = this.events.get(eventName);
    if (callbacks) {
      if (callback) {
        callbacks.delete(callback);
      } else {
        callbacks.clear();
      }
    }
    return this;
  }

  // 获取事件监听器数量
  listenerCount(eventName: EventName): number {
    return this.events.get(eventName)?.size || 0;
  }

  // 移除所有事件监听器
  removeAllListeners(eventName?: EventName): this {
    if (eventName) {
      this.events.delete(eventName);
    } else {
      this.events.clear();
    }
    return this;
  }
}
