// =================================
// ========= 高效下载管理器 =========
// =================================

/**
 * 下载管理器 - 支持断点续传、多线程下载、进度管理
 */
class DownloadManager {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 6; // 最大并发数
    this.maxRetries = options.maxRetries || 5; // 最大重试次数
    this.retryDelay = options.retryDelay || 2000; // 重试延迟（毫秒）
    this.timeout = options.timeout || 30000; // 请求超时（毫秒）
    this.chunkSize = options.chunkSize || 1024 * 1024; // 分块大小（1MB）
    
    this.activeDownloads = new Map(); // 活跃下载
    this.downloadQueue = []; // 下载队列
    this.pausedDownloads = new Set(); // 暂停的下载
  }

  /**
   * 添加下载任务
   */
  addDownload(task) {
    const downloadTask = {
      id: task.id,
      url: task.url,
      filePath: task.filePath,
      totalSize: task.totalSize || 0,
      downloadedSize: task.downloadedSize || 0,
      status: 'pending',
      progress: 0,
      speed: 0,
      retryCount: 0,
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      onProgress: task.onProgress || (() => {}),
      onComplete: task.onComplete || (() => {}),
      onError: task.onError || (() => {}),
      signal: task.signal
    };

    this.downloadQueue.push(downloadTask);
    this.processQueue();
    
    return downloadTask;
  }

  /**
   * 处理下载队列
   */
  async processQueue() {
    while (this.activeDownloads.size < this.maxConcurrent && this.downloadQueue.length > 0) {
      const task = this.downloadQueue.shift();
      
      // 检查是否被暂停
      if (this.pausedDownloads.has(task.id)) {
        task.status = 'paused';
        continue;
      }

      this.activeDownloads.set(task.id, task);
      this.executeDownload(task).catch(error => {
        console.error(`Download task ${task.id} failed:`, error);
        task.status = 'error';
        task.onError(error);
      }).finally(() => {
        this.activeDownloads.delete(task.id);
        this.processQueue();
      });
    }
  }

  /**
   * 执行下载任务
   */
  async executeDownload(task) {
    task.status = 'downloading';
    task.startTime = Date.now();
    
    try {
      // 使用axios进行断点续传下载
      const response = await this.downloadWithRetry(task);
      
      task.status = 'completed';
      task.progress = 100;
      task.downloadedSize = task.totalSize;
      task.onComplete(response);
    } catch (error) {
      if (task.retryCount < this.maxRetries) {
        task.retryCount++;
        task.status = 'retrying';
        console.log(`Retrying download ${task.id}, attempt ${task.retryCount}`);
        
        // 指数退避
        const delay = Math.min(this.retryDelay * Math.pow(2, task.retryCount - 1), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.executeDownload(task);
      } else {
        task.status = 'error';
        throw error;
      }
    }
  }

  /**
   * 带重试的下载
   */
  async downloadWithRetry(task) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    if (task.signal) {
      task.signal.addEventListener('abort', () => {
        controller.abort();
      });
    }

    try {
      const headers = {};
      
      // 断点续传
      if (task.downloadedSize > 0) {
        headers['Range'] = `bytes=${task.downloadedSize}-`;
      }

      const response = await fetch(task.url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 获取总大小
      const contentRange = response.headers.get('Content-Range');
      if (contentRange) {
        const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
        if (match) {
          task.totalSize = parseInt(match[1]);
        }
      } else {
        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
          task.totalSize = parseInt(contentLength) + task.downloadedSize;
        }
      }

      // 读取数据
      const reader = response.body.getReader();
      const chunks = [];
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        // 更新进度
        task.downloadedSize += value.length;
        task.progress = task.totalSize > 0 ? (task.downloadedSize / task.totalSize) * 100 : 0;
        
        // 计算速度
        const now = Date.now();
        const timeDiff = (now - task.lastUpdateTime) / 1000;
        if (timeDiff > 0.5) {
          task.speed = receivedLength / timeDiff;
          task.lastUpdateTime = now;
          receivedLength = 0;
        }
        
        task.onProgress(task.progress, task.downloadedSize, task.speed);
      }

      // 合并所有分块
      const blob = new Blob(chunks);
      return blob;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Download timeout or cancelled');
      }
      
      throw error;
    }
  }

  /**
   * 暂停下载
   */
  pauseDownload(id) {
    this.pausedDownloads.add(id);
    
    const task = this.activeDownloads.get(id);
    if (task) {
      task.status = 'paused';
      // 注意：这里不能真正中止fetch，只能标记为暂停
    }
  }

  /**
   * 恢复下载
   */
  resumeDownload(id) {
    this.pausedDownloads.delete(id);
    
    const task = this.downloadQueue.find(t => t.id === id);
    if (task) {
      task.status = 'pending';
      this.processQueue();
    }
  }

  /**
   * 取消下载
   */
  cancelDownload(id) {
    this.pausedDownloads.delete(id);
    
    const task = this.activeDownloads.get(id);
    if (task && task.signal) {
      task.signal.abort();
    }
    
    this.activeDownloads.delete(id);
    this.downloadQueue = this.downloadQueue.filter(t => t.id !== id);
  }

  /**
   * 获取下载状态
   */
  getDownloadStatus(id) {
    const task = this.activeDownloads.get(id) || 
                 this.downloadQueue.find(t => t.id === id);
    
    if (!task) return null;
    
    return {
      id: task.id,
      status: task.status,
      progress: task.progress,
      downloadedSize: task.downloadedSize,
      totalSize: task.totalSize,
      speed: task.speed,
      retryCount: task.retryCount
    };
  }

  /**
   * 获取所有下载状态
   */
  getAllDownloads() {
    const downloads = [];
    
    this.activeDownloads.forEach(task => {
      downloads.push(this.getDownloadStatus(task.id));
    });
    
    this.downloadQueue.forEach(task => {
      downloads.push(this.getDownloadStatus(task.id));
    });
    
    return downloads;
  }
}

