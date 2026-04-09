# 上传成功率监控使用指南

## 📖 概述

上传监控模块提供实时的上传成功率、耗时统计、错误分析等监控功能，帮助你了解系统的上传性能和稳定性。

## 🚀 快速开始

### 1. 基本用法

```typescript
import { uploadMonitor } from '@core/utils';

// 获取实时统计数据
const stats = uploadMonitor.getStats();
console.log('上传成功率:', stats.successRate + '%');
console.log('平均耗时:', stats.averageDuration + 'ms');

// 打印完整报告
uploadMonitor.printReport();
```

### 2. 自动监控

监控模块会自动通过日志收集器监听上传过程，无需手动调用任何方法。所有上传事件会被自动记录和分析。

---

## 📊 核心 API

### **1. getStats()** - 获取统计数据

```typescript
interface UploadStats {
  // 基础统计
  totalUploads: number;           // 总上传数
  successfulUploads: number;      // 成功上传数
  failedUploads: number;          // 失败上传数
  successRate: number;            // 成功率（0-100）
  
  // 耗时统计
  averageDuration: number;        // 平均耗时（毫秒）
  minDuration: number;            // 最短耗时（毫秒）
  maxDuration: number;            // 最长耗时（毫秒）
  medianDuration: number;         // 中位数耗时（毫秒）
  
  // 文件大小统计
  averageFileSize: number;        // 平均文件大小（字节）
  totalBytesUploaded: number;     // 总上传数据量（字节）
  averageSpeed: number;           // 平均上传速度（字节/秒）
  
  // 错误分析
  errorsByType: Map<string, number>;      // 按错误类型统计
  errorsByModule: Map<string, number>;    // 按模块统计错误
  
  // 重试统计
  averageRetries: number;         // 平均重试次数
  
  // 分片上传统计（仅分片上传）
  chunkUploadStats?: {
    totalChunks: number;          // 总分片数
    successfulChunks: number;     // 成功分片数
    failedChunks: number;         // 失败分片数
    chunkSuccessRate: number;     // 分片成功率
  };
}

// 使用示例
const stats = uploadMonitor.getStats();
console.log(`成功率: ${stats.successRate}%`);
console.log(`平均耗时: ${stats.averageDuration}ms`);
console.log(`分片成功率: ${stats.chunkUploadStats?.chunkSuccessRate}%`);
```

---

### **2. printReport()** - 打印控制台报告

```typescript
// 在浏览器控制台查看格式化报告
uploadMonitor.printReport();
```

**输出示例**：
```
📊 上传性能监控报告
  总上传数: 150
  成功上传: 142
  失败上传: 8
  成功率: 94.67%
  平均耗时: 3245ms
  最短耗时: 1200ms
  最长耗时: 8900ms
  中位数耗时: 2800ms
  平均文件大小: 5242880 bytes
  总上传数据量: 744488960 bytes
  平均上传速度: 1621440 bytes/s
  平均重试次数: 0.53
  
  分片上传统计
    总分片数: 1500
    成功分片: 1450
    失败分片: 50
    分片成功率: 96.67%
  
  错误类型分布
    NETWORK_ERROR: 5
    SERVER_ERROR: 2
    CHUNK_ERROR: 1
```

---

### **3. getRecentRecords()** - 获取最近记录

```typescript
// 获取最近 10 条上传记录
const recentRecords = uploadMonitor.getRecentRecords(10);

recentRecords.forEach(record => {
  console.log({
    fileName: record.fileName,
    duration: record.endTime! - record.startTime,
    success: record.success,
    retries: record.retryCount,
  });
});
```

**UploadRecord 结构**：
```typescript
interface UploadRecord {
  fileId: string;              // 文件唯一标识
  fileName: string;            // 文件名
  fileSize: number;            // 文件大小（字节）
  startTime: number;           // 开始时间戳
  endTime?: number;            // 结束时间戳
  success: boolean;            // 是否成功
  error?: string;              // 失败原因
  retryCount: number;          // 重试次数
  totalChunks?: number;        // 分片总数
  uploadedChunks?: number;     // 成功分片数
  failedChunks?: number;       // 失败分片数
}
```

---

### **4. getActiveUploads()** - 获取活跃任务

```typescript
// 获取当前正在上传的文件
const activeUploads = uploadMonitor.getActiveUploads();

activeUploads.forEach((record, fileId) => {
  const duration = Date.now() - record.startTime;
  console.log(`${record.fileName} 已上传 ${duration}ms`);
});
```

