# LibreTV 离线缓存功能设计方案

## 1. 总体设计

### 1.1 设计目标
- 提供类似爱奇艺的离线缓存体验
- 优化缓存流程和用户界面
- 提升缓存性能和稳定性
- 完善离线观看体验

### 1.2 设计原则
- 简单易用：一键缓存，操作简单
- 高效稳定：优化下载机制，支持断点续传
- 用户友好：清晰的进度显示，及时的状态反馈
- 可扩展性：模块化设计，便于后续扩展

## 2. 功能模块设计

### 2.1 缓存管理模块

#### 2.1.1 缓存队列管理
```javascript
class CacheQueue {
  constructor(maxConcurrent = 3) {
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = maxConcurrent;
  }

  // 添加任务
  add(task) {
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.process();
  }

  // 处理队列
  async process() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      this.active++;
      try {
        await task.execute();
      } catch (error) {
        console.error('Cache task failed:', error);
      } finally {
        this.active--;
        this.process();
      }
    }
  }

  // 暂停任务
  pause(cacheId) {
    const task = this.queue.find(t => t.cacheId === cacheId);
    if (task) {
      task.status = 'paused';
    }
  }

  // 继续任务
  resume(cacheId) {
    const task = this.queue.find(t => t.cacheId === cacheId);
    if (task) {
      task.status = 'pending';
      this.process();
    }
  }

  // 取消任务
  cancel(cacheId) {
    this.queue = this.queue.filter(t => t.cacheId !== cacheId);
  }
}
```

#### 2.1.2 缓存任务管理
```javascript
class CacheTask {
  constructor(cacheId, episodeIndex, m3u8Url, episodeName, priority = 5) {
    this.cacheId = cacheId;
    this.episodeIndex = episodeIndex;
    this.m3u8Url = m3u8Url;
    this.episodeName = episodeName;
    this.priority = priority;
    this.status = 'pending';
    this.progress = 0;
    this.controller = new AbortController();
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async execute() {
    this.status = 'caching';
    try {
      await this.download();
      this.status = 'complete';
      this.progress = 100;
    } catch (error) {
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        this.status = 'retrying';
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount));
        return this.execute();
      } else {
        this.status = 'error';
        throw error;
      }
    }
  }

  async download() {
    // 下载逻辑
  }

  pause() {
    this.controller.abort();
    this.status = 'paused';
  }
}
```

### 2.2 存储管理模块

#### 2.2.1 存储空间管理
```javascript
class StorageManager {
  constructor() {
    this.dbName = 'LibreTVOffline';
    this.dbVersion = 6; // 升级版本
  }

  // 获取存储空间信息
  async getStorageInfo() {
    const videos = await this.getAllVideos();
    const totalSize = videos.reduce((sum, v) => sum + (v.blobSize || 0), 0);
    const quota = await navigator.storage.estimate();
    return {
      used: totalSize,
      quota: quota.quota,
      usage: quota.usage,
      available: quota.quota - quota.usage,
      percentage: (quota.usage / quota.quota * 100).toFixed(2)
    };
  }

  // 清理过期缓存
  async cleanExpiredCache() {
    const videos = await this.getAllVideos();
    const now = Date.now();
    const expired = videos.filter(v => v.expiresAt && v.expiresAt < now);
    for (const video of expired) {
      await this.deleteVideo(video.id);
    }
    return expired.length;
  }

  // 清理旧缓存
  async cleanOldCache(days = 30) {
    const videos = await this.getAllVideos();
    const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
    const old = videos.filter(v => v.createdAt < threshold);
    for (const video of old) {
      await this.deleteVideo(video.id);
    }
    return old.length;
  }

  // 清理失败缓存
  async cleanFailedCache() {
    const videos = await this.getAllVideos();
    const failed = videos.filter(v => v.status === 'error');
    for (const video of failed) {
      await this.deleteVideo(video.id);
    }
    return failed.length;
  }
}
```

#### 2.2.2 缓存统计
```javascript
class CacheStatistics {
  async getStatistics() {
    const videos = await getAllVideos();
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
      bySource: {}
    };

    // 按来源统计
    videos.forEach(v => {
      const source = v.sourceCode || 'unknown';
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;
    });

    return stats;
  }
}
```

### 2.3 下载管理模块

