# LibreTV 播放器问题修复验证指南

## 修复内容

### 1. Service Worker 缓存问题修复
- ✅ 更新缓存版本从 `libretv-v3.2` 到 `libretv-v3.2.0`
- ✅ 添加 `VERSION.txt` 到缓存列表
- ✅ 修复 `VERSION.txt` 缓存策略，确保每次获取最新版本

### 2. 播放器加载问题修复
- ✅ 增强播放器初始化调试信息
- ✅ 改进密码验证错误处理
- ✅ 修复播放器一直加载的问题

## 验证步骤

### 第一步：等待 Cloudflare 自动部署

1. **等待时间**：5-10 分钟
2. **检查部署状态**：
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - 进入 Pages 服务
   - 查看最新部署状态

### 第二步：清除浏览器缓存

**重要**：由于 Service Worker 缓存版本已更新，需要清除旧缓存：

#### 方法 1：通过浏览器开发者工具（推荐）

1. 打开浏览器开发者工具（F12）
2. 进入 "Application" 或 "应用程序" 标签
3. 左侧找到 "Service Workers"
4. 点击 "Unregister" 或 "注销" 按钮
5. 刷新页面

#### 方法 2：通过浏览器设置

1. 打开浏览器设置
2. 进入 "隐私和安全" > "清除浏览数据"
3. 选择 "缓存的图片和文件"
4. 点击 "清除数据"

#### 方法 3：强制刷新（简单但不彻底）

1. Windows: `Ctrl + Shift + R`
2. Mac: `Cmd + Shift + R`

### 第三步：验证首页版本号

1. 访问你的 Cloudflare Pages 网站
2. 滚动到页面底部
3. 检查版本号是否显示为 `v3.2.0`

**预期结果**：
- ✅ 版本号显示为 `v3.2.0`
- ✅ 如果有新版本，会显示 "发现新版" 提示

### 第四步：验证播放器功能

1. **搜索视频**：
   - 在首页搜索框输入关键词
   - 选择一个视频

2. **点击播放**：
   - 点击视频的播放按钮
   - 观察是否正常跳转到播放器页面

3. **检查播放器加载**：
   - 播放器页面应该正常加载
   - 不应该一直显示 "正在加载视频..."
   - 应该能看到视频播放器界面

4. **测试视频播放**：
   - 选择一个集数
   - 点击播放
   - 观察视频是否能正常播放

**预期结果**：
- ✅ 播放器页面正常加载
- ✅ 不再一直显示 "正在加载视频..."
- ✅ 视频能正常播放
- ✅ 播放器控制栏正常显示

### 第五步：验证离线缓存功能

1. **打开离线缓存列表**：
   - 在首页点击左上角的缓存图标
   - 应该能正常打开离线缓存列表

2. **测试离线播放**：
   - 如果有缓存的视频
   - 点击播放
   - 观察是否能正常播放

**预期结果**：
- ✅ 缓存图标能正常打开离线列表
- ✅ 离线视频能正常播放

## 调试信息

如果问题仍然存在，请检查浏览器控制台：

### 打开控制台

1. 按 `F12` 打开开发者工具
2. 进入 "Console" 或 "控制台" 标签

### 关键日志信息

查找以下关键日志：

```
[Player] DOMContentLoaded, starting initialization...
[Player] URL params: ...
[Player] Password verified: true/false
[Player] Password protected: true/false
[Player] ENV PASSWORD: set/not set
[Player] initializePageContent called
[Player] URL params parsed: ...
[Player] Video URL: ...
[Player] Current video title: ...
[Player] Initializing player with URL: ...
```

### 常见错误信息

1. **密码验证失败**：
   ```
   [Player] Password not verified, showing modal
   ```
   **解决方案**：输入正确的密码

2. **视频 URL 无效**：
   ```
   [Player] No video URL provided, showing error
   ```
   **解决方案**：返回首页重新选择视频

3. **播放器初始化失败**：
   ```
   [Player] Error initializing player: ...
   ```
   **解决方案**：检查网络连接和视频源

## 常见问题

### Q1: 版本号仍然没有更新

**解决方案**：
1. 确保已清除浏览器缓存
2. 确保已注销 Service Worker
4. 等待 Cloudflare 部署完成（5-10 分钟）
5. 尝试无痕模式访问

### Q2: 播放器仍然一直加载

**解决方案**：
1. 打开浏览器控制台查看错误信息
2. 检查密码验证是否通过
3. 检查视频 URL 是否有效
4. 尝试其他视频源

### Q3: 点击缓存图标仍然失败

**解决方案**：
1. 确保已清除 Service Worker 缓存
2. 检查是否有离线缓存的视频
3. 尝试刷新页面后再次点击

### Q4: 控制台显示 "Identifier 'offlineDB' has already been declared" 错误

**问题原因**：
这是由于 `player.js` 和 `offline-cache-enhanced.js` 都声明了 `offlineDB` 变量导致的重复声明错误。