---

### **5. reset()** - 重置统计数据

```typescript
// 清空所有统计数据（例如：切换用户时）
uploadMonitor.reset();
```

---

### **6. exportToJSON()** - 导出为 JSON

```typescript
// 导出统计数据
const jsonData = uploadMonitor.exportToJSON();

// 保存到文件
const blob = new Blob([jsonData], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `upload-stats-${Date.now()}.json`;
a.click();
URL.revokeObjectURL(url);
```

---

## 🎯 常见场景

### **1. 实时监控面板**

```vue
<!-- Vue 组件示例 -->
<template>
  <div class="upload-monitor">
    <h3>上传监控</h3>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">成功率</div>
        <div class="value">{{ stats.successRate }}%</div>
      </div>
      
      <div class="stat-card">
        <div class="label">平均耗时</div>
        <div class="value">{{ stats.averageDuration }}ms</div>
      </div>
      
      <div class="stat-card">
        <div class="label">总上传数</div>
        <div class="value">{{ stats.totalUploads }}</div>
      </div>
      
      <div class="stat-card">
        <div class="label">活跃任务</div>
        <div class="value">{{ activeCount }}</div>
      </div>
    </div>
    
    <button @click="refresh">刷新</button>
    <button @click="exportData">导出数据</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { uploadMonitor, UploadStats } from '@core/utils';

const stats = ref<UploadStats>(uploadMonitor.getStats());
const activeCount = ref(0);

let timer: NodeJS.Timeout;

onMounted(() => {
  // 每秒更新一次
  timer = setInterval(() => {
    stats.value = uploadMonitor.getStats();
    activeCount.value = uploadMonitor.getActiveUploads().size;
  }, 1000);
});

onUnmounted(() => {
  clearInterval(timer);
});

function refresh() {
  stats.value = uploadMonitor.getStats();
}

function exportData() {
  const json = uploadMonitor.exportToJSON();
  // 下载逻辑...
}
</script>
```

---

### **2. 错误告警**

```typescript
import { uploadMonitor } from '@core/utils';

// 定期检查成功率
setInterval(() => {
  const stats = uploadMonitor.getStats();
  
  // 如果成功率低于 90%，发出告警
  if (stats.totalUploads > 10 && stats.successRate < 90) {
    sendAlert({
      type: 'LOW_SUCCESS_RATE',
      message: `上传成功率降至 ${stats.successRate}%`,
      stats: stats,
    });
  }
  
  // 如果平均耗时超过阈值
  if (stats.averageDuration > 10000) {
    sendAlert({
      type: 'HIGH_LATENCY',
      message: `平均上传耗时 ${stats.averageDuration}ms 超过阈值`,
    });
  }
}, 60000); // 每分钟检查
```

---

### **3. 性能优化建议**

```typescript
import { uploadMonitor } from '@core/utils';

// 分析慢上传
function analyzeSlowUploads() {
  const stats = uploadMonitor.getStats();
  const records = uploadMonitor.getRecentRecords(100);
  
  // 找出耗时超过平均值的 2 倍的上传
  const threshold = stats.averageDuration * 2;
  const slowUploads = records.filter(r => 
    r.endTime && (r.endTime - r.startTime) > threshold
  );
  
  console.log(`发现 ${slowUploads.length} 个慢上传`);
  
  // 分析共同特征
  const largeFiles = slowUploads.filter(r => r.fileSize > 10 * 1024 * 1024);
  console.log(`大文件 (>10MB): ${largeFiles.length}`);
  
  const highRetries = slowUploads.filter(r => r.retryCount > 3);
  console.log(`高重试次数 (>3): ${highRetries.length}`);
  
  return {
    slowUploads,
    largeFiles,
    highRetries,
  };
}
```

---

### **4. 分片上传质量分析**

```typescript
import { uploadMonitor } from '@core/utils';

function analyzeChunkUploadQuality() {
  const stats = uploadMonitor.getStats();
  
  if (!stats.chunkUploadStats) {
    console.log('没有分片上传数据');
    return;
  }
  
  const { totalChunks, successfulChunks, failedChunks, chunkSuccessRate } = stats.chunkUploadStats;
  
  console.log('分片上传质量报告:');
  console.log(`- 总分片数: ${totalChunks}`);
  console.log(`- 成功分片: ${successfulChunks}`);
  console.log(`- 失败分片: ${failedChunks}`);
  console.log(`- 分片成功率: ${chunkSuccessRate}%`);
  
  // 如果分片成功率低于 95%，可能需要调整并发数或重试策略
  if (chunkSuccessRate < 95) {
    console.warn('⚠️ 分片成功率较低，建议:');
    console.warn('  1. 降低并发上传数');
    console.warn('  2. 增加重试次数');
    console.warn('  3. 检查网络稳定性');
  }
}
```

