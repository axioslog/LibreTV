// =================================
// ========= 离线缓存增强模块 =========
// =================================

// 缓存队列管理器
class CacheQueueManager {
  constructor(maxConcurrent = 3) {
    this.queue = [];
    this.active = new Map();
    this.maxConcurrent = maxConcurrent;
    this.paused = new Set();
  }

  // 添加任务到队列
  add(task) {
    // 检查是否已在队列中
    const existing = this.queue.find(t => t.cacheId === task.cacheId);
    if (existing) {
      return false;
    }

    this.queue.push(task);
    // 按优先级排序
    this.queue.sort((a, b) => b.priority - a.priority);
    this.process();
    return true;
  }

  // 处理队列
  async process() {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();

      // 检查是否被暂停
      if (this.paused.has(task.cacheId)) {
        continue;
      }

      this.active.set(task.cacheId, task);
      task.status = 'caching';

      try {
        await task.execute();
      } catch (error) {
        console.error('Cache task failed:', error);
        task.status = 'error';
      } finally {
        this.active.delete(task.cacheId);
        this.process();
      }
    }
  }

  // 暂停任务
  pause(cacheId) {
    this.paused.add(cacheId);
    const task = this.active.get(cacheId);
    if (task) {
      task.pause();
      this.active.delete(cacheId);
    }
    // 将任务重新加入队列
    const queuedTask = this.queue.find(t => t.cacheId === cacheId);
    if (queuedTask) {
      queuedTask.status = 'paused';
    }
  }

  // 继续任务
  resume(cacheId) {
    this.paused.delete(cacheId);
    const task = this.queue.find(t => t.cacheId === cacheId);
    if (task) {
      task.status = 'pending';
      this.process();
    }
  }

  // 取消任务
  cancel(cacheId) {
    this.paused.delete(cacheId);
    const task = this.active.get(cacheId);
    if (task) {
      task.cancel();
      this.active.delete(cacheId);
    }
    this.queue = this.queue.filter(t => t.cacheId !== cacheId);
  }

  // 获取队列状态
  getStatus() {
    return {
      queue: this.queue.map(t => ({
        cacheId: t.cacheId,
        episodeName: t.episodeName,
        status: t.status,
        progress: t.progress,
        priority: t.priority
      })),
      active: Array.from(this.active.values()).map(t => ({
        cacheId: t.cacheId,
        episodeName: t.episodeName,
        status: t.status,
        progress: t.progress
      })),
      paused: Array.from(this.paused)
    };
  }
}