/**
 * M3U8下载器 - 支持分片下载和合并
 */
class M3U8Downloader {
  constructor(downloadManager) {
    this.downloadManager = downloadManager;
    this.segmentCache = new Map(); // 分片缓存
  }

  /**
   * 下载M3U8文件
   */
  async downloadM3U8(m3u8Url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);

    try {
      const response = await fetch(m3u8Url, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to download M3U8: ${response.status}`);
      }

      const content = await response.text();
      return this.parseM3U8(content, m3u8Url);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 解析M3U8文件
   */
  parseM3U8(content, baseUrl) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    const segments = [];
    const keyInfos = [];
    let currentSegment = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 解析加密信息
      if (line.startsWith('#EXT-X-KEY:')) {
        const keyInfo = this.parseKeyInfo(line, baseUrl);
        if (keyInfo) {
          keyInfos.push(keyInfo);
        }
      }
      // 解析分片时长
      else if (line.startsWith('#EXTINF:')) {
        const duration = parseFloat(line.split(':')[1].split(',')[0]);
        currentSegment = { duration, url: null };
      }
      // 分片URL
      else if (!line.startsWith('#') && currentSegment) {
        currentSegment.url = this.resolveUrl(line, baseUrl);
        segments.push(currentSegment);
        currentSegment = null;
      }
    }

    return {
      content,
      segments,
      keyInfos,
      segmentCount: segments.length
    };
  }

  /**
   * 解析加密信息
   */
  parseKeyInfo(line, baseUrl) {
    const methodMatch = line.match(/METHOD=([^,]+)/);
    const uriMatch = line.match(/URI="([^"]+)"/);
    const ivMatch = line.match(/IV=0x([0-9A-Fa-f]+)/);

    if (!methodMatch || !uriMatch) return null;

    return {
      method: methodMatch[1],
      uri: this.resolveUrl(uriMatch[1], baseUrl),
      iv: ivMatch ? ivMatch[1] : null
    };
  }

  /**
   * 解析相对URL
   */
  resolveUrl(url, baseUrl) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    if (url.startsWith('/')) {
      const urlObj = new URL(baseUrl);
      return `${urlObj.protocol}//${urlObj.host}${url}`;
    }

    const lastSlash = baseUrl.lastIndexOf('/');
    if (lastSlash !== -1) {
      return baseUrl.substring(0, lastSlash + 1) + url;
    }

    return url;
  }