---

### **5. 上报到后端**

```typescript
import { uploadMonitor } from '@core/utils';

async function reportStatsToBackend() {
  const stats = uploadMonitor.getStats();
  
  // 转换 Map 为普通对象
  const payload = {
    ...stats,
    errorsByType: Object.fromEntries(stats.errorsByType),
    errorsByModule: Object.fromEntries(stats.errorsByModule),
    timestamp: Date.now(),
  };
  
  try {
    await fetch('/api/upload-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    console.log('✅ 统计数据已上报');
  } catch (error) {
    console.error('❌ 统计数据上报失败:', error);
  }
}

// 每小时上报一次
setInterval(reportStatsToBackend, 60 * 60 * 1000);
```

---

## 🔧 高级用法

### **1. 自定义监控指标**

```typescript
import { uploadMonitor } from '@core/utils';

class CustomMonitor {
  private monitor = uploadMonitor;
  
  /**
   * 计算 P95 耗时
   */
  getP95Duration(): number {
    const records = this.monitor.getRecentRecords(100);
    const durations = records
      .filter(r => r.endTime)
      .map(r => r.endTime! - r.startTime)
      .sort((a, b) => a - b);
    
    if (durations.length === 0) return 0;
    
    const p95Index = Math.floor(durations.length * 0.95);
    return durations[p95Index];
  }
  
  /**
   * 计算特定文件类型的成功率
   */
  getSuccessRateByType(fileType: string): number {
    const records = this.monitor.getRecentRecords(200);
    const filtered = records.filter(r => 
      r.fileName.toLowerCase().endsWith(fileType)
    );
    
    if (filtered.length === 0) return 0;
    
    const successful = filtered.filter(r => r.success).length;
    return Math.round((successful / filtered.length) * 10000) / 100;
  }
  
  /**
   * 获取最耗时的文件类型
   */
  getSlowestFileType(): { type: string; avgDuration: number } {
    const records = this.monitor.getRecentRecords(100);
    const typeStats = new Map<string, { total: number; count: number }>();
    
    records.forEach(record => {
      if (!record.endTime) return;
      
      const ext = record.fileName.split('.').pop()?.toLowerCase() || 'unknown';
      const duration = record.endTime - record.startTime;
      
      const existing = typeStats.get(ext) || { total: 0, count: 0 };
      existing.total += duration;
      existing.count++;
      typeStats.set(ext, existing);
    });
    
    let slowestType = 'unknown';
    let maxAvgDuration = 0;
    
    typeStats.forEach((stats, type) => {
      const avg = stats.total / stats.count;
      if (avg > maxAvgDuration) {
        maxAvgDuration = avg;
        slowestType = type;
      }
    });
    
    return { type: slowestType, avgDuration: maxAvgDuration };
  }
}

const customMonitor = new CustomMonitor();
console.log('P95 耗时:', customMonitor.getP95Duration());
console.log('PDF 成功率:', customMonitor.getSuccessRateByType('.pdf'));
console.log('最慢类型:', customMonitor.getSlowestFileType());
```

---

### **2. 与 Sentry 集成**

```typescript
import * as Sentry from '@sentry/browser';
import { uploadMonitor } from '@core/utils';

// 定期上报统计数据到 Sentry
setInterval(() => {
  const stats = uploadMonitor.getStats();
  
  Sentry.setContext('upload_stats', {
    success_rate: stats.successRate,
    average_duration: stats.averageDuration,
    total_uploads: stats.totalUploads,
    failed_uploads: stats.failedUploads,
    chunk_success_rate: stats.chunkUploadStats?.chunkSuccessRate,
  });
}, 60000);
```

---

### **3. 生成可视化图表**