#### 2.3.1 下载控制器
```javascript
class DownloadController {
  constructor() {
    this.activeDownloads = new Map();
    this.maxConcurrent = 3;
    this.downloadQueue = [];
  }

  // 开始下载
  async startDownload(cacheId, m3u8Url, options = {}) {
    if (this.activeDownloads.has(cacheId)) {
      throw new Error('Download already in progress');
    }

    if (this.activeDownloads.size >= this.maxConcurrent) {
      return this.queueDownload(cacheId, m3u8Url, options);
    }

    const download = new DownloadTask(cacheId, m3u8Url, options);
    this.activeDownloads.set(cacheId, download);

    try {
      await download.start();
      return download;
    } finally {
      this.activeDownloads.delete(cacheId);
      this.processQueue();
    }
  }

  // 队列下载
  queueDownload(cacheId, m3u8Url, options) {
    return new Promise((resolve, reject) => {
      this.downloadQueue.push({
        cacheId,
        m3u8Url,
        options,
        resolve,
        reject
      });
    });
  }

  // 处理队列
  async processQueue() {
    while (this.downloadQueue.length > 0 && this.activeDownloads.size < this.maxConcurrent) {
      const task = this.downloadQueue.shift();
      try {
        const download = await this.startDownload(task.cacheId, task.m3u8Url, task.options);
        task.resolve(download);
      } catch (error) {
        task.reject(error);
      }
    }
  }

  // 暂停下载
  pauseDownload(cacheId) {
    const download = this.activeDownloads.get(cacheId);
    if (download) {
      download.pause();
    }
  }

  // 取消下载
  cancelDownload(cacheId) {
    const download = this.activeDownloads.get(cacheId);
    if (download) {
      download.cancel();
      this.activeDownloads.delete(cacheId);
    }
  }
}
```

#### 2.3.2 下载任务
```javascript
class DownloadTask {
  constructor(cacheId, m3u8Url, options = {}) {
    this.cacheId = cacheId;
    this.m3u8Url = m3u8Url;
    this.options = {
      quality: options.quality || 'medium',
      maxRetries: options.maxRetries || 3,
      speedLimit: options.speedLimit || 0,
      ...options
    };
    this.controller = new AbortController();
    this.progress = 0;
    this.downloadedSegments = new Set();
    this.totalSegments = 0;
    this.retryCount = 0;
  }

  async start() {
    // 解析M3U8
    const m3u8Content = await this.fetchM3U8();
    const segments = this.parseM3U8(m3u8Content);
    this.totalSegments = segments.length;

    // 下载分片
    for (let i = 0; i < segments.length; i++) {
      if (this.controller.signal.aborted) {
        throw new Error('Download cancelled');
      }

      if (this.downloadedSegments.has(i)) {
        continue;
      }

      try {
        await this.downloadSegment(segments[i], i);
        this.downloadedSegments.add(i);
        this.progress = ((i + 1) / segments.length) * 100;
        this.emitProgress();
      } catch (error) {
        if (this.retryCount < this.options.maxRetries) {
          this.retryCount++;
          i--; // 重试当前分片
          await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount));
        } else {
          throw error;
        }
      }
    }

    // 保存元数据
    await this.saveMetadata();
  }

  async fetchM3U8() {
    const response = await fetch(this.m3u8Url, {
      signal: this.controller.signal
    });
    return await response.text();
  }

  parseM3U8(content) {
    // 解析M3U8内容
    const lines = content.split('\n');
    const segments = [];
    for (const line of lines) {
      if (line.startsWith('http')) {
        segments.push(line);
      }
    }
    return segments;
  }

  async downloadSegment(url, index) {
    const response = await fetch(url, {
      signal: this.controller.signal
    });
    const blob = await response.blob();
    await saveSegment(`${this.cacheId}_${index}`, blob);
  }

  async saveMetadata() {
    const video = await getOfflineVideo(this.cacheId);
    video.status = 'complete';
    video.progress = 100;
    video.segmentCount = this.totalSegments;
    await saveOfflineVideo(video);
  }

  pause() {
    this.controller.abort();
  }

  cancel() {
    this.controller.abort();
  }

  emitProgress() {
    // 发送进度事件
  }
}
```

### 2.4 UI模块设计