// 缓存任务
class CacheTask {
  constructor(cacheId, episodeIndex, m3u8Url, episodeName, options = {}) {
    this.cacheId = cacheId;
    this.episodeIndex = episodeIndex;
    this.m3u8Url = m3u8Url;
    this.episodeName = episodeName;
    this.priority = options.priority || 5;
    this.status = 'pending';
    this.progress = 0;
    this.controller = new AbortController();
    this.retryCount = 0;
    this.maxRetries = options.maxRetries || 3;
    this.quality = options.quality || 'medium';
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  async execute() {
    this.status = 'caching';
    try {
      await this.download();
      this.status = 'complete';
      this.progress = 100;
      this.onComplete();
    } catch (error) {
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        this.status = 'retrying';
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount));
        return this.execute();
      } else {
        this.status = 'error';
        this.onError(error);
        throw error;
      }
    }
  }

  async download() {
    // 获取M3U8内容
    const m3u8Response = await fetch(this.m3u8Url, {
      signal: this.controller.signal
    });

    if (!m3u8Response.ok) {
      throw new Error(`Failed to fetch M3U8: ${m3u8Response.status}`);
    }

    const m3u8Content = await m3u8Response.text();

    // 解析M3U8
    const segments = this.parseM3U8(m3u8Content);
    const totalSegments = segments.length;

    // 保存视频元数据
    const video = await getOfflineVideo(this.cacheId) || {};
    video.id = this.cacheId;
    video.m3u8Url = this.m3u8Url;
    video.m3u8Content = m3u8Content;
    video.episodeIndex = this.episodeIndex;
    video.episodeName = this.episodeName;
    video.segmentCount = totalSegments;
    video.quality = this.quality;
    video.priority = this.priority;
    video.status = 'caching';
    video.progress = 0;
    video.retryCount = this.retryCount;
    video.updatedAt = Date.now();
    await saveOfflineVideo(video);

    // 下载分片
    let downloadedCount = 0;
    for (let i = 0; i < segments.length; i++) {
      if (this.controller.signal.aborted) {
        throw new Error('Download cancelled');
      }

      try {
        await this.downloadSegment(segments[i], i);
        downloadedCount++;
        this.progress = (downloadedCount / totalSegments) * 100;
        video.progress = this.progress;
        video.blobSize = await this.calculateTotalSize(this.cacheId, downloadedCount);
        await saveOfflineVideo(video);
        this.onProgress(this.progress, video.blobSize);
      } catch (error) {
        console.error(`Failed to download segment ${i}:`, error);
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          i--; // 重试当前分片
          await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount));
        } else {
          throw error;
        }
      }
    }

    // 生成重写的M3U8
    const rewrittenM3u8 = this.rewriteM3U8(m3u8Content, this.cacheId);
    video.rewrittenM3u8 = rewrittenM3u8;
    video.status = 'complete';
    video.progress = 100;
    video.blobSize = await this.calculateTotalSize(this.cacheId, totalSegments);
    video.completedAt = Date.now();
    await saveOfflineVideo(video);
  }

  parseM3U8(content) {
    const lines = content.split('\n');
    const segments = [];
    let currentSegment = null;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('#EXTINF:')) {
        currentSegment = {
          duration: parseFloat(trimmedLine.split(':')[1].split(',')[0]),
          url: null
        };
      } else if (trimmedLine && !trimmedLine.startsWith('#')) {
        if (currentSegment) {
          currentSegment.url = trimmedLine;
          segments.push(currentSegment);
          currentSegment = null;
        } else {
          segments.push({ url: trimmedLine, duration: 0 });
        }
      }
    }

    return segments;
  }

  async downloadSegment(url, index) {
    const segmentUrl = url.startsWith('http') ? url : new URL(url, this.m3u8Url).href;

    const response = await fetch(segmentUrl, {
      signal: this.controller.signal
    });

    if (!response.ok) {
      throw new Error(`Failed to download segment ${index}: ${response.status}`);
    }

    const blob = await response.blob();
    await saveSegment(`${this.cacheId}_${index}`, blob);
  }

  rewriteM3U8(content, cacheId) {
    const lines = content.split('\n');
    const rewritten = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine && !trimmedLine.startsWith('#')) {
        // 替换分片URL为离线URL
        const segmentIndex = rewritten.filter(l => l && !l.startsWith('#')).length;
        rewritten.push(`/offline-seg/${cacheId}/${segmentIndex}`);
      } else {
        rewritten.push(line);
      }
    }

    return rewritten.join('\n');
  }

  async calculateTotalSize(cacheId, segmentCount) {
    let totalSize = 0;
    for (let i = 0; i < segmentCount; i++) {
      const segment = await getSegment(`${cacheId}_${i}`);
      if (segment && segment.data) {
        totalSize += segment.data.size || 0;
      }
    }
    return totalSize;
  }

  pause() {
    this.controller.abort();
    this.status = 'paused';
  }

  cancel() {
    this.controller.abort();
    this.status = 'cancelled';
  }
}

// 存储管理器
class StorageManager {
  constructor() {
    this.dbName = 'LibreTVOffline';
    this.dbVersion = 6;
  }