```typescript
import { uploadMonitor } from '@core/utils';
import Chart from 'chart.js/auto';

function createSuccessRateChart(canvasId: string) {
  const records = uploadMonitor.getRecentRecords(50);
  
  // 按时间分组统计成功率
  const timeGroups: { [key: string]: { total: number; success: number } } = {};
  
  records.forEach(record => {
    const hour = new Date(record.startTime).getHours();
    const key = `${hour}:00`;
    
    if (!timeGroups[key]) {
      timeGroups[key] = { total: 0, success: 0 };
    }
    
    timeGroups[key].total++;
    if (record.success) {
      timeGroups[key].success++;
    }
  });
  
  const labels = Object.keys(timeGroups).sort();
  const data = labels.map(label => {
    const group = timeGroups[label];
    return Math.round((group.success / group.total) * 100);
  });
  
  // 创建图表
  const ctx = document.getElementById(canvasId) as HTMLCanvasElement;
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '成功率 (%)',
        data,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
      }],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
        },
      },
    },
  });
}
```

---

## ⚠️ 注意事项

### **1. 内存管理**

```typescript
// ✅ 监控模块会自动限制记录数量（最多 1000 条）
// ✅ 旧的记录会被自动移除

// 如果需要更严格的控制，可以定期重置
setInterval(() => {
  uploadMonitor.reset();
}, 24 * 60 * 60 * 1000); // 每天重置
```

---

### **2. 数据准确性**

监控依赖于日志系统，确保：
- ✅ 日志系统已正确初始化
- ✅ 未禁用日志输出（`logConfig.enabled !== false`）
- ✅ 关键日志（上传开始、成功、失败）未被过滤

---

### **3. 性能影响**

- ✅ 监控模块采用轻量级设计，对性能影响极小
- ✅ 日志处理异步进行，不阻塞主线程
- ✅ 自动限制记录数量，防止内存泄漏

---

### **4. 隐私保护**

```typescript
// 如果需要脱敏，可以在导出前处理
function sanitizeStats(stats: any) {
  return {
    ...stats,
    // 移除可能包含敏感信息的字段
    recentRecords: undefined,
  };
}
```

---

## 🐛 故障排查

### **Q: 统计数据始终为 0？**

A: 检查以下几点：
1. 确认日志系统已启用（`logConfig.enabled !== false`）
2. 确认有上传操作发生
3. 检查控制台是否有日志输出

---

### **Q: 如何验证监控是否工作？**

A: 执行以下代码：
```typescript
import { uploadMonitor } from '@core/utils';

// 上传一个文件后
setTimeout(() => {
  console.log(uploadMonitor.getStats());
  uploadMonitor.printReport();
}, 5000);
```

---

### **Q: 分片统计数据为空？**

A: 确保使用的是分片上传（配置了 `chunkOptions`），并且 ChunkManager 正确输出了相关日志。

---

## 📊 完整示例：监控仪表板

```typescript
import { uploadMonitor } from '@core/utils';

class UploadDashboard {
  private updateInterval?: NodeJS.Timeout;
  
  /**
   * 启动实时监控
   */
  start(intervalMs: number = 5000) {
    this.updateInterval = setInterval(() => {
      this.update();
    }, intervalMs);
    
    console.log('📊 上传监控仪表板已启动');
  }
  
  /**
   * 停止监控
   */
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    console.log('📊 上传监控仪表板已停止');
  }
  
  /**
   * 更新显示
   */
  private update() {
    const stats = uploadMonitor.getStats();
    const active = uploadMonitor.getActiveUploads();
    
    // 清除控制台
    console.clear();
    
    // 打印摘要
    console.group('📊 上传监控仪表板');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`成功率: ${this.formatPercentage(stats.successRate)}`);
    console.log(`活跃任务: ${active.size}`);
    console.log(`总上传: ${stats.totalUploads}`);
    console.log(`平均耗时: ${this.formatDuration(stats.averageDuration)}`);
    
    if (stats.chunkUploadStats) {
      console.log(`分片成功率: ${this.formatPercentage(stats.chunkUploadStats.chunkSuccessRate)}`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.groupEnd();
  }
  
  private formatPercentage(value: number): string {
    return `${value.toFixed(2)}%`;
  }
  
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

// 使用
const dashboard = new UploadDashboard();
dashboard.start(3000); // 每 3 秒更新

// 停止
// dashboard.stop();
```

---

## 🎯 最佳实践总结

1. **定期上报**：每小时或每天将统计数据上报到后端
2. **设置告警**：当成功率低于阈值时及时通知
3. **分析趋势**：关注成功率、耗时的变化趋势
4. **分片优化**：根据分片成功率调整并发数和重试策略
5. **资源清理**：定期重置统计数据，避免内存占用过大
6. **隐私保护**：导出或上报时注意脱敏处理