#### 2.4.1 缓存管理页面优化
```html
<!-- 优化后的缓存管理页面 -->
<div class="cache-manager">
  <!-- 存储空间提示 -->
  <div class="storage-info">
    <div class="storage-bar">
      <div class="storage-used" style="width: 45%"></div>
    </div>
    <div class="storage-text">
      <span>已用 2.3GB / 5GB</span>
      <button class="btn-clean">清理</button>
    </div>
  </div>

  <!-- 缓存统计 -->
  <div class="cache-stats">
    <div class="stat-item">
      <span class="stat-value">12</span>
      <span class="stat-label">总缓存</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">3</span>
      <span class="stat-label">下载中</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">9</span>
      <span class="stat-label">已完成</span>
    </div>
  </div>

  <!-- 缓存列表 -->
  <div class="cache-list">
    <!-- 缓存项 -->
    <div class="cache-item">
      <div class="cache-thumbnail">
        <img src="thumbnail.jpg" alt="缩略图">
      </div>
      <div class="cache-info">
        <div class="cache-title">视频标题</div>
        <div class="cache-meta">第1集 · 45分钟 · 500MB</div>
        <div class="cache-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: 75%"></div>
          </div>
          <div class="progress-text">75% · 2.5MB/s</div>
        </div>
      </div>
      <div class="cache-actions">
        <button class="btn-pause">暂停</button>
        <button class="btn-delete">删除</button>
      </div>
    </div>
  </div>
</div>
```

#### 2.4.2 缓存模态框优化
```html
<!-- 优化后的缓存模态框 -->
<div class="cache-modal">
  <div class="modal-header">
    <h2>离线缓存</h2>
    <button class="btn-close">×</button>
  </div>

  <div class="modal-body">
    <!-- 当前视频 -->
    <div class="current-video">
      <div class="video-info">
        <h3>当前视频</h3>
        <p>第5集 · 剧情介绍</p>
      </div>
      <div class="video-actions">
        <button class="btn-cache">缓存当前集</button>
        <button class="btn-cache-all">缓存全部</button>
      </div>
    </div>

    <!-- 缓存设置 -->
    <div class="cache-settings">
      <h3>缓存设置</h3>
      <div class="setting-item">
        <label>画质选择</label>
        <select>
          <option value="low">流畅 (360P)</option>
          <option value="medium" selected>高清 (720P)</option>
          <option value="high">超清 (1080P)</option>
        </select>
      </div>
      <div class="setting-item">
        <label>最大并发</label>
        <select>
          <option value="1">1个</option>
          <option value="2">2个</option>
          <option value="3" selected>3个</option>
        </select>
      </div>
    </div>

    <!-- 缓存队列 -->
    <div class="cache-queue">
      <h3>缓存队列</h3>
      <div class="queue-list">
        <!-- 队列项 -->
        <div class="queue-item">
          <div class="queue-info">
            <span>第1集</span>
            <span class="queue-status">下载中</span>
          </div>
          <div class="queue-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: 45%"></div>
            </div>
            <span class="progress-text">45%</span>
          </div>
          <button class="btn-pause">暂停</button>
        </div>
      </div>
    </div>
  </div>
</div>
```

#### 2.4.3 离线状态提示
```html
<!-- 离线状态提示 -->
<div class="offline-indicator" id="offlineIndicator">
  <div class="indicator-icon">📶</div>
  <div class="indicator-text">离线模式</div>
</div>

<!-- 离线提示弹窗 -->
<div class="offline-toast" id="offlineToast">
  <div class="toast-icon">⚠️</div>
  <div class="toast-message">
    <h4>网络已断开</h4>
    <p>已切换到离线模式，可以观看已缓存的视频</p>
  </div>
  <button class="btn-close">知道了</button>
</div>
```

## 3. 数据库设计

### 3.1 IndexedDB升级
```javascript
// 升级到版本6
request.onupgradeneeded = (e) => {
  const db = e.target.result;

  // videos store - 添加索引
  if (!db.objectStoreNames.contains('videos')) {
    const videoStore = db.createObjectStore('videos', { keyPath: 'id' });
    videoStore.createIndex('status', 'status', { unique: false });
    videoStore.createIndex('sourceCode', 'sourceCode', { unique: false });
    videoStore.createIndex('createdAt', 'createdAt', { unique: false });
    videoStore.createIndex('expiresAt', 'expiresAt', { unique: false });
  }

  // segments store - 添加索引
  if (!db.objectStoreNames.contains('segments')) {
    const segmentStore = db.createObjectStore('segments', { keyPath: 'id' });
    segmentStore.createIndex('cacheId', 'cacheId', { unique: false });
  }

  // blobs store - 添加索引
  if (!db.objectStoreNames.contains('blobs')) {
    const blobStore = db.createObjectStore('blobs', { keyPath: 'id' });
    blobStore.createIndex('cacheId', 'cacheId', { unique: false });
  }

  // cache_meta store (新增)
  if (!db.objectStoreNames.contains('cache_meta')) {
    const metaStore = db.createObjectStore('cache_meta', { keyPath: 'id' });
    metaStore.createIndex('key', 'key', { unique: true });
  }
};
```

