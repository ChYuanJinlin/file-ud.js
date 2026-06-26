import { EventCallback, EventName } from "../types";

export class EventEmitter {
  events?: Map<EventName, Set<Function>>;

  /** 确保 events Map 已初始化（兼容 Object.create 不执行字段初始化器） */
  private ensureEvents(): Map<EventName, Set<Function>> {
    if (!this.events) {
      this.events = new Map<EventName, Set<Function>>();
    }
    return this.events;
  }

  //   订阅事件
  on<K extends EventName>(eventName: K, callback: EventCallback<K>): this {
    const events = this.ensureEvents();
    if (!events.has(eventName)) {
      events.set(eventName, new Set());
    }
    events.get(eventName)!.add(callback);
    return this;
  }
  // 发布事件
  emit<K extends EventName>(
    eventName: K,
    ...args: Parameters<EventCallback<K>>
  ) {
    const events = this.ensureEvents();
    const callbacks = events.get(eventName);
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
    const events = this.ensureEvents();
    const callbacks = events.get(eventName);
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
    const events = this.ensureEvents();
    return events.get(eventName)?.size || 0;
  }

  // 移除所有事件监听器
  removeAllListeners(eventName?: EventName): this {
    const events = this.ensureEvents();
    if (eventName) {
      events.delete(eventName);
    } else {
      events.clear();
    }
    return this;
  }
}