**解决方案**：
1. 确保已更新到最新版本（v3.2.0 或更高）
2. 清除浏览器缓存并刷新页面
3. 如果问题仍然存在，强制刷新（Ctrl + Shift + R）

**技术细节**：
- 已将 `player.js` 中的 `offlineDB` 改为 `window.offlineDB`
- 避免了与 `offline-cache-enhanced.js` 的变量冲突
- 两个文件现在可以正常共存

### Q5: 离线缓存功能无法使用，点击离线管理页面无法打开

**问题原因**：
这是由于不同文件中 IndexedDB 数据库版本不一致导致的：
- `ui.js` 使用数据库版本 5
- `offline.html` 使用数据库版本 5
- `player.js` 和 `offline-cache-enhanced.js` 使用数据库版本 6

**解决方案**：
1. 确保已更新到最新版本（v3.2.0 或更高）
2. 清除浏览器缓存和 IndexedDB 数据
3. 刷新页面后重试

**清除 IndexedDB 数据的方法**：
1. 按 `F12` 打开开发者工具
2. 进入 "Application" 或 "应用程序" 标签
3. 左侧找到 "Storage" > "IndexedDB"
4. 找到 "LibreTVOffline" 数据库
5. 右键点击并选择 "Delete database" 或 "删除数据库"
6. 刷新页面

**技术细节**：
- 已将所有文件的数据库版本统一为 6
- 更新了数据库结构，添加了必要的索引
- 为 `showIndexOfflineList()` 添加了错误处理和日志
- 确保离线缓存功能正常工作

### Q6: 离线缓存时出现 "currentSourceCode is not defined" 错误

**问题原因**：
这是由于 `startEpisodeCache` 函数中使用了未定义的 `currentSourceCode` 变量导致的。

**解决方案**：
1. 确保已更新到最新版本（v3.2.0 或更高）
2. 清除浏览器缓存并刷新页面
3. 重新尝试缓存视频

**技术细节**：
- 已添加 `currentSourceCode` 全局变量定义
- 在 `initializePageContent` 中设置 `currentSourceCode` 值
- 修复了 `startEpisodeCache` 中的变量引用错误
- 添加了调试日志输出 `currentSourceCode` 值

### Q7: ArtPlayer 初始化错误 "Cannot read properties of null (reading '$parent')"

**问题原因**：
这是由于播放器容器元素不存在或初始化时机问题导致的。

**解决方案**：
1. 确保已更新到最新版本（v3.2.0 或更高）
2. 清除浏览器缓存并刷新页面
3. 检查播放器容器是否正常加载

**技术细节**：
- 已添加播放器容器存在性检查
- 添加了播放器初始化错误处理
- 改进了调试日志输出
- 防止 ArtPlayer 初始化失败导致页面崩溃
- 清空播放器容器内容，避免初始化冲突

### Q8: 离线缓存时出现 HTTP 500 错误

**问题原因**：
这是由于 Cloudflare Pages 的代理功能不可用或配置不正确导致的。

**解决方案**：
1. 确保已更新到最新版本（v3.2.0 或更高）
2. 清除浏览器缓存并刷新页面
3. 重新尝试缓存视频

**技术细节**：
- 已添加代理请求失败的备用直接请求方案
- 改进了 `parseM3u8AndGetSegments` 的错误处理
- 添加了详细的调试日志输出
- 当代理失败时自动尝试直接请求
- 确保离线缓存功能在各种环境下都能正常工作

### Q9: 浏览器控制台显示 "Ignored attempt to cancel a touchmove event" 警告

**问题原因**：
这是由于在 `touchend` 事件中尝试阻止默认行为，但是该事件的 `cancelable` 属性为 `false`。

**解决方案**：
1. 确保已更新到最新版本（v3.2.0 或更高）
2. 清除浏览器缓存并刷新页面

**技术细节**：
- 已修复 `touchend` 事件的 `cancelable` 检查
- 只在可以取消的情况下阻止默认行为
- 避免浏览器警告

## 技术细节

### Service Worker 缓存策略

- **缓存版本**：`libretv-v3.2.0`
- **VERSION.txt**：不缓存，每次都从服务器获取最新版本
- **其他静态资源**：使用缓存优先策略

### 播放器初始化流程

1. 检查密码验证状态
2. 解析 URL 参数
3. 初始化播放器
4. 加载视频
5. 显示播放器界面

### 密码验证逻辑

- 检查 `window.__ENV__.PASSWORD` 是否设置
- 验证用户输入的密码哈希是否匹配
- 保存验证状态到 localStorage

## 联系支持

如果问题仍然存在，请提供以下信息：

1. 浏览器类型和版本
2. 操作系统
3. 浏览器控制台的错误日志
4. Cloudflare 部署状态截图

---

**最后更新**：2026-04-25
**修复版本**：v3.2.0
**部署平台**：Cloudflare Pages