### 3.2 数据结构
```javascript
// videos store
{
  id: string,              // 缓存ID
  title: string,           // 视频标题
  sourceCode: string,      // 视频源代码
  episodeIndex: number,    // 集数索引
  episodeName: string,     // 集数名称
  m3u8Url: string,         // M3U8地址
  m3u8Content: string,     // M3U8内容
  rewrittenM3u8: string,    // 重写后的M3U8
  segmentCount: number,    // 分片数量
  keyCount: number,        // 密钥数量
  blobSize: number,        // 总大小
  progress: number,        // 进度（0-100）
  status: string,          // 状态：pending/caching/paused/complete/error
  quality: string,         // 质量：low/medium/high
  priority: number,       // 优先级（1-10）
  retryCount: number,      // 重试次数
  createdAt: number,      // 创建时间
  updatedAt: number,      // 更新时间
  expiresAt: number,      // 过期时间
  thumbnail: string       // 缩略图URL
}

// cache_meta store
{
  id: 'global',
  totalSize: number,       // 总大小
  totalVideos: number,     // 总视频数
  lastCleanup: number,     // 最后清理时间
  settings: {              // 设置
    maxConcurrent: number, // 最大并发数
    maxRetries: number,    // 最大重试次数
    autoRetry: boolean,    // 自动重试
    quality: string,       // 默认质量
    speedLimit: number     // 速度限制
  }
}
```

## 4. Service Worker优化

### 4.1 缓存策略优化
```javascript
// 优化后的Service Worker
const CACHE_NAME = 'libretv-v3.1';
const STATIC_ASSETS = [
  // ... 静态资源
];

// 缓存策略
const CACHE_STRATEGIES = {
  // 静态资源：缓存优先
  static: 'cache-first',

  // API请求：网络优先
  api: 'network-first',

  // 离线数据：仅缓存
  offline: 'cache-only'
};

// 安装事件
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 激活事件
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // 清理旧缓存
      caches.keys().then(keys => {
        return Promise.all(
          keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        );
      }),
      // 清理过期数据
      cleanExpiredData()
    ])
  );
  self.clients.claim();
});

// 清理过期数据
async function cleanExpiredData() {
  try {
    const db = await swOpenDB();
    const tx = db.transaction(['videos', 'segments', 'blobs'], 'readwrite');
    const now = Date.now();

    // 清理过期的视频
    const videoStore = tx.objectStore('videos');
    const videos = await getAllFromStore(videoStore);
    const expired = videos.filter(v => v.expiresAt && v.expiresAt < now);

    for (const video of expired) {
      await deleteVideoData(db, video.id);
    }
  } catch (error) {
    console.error('Clean expired data error:', error);
  }
}
```

## 5. 用户体验优化

### 5.1 缓存操作流程
1. **一键缓存**
   - 点击缓存按钮
   - 显示缓存设置
   - 开始下载
   - 显示进度

2. **批量缓存**
   - 选择多集
   - 设置缓存参数
   - 添加到队列
   - 自动下载

3. **暂停/继续**
   - 点击暂停按钮
   - 停止下载
   - 保存进度
   - 点击继续恢复

4. **删除缓存**
   - 确认删除
   - 清理数据
   - 释放空间
   - 更新统计

### 5.2 状态提示
- **下载中**：显示进度条和速度
- **已暂停**：显示暂停状态和进度
- **已完成**：显示完成状态和大小
- **失败**：显示失败原因和重试按钮

### 5.3 离线/在线切换
- **网络状态检测**
- **离线模式提示**
- **自动切换播放源**
- **状态同步**

## 6. 测试方案

### 6.1 功能测试
- 缓存当前视频
- 批量缓存多集
- 暂停/继续缓存
- 删除缓存
- 离线播放
- 缓存失败重试

### 6.2 性能测试
- 缓存速度测试
- 并发下载测试
- 存储空间测试
- 离线播放性能测试

### 6.3 兼容性测试
- Chrome浏览器
- Safari浏览器
- Firefox浏览器
- 移动端浏览器

## 7. 实施计划

### 阶段1：核心功能（2天）
- [ ] 实现缓存队列管理
- [ ] 实现下载控制器
- [ ] 优化存储管理
- [ ] 升级IndexedDB

### 阶段2：UI优化（1天）
- [ ] 优化缓存管理页面
- [ ] 优化缓存模态框
- [ ] 添加离线状态提示
- [ ] 优化进度显示

### 阶段3：测试验证（0.5天）
- [ ] 功能测试
- [ ] 性能测试
- [ ] 兼容性测试
- [ ] 修复bug

### 阶段4：版本发布（0.5天）
- [ ] 更新版本号
- [ ] 提交代码
- [ ] 推送到GitHub
- [ ] 等待部署

总计：4天