  // 获取存储空间信息
  async getStorageInfo() {
    try {
      const videos = await getAllOfflineVideos();
      const totalSize = videos.reduce((sum, v) => sum + (v.blobSize || 0), 0);

      let quota = 0;
      let usage = 0;

      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        quota = estimate.quota || 0;
        usage = estimate.usage || 0;
      }

      return {
        used: totalSize,
        quota: quota,
        usage: usage,
        available: quota - usage,
        percentage: quota > 0 ? ((usage / quota) * 100).toFixed(2) : 0,
        videoCount: videos.length,
        completeCount: videos.filter(v => v.status === 'complete').length,
        cachingCount: videos.filter(v => v.status === 'caching').length,
        pausedCount: videos.filter(v => v.status === 'paused').length,
        errorCount: videos.filter(v => v.status === 'error').length
      };
    } catch (error) {
      console.error('Failed to get storage info:', error);
      return {
        used: 0,
        quota: 0,
        usage: 0,
        available: 0,
        percentage: 0,
        videoCount: 0,
        completeCount: 0,
        cachingCount: 0,
        pausedCount: 0,
        errorCount: 0
      };
    }
  }

  // 清理过期缓存
  async cleanExpiredCache() {
    try {
      const videos = await getAllOfflineVideos();
      const now = Date.now();
      const expired = videos.filter(v => v.expiresAt && v.expiresAt < now);

      for (const video of expired) {
        await deleteOfflineVideo(video.id);
      }

      return expired.length;
    } catch (error) {
      console.error('Failed to clean expired cache:', error);
      return 0;
    }
  }

  // 清理旧缓存
  async cleanOldCache(days = 30) {
    try {
      const videos = await getAllOfflineVideos();
      const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
      const old = videos.filter(v => v.createdAt && v.createdAt < threshold);

      for (const video of old) {
        await deleteOfflineVideo(video.id);
      }

      return old.length;
    } catch (error) {
      console.error('Failed to clean old cache:', error);
      return 0;
    }
  }

  // 清理失败缓存
  async cleanFailedCache() {
    try {
      const videos = await getAllOfflineVideos();
      const failed = videos.filter(v => v.status === 'error');

      for (const video of failed) {
        await deleteOfflineVideo(video.id);
      }

      return failed.length;
    } catch (error) {
      console.error('Failed to clean failed cache:', error);
      return 0;
    }
  }

  // 清理所有缓存
  async cleanAllCache() {
    try {
      const videos = await getAllOfflineVideos();

      for (const video of videos) {
        await deleteOfflineVideo(video.id);
      }

      return videos.length;
    } catch (error) {
      console.error('Failed to clean all cache:', error);
      return 0;
    }
  }

  // 格式化字节大小
  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

// 缓存统计
class CacheStatistics {
  async getStatistics() {
    try {
      const videos = await getAllOfflineVideos();
      const stats = {
        total: videos.length,
        caching: videos.filter(v => v.status === 'caching').length,
        paused: videos.filter(v => v.status === 'paused').length,
        complete: videos.filter(v => v.status === 'complete').length,
        error: videos.filter(v => v.status === 'error').length,
        totalSize: videos.reduce((sum, v) => sum + (v.blobSize || 0), 0),
        byQuality: {
          low: videos.filter(v => v.quality === 'low').length,
          medium: videos.filter(v => v.quality === 'medium').length,
          high: videos.filter(v => v.quality === 'high').length
        },
        bySource: {},
        byDate: {}
      };

      // 按来源统计
      videos.forEach(v => {
        const source = v.sourceCode || 'unknown';
        stats.bySource[source] = (stats.bySource[source] || 0) + 1;

        // 按日期统计
        const date = new Date(v.createdAt || Date.now()).toLocaleDateString();
        stats.byDate[date] = (stats.byDate[date] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('Failed to get statistics:', error);
      return {
        total: 0,
        caching: 0,
        paused: 0,
        complete: 0,
        error: 0,
        totalSize: 0,
        byQuality: { low: 0, medium: 0, high: 0 },
        bySource: {},
        byDate: {}
      };
    }
  }
}

// 全局实例
const cacheQueueManager = new CacheQueueManager(3);
const storageManager = new StorageManager();
const cacheStatistics = new CacheStatistics();

// 导出函数
window.CacheQueueManager = CacheQueueManager;
window.CacheTask = CacheTask;
window.StorageManager = StorageManager;
window.CacheStatistics = CacheStatistics;
window.cacheQueueManager = cacheQueueManager;
window.storageManager = storageManager;
window.cacheStatistics = cacheStatistics;
