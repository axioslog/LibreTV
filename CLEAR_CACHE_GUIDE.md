# LibreTV Service Worker 缓存清除指南

## 🚨 紧急问题

您遇到的错误：
```
ERR_FAILED
The FetchEvent for "https://libretv-6gq.pages.dev/watch.html?..." resulted in a network error response: a redirected response was used for a request whose redirect mode is not "follow".
```

**根本原因**：您的浏览器仍在使用旧的 Service Worker 缓存，新的修复还没有生效。

## 🔧 立即解决方案

### 方法 1：通过浏览器开发者工具清除（推荐）

#### 第一步：打开开发者工具
1. 按 `F12` 键打开开发者工具
2. 或者右键点击页面，选择"检查"

#### 第二步：进入 Application 标签
1. 在开发者工具中，点击 "Application" 或 "应用程序" 标签
2. 在左侧菜单中找到 "Service Workers"

#### 第三步：注销 Service Worker
1. 在 Service Workers 列表中，找到 "libretv-6gq.pages.dev" 或类似的条目
2. 点击 "Unregister" 或 "注销" 按钮
3. 确认注销

#### 第四步：清除站点数据
1. 在左侧菜单中找到 "Storage" > "Clear site data"
2. 点击 "Clear site data" 按钮
3. 确认清除

#### 第五步：强制刷新页面
1. 关闭开发者工具
2. 按 `Ctrl + Shift + R`（Windows）或 `Cmd + Shift + R`（Mac）强制刷新
3. 重新访问网站

### 方法 2：通过浏览器设置清除

#### Chrome/Edge 浏览器
1. 点击浏览器右上角的三个点菜单
2. 选择"设置" > "隐私和安全" > "清除浏览数据"
3. 选择"时间范围"为"所有时间"
4. 勾选"缓存的图片和文件"
5. 点击"清除数据"

#### Firefox 浏览器
1. 点击浏览器右上角的三个横线菜单
2. 选择"选项" > "隐私与安全"
3. 点击"清除数据"
4. 选择"时间范围"为"全部"
5. 勾选"缓存"
6. 点击"立即清除"

#### Safari 浏览器
1. 点击 Safari 菜单 > "偏好设置"
2. 选择"隐私"标签
3. 点击"管理网站数据"
4. 找到 "libretv-6gq.pages.dev"
5. 点击"移除"

### 方法 3：使用无痕模式测试

如果上述方法仍然无法解决问题，可以尝试使用无痕模式：

1. 按 `Ctrl + Shift + N`（Chrome/Edge）或 `Cmd + Shift + N`（Safari）打开无痕窗口
2. 访问 LibreTV 网站
3. 测试功能是否正常

## 📋 验证步骤

清除缓存后，请按照以下步骤验证：

### 第一步：检查 Service Worker 状态
1. 按 `F12` 打开开发者工具
2. 进入 "Application" > "Service Workers"
3. 确认没有旧的 Service Worker 在运行

### 第二步：测试播放器功能
1. 访问首页
2. 搜索一个视频
3. 点击播放按钮
4. 观察是否能正常跳转到播放器

### 第三步：检查控制台错误
1. 按 `F12` 打开开发者工具
2. 进入 "Console" 标签
3. 查看是否还有重定向错误

## 🎯 预期结果

清除缓存后，应该看到：

- ✅ 播放器能正常加载
- ✅ 没有重定向错误
- ✅ 没有控制台错误
- ✅ 视频能正常播放

## 🚨 如果问题仍然存在

如果清除缓存后问题仍然存在，请：

1. **确认 Cloudflare 部署完成**：
   - 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - 进入 Pages 服务
   - 查看最新部署状态（应该显示 Commit: `448bf56`）

2. **尝试其他浏览器**：
   - 使用 Chrome、Firefox、Edge 等不同浏览器测试
   - 确认问题是否是浏览器特定的

3. **提供错误日志**：
   - 按 `F12` 打开开发者工具
   - 进入 "Console" 标签
   - 复制所有错误信息
   - 发送给我进行分析

## 📝 技术细节

### Service Worker 版本
- **当前版本**: `libretv-v3.2.0`
- **最新修复**: 为 `watch.html` 和 `player.html` 添加了特殊处理
- **修复内容**: 不使用缓存，直接请求并设置正确的重定向模式

### 修复代码
```javascript
// 对于 watch.html 和 player.html，不使用缓存，直接请求
if (url.pathname === '/watch.html' || url.pathname === '/player.html') {
    event.respondWith(fetch(event.request, { redirect: 'follow' }));
    return;
}
```

## ⏰ 时间线

- **修复时间**: 2026-04-25 17:30
- **部署时间**: 预计 5-10 分钟
- **缓存清除时间**: 立即执行
- **测试时间**: 缓存清除后立即测试

---

**清除指南创建时间**: 2026-04-25 17:40
**问题状态**: 等待用户清除缓存后验证