  /**
   * 下载所有分片
   */
  async downloadSegments(parsedM3U8, cacheId, options = {}) {
    const { segments, keyInfos } = parsedM3U8;
    const concurrency = options.concurrency || 6;
    const onProgress = options.onProgress || (() => {});

    // 下载加密密钥
    for (let i = 0; i < keyInfos.length; i++) {
      try {
        const keyData = await this.downloadSegment(keyInfos[i].uri, `${cacheId}_key_${i}`, options);
        this.segmentCache.set(`${cacheId}_key_${i}`, keyData);
      } catch (error) {
        console.warn(`Failed to download key ${i}:`, error);
      }
    }

    // 下载分片
    const downloadedSegments = new Map();
    let completedCount = 0;
    let totalBytes = 0;

    const downloadPromises = [];

    for (let i = 0; i < segments.length; i++) {
      const segmentId = `${cacheId}_${i}`;
      
      // 检查是否已缓存
      if (this.segmentCache.has(segmentId)) {
        completedCount++;
        totalBytes += this.segmentCache.get(segmentId).byteLength;
        continue;
      }

      const promise = this.downloadSegment(segments[i].url, segmentId, options)
        .then(data => {
          downloadedSegments.set(i, data);
          completedCount++;
          totalBytes += data.byteLength;
          
          const progress = (completedCount / segments.length) * 100;
          onProgress(progress, completedCount, segments.length, totalBytes);
        })
        .catch(error => {
          console.warn(`Failed to download segment ${i}:`, error);
        });

      downloadPromises.push(promise);

      // 控制并发
      if (downloadPromises.length >= concurrency) {
        await Promise.race(downloadPromises);
        downloadPromises.splice(
          downloadPromises.findIndex(p => p.status === 'resolved'),
          1
        );
      }
    }

    await Promise.all(downloadPromises);

    // 合并结果
    const segmentData = new Array(segments.length);
    downloadedSegments.forEach((data, index) => {
      segmentData[index] = data;
    });

    return {
      segments: segmentData,
      completedCount,
      totalCount: segments.length,
      totalBytes
    };
  }

  /**
   * 下载单个分片
   */
  async downloadSegment(url, segmentId, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);

    try {
      const response = await fetch(url, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to download segment: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      this.segmentCache.set(segmentId, arrayBuffer);
      
      return arrayBuffer;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.segmentCache.clear();
  }

  /**
   * 获取缓存的分片
   */
  getCachedSegment(segmentId) {
    return this.segmentCache.get(segmentId);
  }
}

/**
 * 下载进度管理器
 */
class DownloadProgressManager {
  constructor() {
    this.progressData = new Map();
  }

  /**
   * 更新进度
   */
  updateProgress(downloadId, progress, downloadedSize, totalSize, speed) {
    this.progressData.set(downloadId, {
      progress,
      downloadedSize,
      totalSize,
      speed,
      lastUpdateTime: Date.now()
    });
  }

  /**
   * 获取进度
   */
  getProgress(downloadId) {
    return this.progressData.get(downloadId);
  }

  /**
   * 获取所有进度
   */
  getAllProgress() {
    return Object.fromEntries(this.progressData);
  }

  /**
   * 清除进度
   */
  clearProgress(downloadId) {
    this.progressData.delete(downloadId);
  }

  /**
   * 清除所有进度
   */
  clearAllProgress() {
    this.progressData.clear();
  }
}

// 创建全局实例
const downloadManager = new DownloadManager({
  maxConcurrent: 6,
  maxRetries: 5,
  retryDelay: 2000,
  timeout: 30000
});

const m3u8Downloader = new M3U8Downloader(downloadManager);
const downloadProgressManager = new DownloadProgressManager();

// 导出
window.DownloadManager = DownloadManager;
window.M3U8Downloader = M3U8Downloader;
window.DownloadProgressManager = DownloadProgressManager;
window.downloadManager = downloadManager;
window.m3u8Downloader = m3u8Downloader;
window.downloadProgressManager = downloadProgressManager;
