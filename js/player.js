const selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '[]');
const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

// 改进返回功能
function goBack(event) {
    // 防止默认链接行为
    if (event) event.preventDefault();
    
    // 1. 优先检查URL参数中的returnUrl
    const urlParams = new URLSearchParams(window.location.search);
    const returnUrl = urlParams.get('returnUrl');
    
    if (returnUrl) {
        // 如果URL中有returnUrl参数，优先使用
        window.location.href = decodeURIComponent(returnUrl);
        return;
    }
    
    // 2. 检查localStorage中保存的lastPageUrl
    const lastPageUrl = localStorage.getItem('lastPageUrl');
    if (lastPageUrl && lastPageUrl !== window.location.href) {
        window.location.href = lastPageUrl;
        return;
    }
    
    // 3. 检查是否是从搜索页面进入的播放器
    const referrer = document.referrer;
    
    // 检查 referrer 是否包含搜索参数
    if (referrer && (referrer.includes('/s=') || referrer.includes('?s='))) {
        // 如果是从搜索页面来的，返回到搜索页面
        window.location.href = referrer;
        return;
    }
    
    // 4. 如果是在iframe中打开的，尝试关闭iframe
    if (window.self !== window.top) {
        try {
            // 尝试调用父窗口的关闭播放器函数
            window.parent.closeVideoPlayer && window.parent.closeVideoPlayer();
            return;
        } catch (e) {
            console.error('调用父窗口closeVideoPlayer失败:', e);
        }
    }
    
    // 5. 无法确定上一页，则返回首页
    if (!referrer || referrer === '') {
        window.location.href = '/';
        return;
    }
    
    // 6. 以上都不满足，使用默认行为：返回上一页
    window.history.back();
}

// 页面加载时保存当前URL到localStorage，作为返回目标
window.addEventListener('load', function () {
    // 保存前一页面URL
    if (document.referrer && document.referrer !== window.location.href) {
        localStorage.setItem('lastPageUrl', document.referrer);
    }

    // 提取当前URL中的重要参数，以便在需要时能够恢复当前页面
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('id');
    const sourceCode = urlParams.get('source');

    if (videoId && sourceCode) {
        // 保存当前播放状态，以便其他页面可以返回
        localStorage.setItem('currentPlayingId', videoId);
        localStorage.setItem('currentPlayingSource', sourceCode);
    }
});


// =================================
// ============== PLAYER ==========
// =================================
// 全局变量
let currentVideoTitle = '';
let currentEpisodeIndex = 0;
let art = null; // 用于 ArtPlayer 实例
let currentHls = null; // 跟踪当前HLS实例
let currentEpisodes = [];
let episodesReversed = false;
let autoplayEnabled = true; // 默认开启自动连播
let videoHasEnded = false; // 跟踪视频是否已经自然结束
let userClickedPosition = null; // 记录用户点击的位置
let shortcutHintTimeout = null; // 用于控制快捷键提示显示时间
let adFilteringEnabled = true; // 默认开启广告过滤
let progressSaveInterval = null; // 定期保存进度的计时器
let currentVideoUrl = ''; // 记录当前实际的视频URL
let speedMonitorData = { bytes: 0, startTime: 0, lastSpeed: 0, speeds: [], timer: null }; // 下载速度监控数据
const isWebkit = (typeof window.webkitConvertPointFromNodeToPage === 'function')
Artplayer.FULLSCREEN_WEB_IN_BODY = true;

// 页面加载
document.addEventListener('DOMContentLoaded', function () {
    // 先检查用户是否已通过密码验证
    if (!isPasswordVerified()) {
        // 隐藏加载提示
        document.getElementById('player-loading').style.display = 'none';
        return;
    }

    initializePageContent();
});

// 监听密码验证成功事件
document.addEventListener('passwordVerified', () => {
    document.getElementById('player-loading').style.display = 'block';

    initializePageContent();
});

// 初始化页面内容
function initializePageContent() {

    // 解析URL参数
    const urlParams = new URLSearchParams(window.location.search);
    
    const offlineMode = urlParams.get('offline');
    if (offlineMode === 'true') {
        const offlineId = urlParams.get('id');
        const offlineTitle = urlParams.get('title') || '离线视频';
        if (offlineId) {
            currentVideoTitle = offlineTitle;
            document.getElementById('videoTitle').textContent = offlineTitle;
            document.title = offlineTitle + ' - LibreTV播放器';
            waitForServiceWorker().then(() => {
                playOfflineById(offlineId);
            });
            return;
        }
    }
    
    let videoUrl = urlParams.get('url');
    const title = urlParams.get('title');
    const sourceCode = urlParams.get('source');
    let index = parseInt(urlParams.get('index') || '0');
    const episodesList = urlParams.get('episodes'); // 从URL获取集数信息
    const savedPosition = parseInt(urlParams.get('position') || '0'); // 获取保存的播放位置
    // 解决历史记录问题：检查URL是否是player.html开头的链接
    // 如果是，说明这是历史记录重定向，需要解析真实的视频URL
    if (videoUrl && videoUrl.includes('player.html')) {
        try {
            // 尝试从嵌套URL中提取真实的视频链接
            const nestedUrlParams = new URLSearchParams(videoUrl.split('?')[1]);
            // 从嵌套参数中获取真实视频URL
            const nestedVideoUrl = nestedUrlParams.get('url');
            // 检查嵌套URL是否包含播放位置信息
            const nestedPosition = nestedUrlParams.get('position');
            const nestedIndex = nestedUrlParams.get('index');
            const nestedTitle = nestedUrlParams.get('title');

            if (nestedVideoUrl) {
                videoUrl = nestedVideoUrl;

                // 更新当前URL参数
                const url = new URL(window.location.href);
                if (!urlParams.has('position') && nestedPosition) {
                    url.searchParams.set('position', nestedPosition);
                }
                if (!urlParams.has('index') && nestedIndex) {
                    url.searchParams.set('index', nestedIndex);
                }
                if (!urlParams.has('title') && nestedTitle) {
                    url.searchParams.set('title', nestedTitle);
                }
                // 替换当前URL
                window.history.replaceState({}, '', url);
            } else {
                showError('历史记录链接无效，请返回首页重新访问');
            }
        } catch (e) {
        }
    }

    // 保存当前视频URL
    currentVideoUrl = videoUrl || '';

    // 从localStorage获取数据
    currentVideoTitle = title || localStorage.getItem('currentVideoTitle') || '未知视频';
    currentEpisodeIndex = index;

    // 设置自动连播开关状态
    autoplayEnabled = localStorage.getItem('autoplayEnabled') !== 'false'; // 默认为true
    document.getElementById('autoplayToggle').checked = autoplayEnabled;

    // 获取广告过滤设置
    adFilteringEnabled = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true

    // 监听自动连播开关变化
    document.getElementById('autoplayToggle').addEventListener('change', function (e) {
        autoplayEnabled = e.target.checked;
        localStorage.setItem('autoplayEnabled', autoplayEnabled);
    });

    // 优先使用URL传递的集数信息，否则从localStorage获取
    try {
        if (episodesList) {
            // 如果URL中有集数数据，优先使用它
            currentEpisodes = JSON.parse(decodeURIComponent(episodesList));

        } else {
            // 否则从localStorage获取
            currentEpisodes = JSON.parse(localStorage.getItem('currentEpisodes') || '[]');

        }

        // 检查集数索引是否有效，如果无效则调整为0
        if (index < 0 || (currentEpisodes.length > 0 && index >= currentEpisodes.length)) {
            // 如果索引太大，则使用最大有效索引
            if (index >= currentEpisodes.length && currentEpisodes.length > 0) {
                index = currentEpisodes.length - 1;
            } else {
                index = 0;
            }

            // 更新URL以反映修正后的索引
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('index', index);
            window.history.replaceState({}, '', newUrl);
        }

        // 更新当前索引为验证过的值
        currentEpisodeIndex = index;

        episodesReversed = localStorage.getItem('episodesReversed') === 'true';
    } catch (e) {
        currentEpisodes = [];
        currentEpisodeIndex = 0;
        episodesReversed = false;
    }

    // 设置页面标题
    document.title = currentVideoTitle + ' - LibreTV播放器';
    document.getElementById('videoTitle').textContent = currentVideoTitle;

    // 初始化播放器
    if (videoUrl) {
        initPlayer(videoUrl);
    } else {
        showError('无效的视频链接');
    }

    // 渲染源信息
    renderResourceInfoBar();

    // 更新集数信息
    updateEpisodeInfo();

    // 渲染集数列表
    renderEpisodes();

    // 更新按钮状态
    updateButtonStates();

    // 更新排序按钮状态
    updateOrderButton();

    // 添加对进度条的监听，确保点击准确跳转
    setTimeout(() => {
        setupProgressBarPreciseClicks();
    }, 1000);

    // 添加键盘快捷键事件监听
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // 添加页面离开事件监听，保存播放位置
    window.addEventListener('beforeunload', saveCurrentProgress);

    // 新增：页面隐藏（切后台/切标签）时也保存
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            saveCurrentProgress();
        }
    });

    // 视频暂停时也保存
    const waitForVideo = setInterval(() => {
        if (art && art.video) {
            art.video.addEventListener('pause', saveCurrentProgress);

            // 新增：播放进度变化时节流保存
            let lastSave = 0;
            art.video.addEventListener('timeupdate', function() {
                const now = Date.now();
                if (now - lastSave > 5000) { // 每5秒最多保存一次
                    saveCurrentProgress();
                    lastSave = now;
                }
            });

            clearInterval(waitForVideo);
        }
    }, 200);
}

// 处理键盘快捷键
function handleKeyboardShortcuts(e) {
    // 忽略输入框中的按键事件
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
        if (currentEpisodeIndex > 0) {
            playPreviousEpisode();
            showShortcutHint('上一集', 'left');
            e.preventDefault();
        }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
        if (currentEpisodeIndex < currentEpisodes.length - 1) {
            playNextEpisode();
            showShortcutHint('下一集', 'right');
            e.preventDefault();
        }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
        if (art && art.currentTime > 5) {
            art.currentTime -= 5;
            showShortcutHint('快退', 'left');
            e.preventDefault();
        }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
        if (art && art.currentTime < art.duration - 5) {
            art.currentTime += 5;
            showShortcutHint('快进', 'right');
            e.preventDefault();
        }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
        if (art && art.volume < 1) {
            art.volume += 0.1;
            showShortcutHint('音量+', 'up');
            e.preventDefault();
        }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
        if (art && art.volume > 0) {
            art.volume -= 0.1;
            showShortcutHint('音量-', 'down');
            e.preventDefault();
        }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
        if (art) {
            art.toggle();
            showShortcutHint('播放/暂停', 'play');
            e.preventDefault();
        }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
        if (art) {
            art.fullscreen = !art.fullscreen;
            showShortcutHint('切换全屏', 'fullscreen');
            e.preventDefault();
        }
    }
}

// 显示快捷键提示
function showShortcutHint(text, direction) {
    const hintElement = document.getElementById('shortcutHint');
    const textElement = document.getElementById('shortcutText');
    const iconElement = document.getElementById('shortcutIcon');

    // 清除之前的超时
    if (shortcutHintTimeout) {
        clearTimeout(shortcutHintTimeout);
    }

    // 设置文本和图标方向
    textElement.textContent = text;

    if (direction === 'left') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>';
    } else if (direction === 'right') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
    }  else if (direction === 'up') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path>';
    } else if (direction === 'down') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>';
    } else if (direction === 'fullscreen') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"></path>';
    } else if (direction === 'play') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"></path>';
    }

    // 显示提示
    hintElement.classList.add('show');

    // 两秒后隐藏
    shortcutHintTimeout = setTimeout(() => {
        hintElement.classList.remove('show');
    }, 2000);
}

// 启动下载速度监控
function startSpeedMonitor() {
    stopSpeedMonitor();
    speedMonitorData.bytes = 0;
    speedMonitorData.startTime = Date.now();
    speedMonitorData.speeds = [];
    speedMonitorData.lastSpeed = 0;
    speedMonitorData.timer = setInterval(() => {
        updateSpeedDisplay();
    }, 1000);
}

function stopSpeedMonitor() {
    if (speedMonitorData.timer) {
        clearInterval(speedMonitorData.timer);
        speedMonitorData.timer = null;
    }
}

function formatDownloadSpeed(mbps) {
    if (mbps <= 0) return '0 Mbps';
    if (mbps < 1) return (mbps * 1000).toFixed(0) + ' Kbps';
    if (mbps >= 1000) return (mbps / 1000).toFixed(1) + ' Gbps';
    return mbps.toFixed(1) + ' Mbps';
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getSpeedColor(mbps) {
    if (mbps >= 10) return '#00ff88';
    if (mbps >= 5) return '#88ff00';
    if (mbps >= 2) return '#ffcc00';
    if (mbps >= 0.5) return '#ff8800';
    return '#ff3333';
}

function updateSpeedDisplay() {
    let speedEl = document.getElementById('speedMonitor');
    if (!speedEl) {
        speedEl = document.createElement('div');
        speedEl.id = 'speedMonitor';
        speedEl.className = 'speed-monitor';
        const playerContainer = document.getElementById('playerContainer');
        if (playerContainer) {
            playerContainer.appendChild(speedEl);
        }
    }
    const speed = speedMonitorData.lastSpeed;
    const totalBytes = speedMonitorData.bytes;
    const color = getSpeedColor(speed);
    speedEl.innerHTML = `<span class="speed-value" style="color:${color}">${formatDownloadSpeed(speed)}</span><span class="speed-total">${formatBytes(totalBytes)}</span>`;
}

// 初始化播放器
function initPlayer(videoUrl, options = {}) {
    if (!videoUrl) {
        return
    }
    const isOffline = options.isOffline || false;

    // 销毁旧实例
    if (art) {
        art.destroy();
        art = null;
    }
    stopSpeedMonitor();

    // 配置HLS.js选项
    const hlsConfig = {
        debug: false,
        loader: (adFilteringEnabled && !isOffline) ? CustomHlsJsLoader : Hls.DefaultConfig.loader,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        fragLoadingMaxRetry: 6,
        fragLoadingMaxRetryTimeout: 64000,
        fragLoadingRetryDelay: 1000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        abrMaxWithRealBitrate: true,
        stretchShortVideoTrack: true,
        appendErrorMaxRetry: 5,  // 增加尝试次数
        liveSyncDurationCount: 3,
        liveDurationInfinity: false
    };

    // Create new ArtPlayer instance
    art = new Artplayer({
        container: '#player',
        url: videoUrl,
        type: 'm3u8',
        title: videoTitle,
        volume: 0.8,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: true,
        screenshot: true,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: false,
        airplay: false,
        hotkey: false,
        theme: '#23ade5',
        lang: navigator.language.toLowerCase(),
        moreVideoAttr: {
            crossOrigin: 'anonymous',
        },
        controls: [
            {
                position: 'right',
                html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>',
                tooltip: '离线缓存',
                click: function () {
                    showOfflineModal();
                },
            },
            {
                position: 'right',
                html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>',
                tooltip: '投屏',
                click: function () {
                    showCastModal();
                },
            },
        ],
        customType: {
            m3u8: function (video, url) {
                // 清理之前的HLS实例
                if (currentHls && currentHls.destroy) {
                    try {
                        currentHls.destroy();
                    } catch (e) {
                    }
                }

                // 创建新的HLS实例
                const hls = new Hls(hlsConfig);
                currentHls = hls;

                // 跟踪是否已经显示错误
                let errorDisplayed = false;
                // 跟踪是否有错误发生
                let errorCount = 0;
                // 跟踪视频是否开始播放
                let playbackStarted = false;
                // 跟踪视频是否出现bufferAppendError
                let bufferAppendErrorCount = 0;

                // 监听视频播放事件
                video.addEventListener('playing', function () {
                    playbackStarted = true;
                    document.getElementById('player-loading').style.display = 'none';
                    document.getElementById('error').style.display = 'none';
                });

                // 监听视频进度事件
                video.addEventListener('timeupdate', function () {
                    if (video.currentTime > 1) {
                        // 视频进度超过1秒，隐藏错误（如果存在）
                        document.getElementById('error').style.display = 'none';
                    }
                });

                hls.loadSource(url);
                hls.attachMedia(video);

                // enable airplay, from https://github.com/video-dev/hls.js/issues/5989
                // 检查是否已存在source元素，如果存在则更新，不存在则创建
                let sourceElement = video.querySelector('source');
                if (sourceElement) {
                    // 更新现有source元素的URL
                    sourceElement.src = videoUrl;
                } else {
                    // 创建新的source元素
                    sourceElement = document.createElement('source');
                    sourceElement.src = videoUrl;
                    video.appendChild(sourceElement);
                }
                video.disableRemotePlayback = false;

                hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    video.play().catch(e => {
                    });
                    startSpeedMonitor();
                });

                hls.on(Hls.Events.ERROR, function (event, data) {
                    // 增加错误计数
                    errorCount++;

                    // 处理bufferAppendError
                    if (data.details === 'bufferAppendError') {
                        bufferAppendErrorCount++;
                        // 如果视频已经开始播放，则忽略这个错误
                        if (playbackStarted) {
                            return;
                        }

                        // 如果出现多次bufferAppendError但视频未播放，尝试恢复
                        if (bufferAppendErrorCount >= 3) {
                            hls.recoverMediaError();
                        }
                    }

                    // 如果是致命错误，且视频未播放
                    if (data.fatal && !playbackStarted) {
                        // 尝试恢复错误
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                hls.recoverMediaError();
                                break;
                            default:
                                // 仅在多次恢复尝试后显示错误
                                if (errorCount > 3 && !errorDisplayed) {
                                    errorDisplayed = true;
                                    showError('视频加载失败，可能是格式不兼容或源不可用');
                                }
                                break;
                        }
                    }
                });

                // 监听分段加载事件
                hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
                    document.getElementById('player-loading').style.display = 'none';
                    if (data && data.frag && data.frag.stats) {
                        const stats = data.frag.stats;
                        const fragBytes = stats.total || 0;
                        const loadDuration = (stats.loading && stats.loading.end && stats.loading.start) 
                            ? (stats.loading.end - stats.loading.start) / 1000 
                            : 0;
                        speedMonitorData.bytes += fragBytes;
                        if (loadDuration > 0) {
                            const fragSpeed = (fragBytes * 8) / (loadDuration * 1000000);
                            speedMonitorData.speeds.push(fragSpeed);
                            if (speedMonitorData.speeds.length > 10) speedMonitorData.speeds.shift();
                            const avgSpeed = speedMonitorData.speeds.reduce((a, b) => a + b, 0) / speedMonitorData.speeds.length;
                            speedMonitorData.lastSpeed = avgSpeed;
                        }
                    }
                    updateSpeedDisplay();
                });

                // 监听级别加载事件
                hls.on(Hls.Events.LEVEL_LOADED, function () {
                    document.getElementById('player-loading').style.display = 'none';
                });
            }
        }
    });

    // artplayer 没有 'fullscreenWeb:enter', 'fullscreenWeb:exit' 等事件
    // 所以原控制栏隐藏代码并没有起作用
    // 实际起作用的是 artplayer 默认行为，它支持自动隐藏工具栏
    // 但有一个 bug： 在副屏全屏时，鼠标移出副屏后不会自动隐藏工具栏
    // 下面进一并重构和修复：
    let hideTimer;

    // 隐藏控制栏
    function hideControls() {
        if (art && art.controls) {
            art.controls.show = false;
        }
    }

    // 重置计时器，计时器超时时间与 artplayer 保持一致
    function resetHideTimer() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideControls();
        }, Artplayer.CONTROL_HIDE_TIME);
    }

    // 处理鼠标离开浏览器窗口
    function handleMouseOut(e) {
        if (e && !e.relatedTarget) {
            resetHideTimer();
        }
    }

    // 全屏状态切换时注册/移除 mouseout 事件，监听鼠标移出屏幕事件
    // 从而对播放器状态栏进行隐藏倒计时
    function handleFullScreen(isFullScreen, isWeb) {
        if (isFullScreen) {
            document.addEventListener('mouseout', handleMouseOut);
        } else {
            document.removeEventListener('mouseout', handleMouseOut);
            // 退出全屏时清理计时器
            clearTimeout(hideTimer);
        }

        if (!isWeb) {
            if (window.screen.orientation && window.screen.orientation.lock) {
                window.screen.orientation.lock('landscape')
                    .then(() => {
                    })
                    .catch((error) => {
                    });
            }
        }
    }

    // 播放器加载完成后初始隐藏工具栏
    art.on('ready', () => {
        hideControls();
    });

    // 全屏 Web 模式处理
    art.on('fullscreenWeb', function (isFullScreen) {
        handleFullScreen(isFullScreen, true);
    });

    // 全屏模式处理
    art.on('fullscreen', function (isFullScreen) {
        handleFullScreen(isFullScreen, false);
    });

    art.on('video:loadedmetadata', function() {
        document.getElementById('player-loading').style.display = 'none';
        videoHasEnded = false; // 视频加载时重置结束标志
        // 优先使用URL传递的position参数
        const urlParams = new URLSearchParams(window.location.search);
        const savedPosition = parseInt(urlParams.get('position') || '0');

        if (savedPosition > 10 && savedPosition < art.duration - 2) {
            // 如果URL中有有效的播放位置参数，直接使用它
            art.currentTime = savedPosition;
            showPositionRestoreHint(savedPosition);
        } else {
            // 否则尝试从本地存储恢复播放进度
            try {
                const progressKey = 'videoProgress_' + getVideoId();
                const progressStr = localStorage.getItem(progressKey);
                if (progressStr && art.duration > 0) {
                    const progress = JSON.parse(progressStr);
                    if (
                        progress &&
                        typeof progress.position === 'number' &&
                        progress.position > 10 &&
                        progress.position < art.duration - 2
                    ) {
                        art.currentTime = progress.position;
                        showPositionRestoreHint(progress.position);
                    }
                }
            } catch (e) {
            }
        }

        // 设置进度条点击监听
        setupProgressBarPreciseClicks();

        // 视频加载成功后，在稍微延迟后将其添加到观看历史
        setTimeout(saveToHistory, 3000);

        // 启动定期保存播放进度
        startProgressSaveInterval();
    })

    // 错误处理
    art.on('video:error', function (error) {
        // 如果正在切换视频，忽略错误
        if (window.isSwitchingVideo) {
            return;
        }

        // 隐藏所有加载指示器
        const loadingElements = document.querySelectorAll('#player-loading, .player-loading-container');
        loadingElements.forEach(el => {
            if (el) el.style.display = 'none';
        });

        showError('视频播放失败: ' + (error.message || '未知错误'));
    });

    // 添加移动端长按三倍速播放功能
    setupLongPressSpeedControl();

    // 视频播放结束事件
    art.on('video:ended', function () {
        videoHasEnded = true;

        clearVideoProgress();

        // 如果自动播放下一集开启，且确实有下一集
        if (autoplayEnabled && currentEpisodeIndex < currentEpisodes.length - 1) {
            // 稍长延迟以确保所有事件处理完成
            setTimeout(() => {
                // 确认不是因为用户拖拽导致的假结束事件
                playNextEpisode();
                videoHasEnded = false; // 重置标志
            }, 1000);
        } else {
            art.fullscreen = false;
        }
    });

    // 添加双击全屏支持
    art.on('video:playing', () => {
        // 绑定双击事件到视频容器
        if (art.video) {
            art.video.addEventListener('dblclick', () => {
                art.fullscreen = !art.fullscreen;
                art.play();
            });
        }
        setupSwipeSeek();
    });

    // 10秒后如果仍在加载，但不立即显示错误
    setTimeout(function () {
        // 如果视频已经播放开始，则不显示错误
        if (art && art.video && art.video.currentTime > 0) {
            return;
        }

        const loadingElement = document.getElementById('player-loading');
        if (loadingElement && loadingElement.style.display !== 'none') {
            loadingElement.innerHTML = `
                <div class="loading-spinner"></div>
                <div>视频加载时间较长，请耐心等待...</div>
                <div style="font-size: 12px; color: #aaa; margin-top: 10px;">如长时间无响应，请尝试其他视频源</div>
            `;
        }
    }, 10000);
}

// 自定义M3U8 Loader用于过滤广告
class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
            // 拦截manifest和level请求
            if (context.type === 'manifest' || context.type === 'level') {
                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = function (response, stats, context) {
                    // 如果是m3u8文件，处理内容以移除广告分段
                    if (response.data && typeof response.data === 'string') {
                        // 过滤掉广告段 - 实现更精确的广告过滤逻辑
                        response.data = filterAdsFromM3U8(response.data, true);
                    }
                    return onSuccess(response, stats, context);
                };
            }
            // 执行原始load方法
            load(context, config, callbacks);
        };
    }
}

// 过滤可疑的广告内容
function filterAdsFromM3U8(m3u8Content, strictMode = false) {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 只过滤#EXT-X-DISCONTINUITY标识
        if (!line.includes('#EXT-X-DISCONTINUITY')) {
            filteredLines.push(line);
        }
    }

    return filteredLines.join('\n');
}


// 显示错误
function showError(message) {
    // 在视频已经播放的情况下不显示错误
    if (art && art.video && art.video.currentTime > 1) {
        return;
    }
    const loadingEl = document.getElementById('player-loading');
    if (loadingEl) loadingEl.style.display = 'none';
    const errorEl = document.getElementById('error');
    if (errorEl) errorEl.style.display = 'flex';
    const errorMsgEl = document.getElementById('error-message');
    if (errorMsgEl) errorMsgEl.textContent = message;
}

// 更新集数信息
function updateEpisodeInfo() {
    if (currentEpisodes.length > 0) {
        document.getElementById('episodeInfo').textContent = `第 ${currentEpisodeIndex + 1}/${currentEpisodes.length} 集`;
    } else {
        document.getElementById('episodeInfo').textContent = '无集数信息';
    }
}

// 更新按钮状态
function updateButtonStates() {
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');

    // 处理上一集按钮
    if (currentEpisodeIndex > 0) {
        prevButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        prevButton.removeAttribute('disabled');
    } else {
        prevButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        prevButton.setAttribute('disabled', '');
    }

    // 处理下一集按钮
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        nextButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        nextButton.removeAttribute('disabled');
    } else {
        nextButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        nextButton.setAttribute('disabled', '');
    }
}

// 渲染集数按钮
function renderEpisodes() {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;

    if (!currentEpisodes || currentEpisodes.length === 0) {
        episodesList.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">没有可用的集数</div>';
        return;
    }

    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    let html = '';

    episodes.forEach((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const isActive = realIndex === currentEpisodeIndex;

        html += `
            <button id="episode-${realIndex}" 
                    onclick="playEpisode(${realIndex})" 
                    class="px-4 py-2 ${isActive ? 'episode-active' : '!bg-[#222] hover:!bg-[#333] hover:!shadow-none'} !border ${isActive ? '!border-blue-500' : '!border-[#333]'} rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
    });

    episodesList.innerHTML = html;
}

// 播放指定集数
function playEpisode(index) {
    // 确保index在有效范围内
    if (index < 0 || index >= currentEpisodes.length) {
        return;
    }

    // 保存当前播放进度（如果正在播放）
    if (art && art.video && !art.video.paused && !videoHasEnded) {
        saveCurrentProgress();
    }

    // 清除进度保存计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }

    // 首先隐藏之前可能显示的错误
    document.getElementById('error').style.display = 'none';
    // 显示加载指示器
    document.getElementById('player-loading').style.display = 'flex';
    document.getElementById('player-loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>正在加载视频...</div>
    `;

    // 获取 sourceCode
    const urlParams2 = new URLSearchParams(window.location.search);
    const sourceCode = urlParams2.get('source_code');

    // 准备切换剧集的URL
    const url = currentEpisodes[index];

    // 更新当前剧集索引
    currentEpisodeIndex = index;
    currentVideoUrl = url;
    videoHasEnded = false; // 重置视频结束标志

    clearVideoProgress();

    // 更新URL参数（不刷新页面）
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('index', index);
    currentUrl.searchParams.set('url', url);
    currentUrl.searchParams.delete('position');
    window.history.replaceState({}, '', currentUrl.toString());

    if (isWebkit) {
        initPlayer(url);
    } else {
        art.switch = url;
    }

    // 更新UI
    updateEpisodeInfo();
    updateButtonStates();
    renderEpisodes();

    // 重置用户点击位置记录
    userClickedPosition = null;

    // 三秒后保存到历史记录
    setTimeout(() => saveToHistory(), 3000);
}

// 播放上一集
function playPreviousEpisode() {
    if (currentEpisodeIndex > 0) {
        playEpisode(currentEpisodeIndex - 1);
    }
}

// 播放下一集
function playNextEpisode() {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
    }
}

// 复制播放链接
function copyLinks() {
    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const linkUrl = urlParams.get('url') || '';
    if (linkUrl !== '') {
        navigator.clipboard.writeText(linkUrl).then(() => {
            showToast('播放链接已复制', 'success');
        }).catch(err => {
            showToast('复制失败，请检查浏览器权限', 'error');
        });
    }
}

// 切换集数排序
function toggleEpisodeOrder() {
    episodesReversed = !episodesReversed;

    // 保存到localStorage
    localStorage.setItem('episodesReversed', episodesReversed);

    // 重新渲染集数列表
    renderEpisodes();

    // 更新排序按钮
    updateOrderButton();
}

// 更新排序按钮状态
function updateOrderButton() {
    const orderText = document.getElementById('orderText');
    const orderIcon = document.getElementById('orderIcon');

    if (orderText && orderIcon) {
        orderText.textContent = episodesReversed ? '正序排列' : '倒序排列';
        orderIcon.style.transform = episodesReversed ? 'rotate(180deg)' : '';
    }
}

// 设置进度条准确点击处理
function setupProgressBarPreciseClicks() {
    // 查找DPlayer的进度条元素
    const progressBar = document.querySelector('.dplayer-bar-wrap');
    if (!progressBar || !art || !art.video) return;

    // 移除可能存在的旧事件监听器
    progressBar.removeEventListener('mousedown', handleProgressBarClick);

    // 添加新的事件监听器
    progressBar.addEventListener('mousedown', handleProgressBarClick);

    // 在移动端也添加触摸事件支持
    progressBar.removeEventListener('touchstart', handleProgressBarTouch);
    progressBar.addEventListener('touchstart', handleProgressBarTouch);

    // 处理进度条点击
    function handleProgressBarClick(e) {
        if (!art || !art.video) return;

        // 计算点击位置相对于进度条的比例
        const rect = e.currentTarget.getBoundingClientRect();
        const percentage = (e.clientX - rect.left) / rect.width;

        // 计算点击位置对应的视频时间
        const duration = art.video.duration;
        let clickTime = percentage * duration;

        // 处理视频接近结尾的情况
        if (duration - clickTime < 1) {
            // 如果点击位置非常接近结尾，稍微往前移一点
            clickTime = Math.min(clickTime, duration - 1.5);

        }

        // 记录用户点击的位置
        userClickedPosition = clickTime;

        // 阻止默认事件传播，避免DPlayer内部逻辑将视频跳至末尾
        e.stopPropagation();

        // 直接设置视频时间
        art.seek(clickTime);
    }

    // 处理移动端触摸事件
    function handleProgressBarTouch(e) {
        if (!art || !art.video || !e.touches[0]) return;

        const touch = e.touches[0];
        const rect = e.currentTarget.getBoundingClientRect();
        const percentage = (touch.clientX - rect.left) / rect.width;

        const duration = art.video.duration;
        let clickTime = percentage * duration;

        // 处理视频接近结尾的情况
        if (duration - clickTime < 1) {
            clickTime = Math.min(clickTime, duration - 1.5);
        }

        // 记录用户点击的位置
        userClickedPosition = clickTime;

        e.stopPropagation();
        art.seek(clickTime);
    }
}

// 在播放器初始化后添加视频到历史记录
function saveToHistory() {
    // 确保 currentEpisodes 非空且有当前视频URL
    if (!currentEpisodes || currentEpisodes.length === 0 || !currentVideoUrl) {
        return;
    }

    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const sourceName = urlParams.get('source') || '';
    const sourceCode = urlParams.get('source') || '';
    const id_from_params = urlParams.get('id'); // Get video ID from player URL (passed as 'id')

    // 获取当前播放进度
    let currentPosition = 0;
    let videoDuration = 0;

    if (art && art.video) {
        currentPosition = art.video.currentTime;
        videoDuration = art.video.duration;
    }

    // Define a show identifier: Prioritize sourceName_id, fallback to first episode URL or current video URL
    let show_identifier_for_video_info;
    if (sourceName && id_from_params) {
        show_identifier_for_video_info = `${sourceName}_${id_from_params}`;
    } else {
        show_identifier_for_video_info = (currentEpisodes && currentEpisodes.length > 0) ? currentEpisodes[0] : currentVideoUrl;
    }

    // 构建要保存的视频信息对象
    const videoInfo = {
        title: currentVideoTitle,
        directVideoUrl: currentVideoUrl, // Current episode's direct URL
        url: `player.html?url=${encodeURIComponent(currentVideoUrl)}&title=${encodeURIComponent(currentVideoTitle)}&source=${encodeURIComponent(sourceName)}&source_code=${encodeURIComponent(sourceCode)}&id=${encodeURIComponent(id_from_params || '')}&index=${currentEpisodeIndex}&position=${Math.floor(currentPosition || 0)}`,
        episodeIndex: currentEpisodeIndex,
        sourceName: sourceName,
        vod_id: id_from_params || '', // Store the ID from params as vod_id in history item
        sourceCode: sourceCode,
        showIdentifier: show_identifier_for_video_info, // Identifier for the show/series
        timestamp: Date.now(),
        playbackPosition: currentPosition,
        duration: videoDuration,
        episodes: currentEpisodes && currentEpisodes.length > 0 ? [...currentEpisodes] : []
    };
    
    try {
        const history = JSON.parse(localStorage.getItem('viewingHistory') || '[]');

        // 检查是否已经存在相同的系列记录 (基于标题、来源和 showIdentifier)
        const existingIndex = history.findIndex(item => 
            item.title === videoInfo.title && 
            item.sourceName === videoInfo.sourceName && 
            item.showIdentifier === videoInfo.showIdentifier
        );

        if (existingIndex !== -1) {
            // 存在则更新现有记录的当前集数、时间戳、播放进度和URL等
            const existingItem = history[existingIndex];
            existingItem.episodeIndex = videoInfo.episodeIndex;
            existingItem.timestamp = videoInfo.timestamp;
            existingItem.sourceName = videoInfo.sourceName; // Should be consistent, but update just in case
            existingItem.sourceCode = videoInfo.sourceCode;
            existingItem.vod_id = videoInfo.vod_id;
            
            // Update URLs to reflect the current episode being watched
            existingItem.directVideoUrl = videoInfo.directVideoUrl; // Current episode's direct URL
            existingItem.url = videoInfo.url; // Player link for the current episode

            // 更新播放进度信息
            existingItem.playbackPosition = videoInfo.playbackPosition > 10 ? videoInfo.playbackPosition : (existingItem.playbackPosition || 0);
            existingItem.duration = videoInfo.duration || existingItem.duration;
            
            // 更新集数列表（如果新的集数列表与存储的不同，例如集数增加了）
            if (videoInfo.episodes && videoInfo.episodes.length > 0) {
                if (!existingItem.episodes || 
                    !Array.isArray(existingItem.episodes) || 
                    existingItem.episodes.length !== videoInfo.episodes.length || 
                    !videoInfo.episodes.every((ep, i) => ep === existingItem.episodes[i])) { // Basic check for content change
                    existingItem.episodes = [...videoInfo.episodes]; // Deep copy
                }
            }
            
            // 移到最前面
            const updatedItem = history.splice(existingIndex, 1)[0];
            history.unshift(updatedItem);
        } else {
            // 添加新记录到最前面
            history.unshift(videoInfo);
        }

        // 限制历史记录数量为50条
        if (history.length > 50) history.splice(50);

        localStorage.setItem('viewingHistory', JSON.stringify(history));
    } catch (e) {
    }
}

// 显示恢复位置提示
function showPositionRestoreHint(position) {
    if (!position || position < 10) return;

    // 创建提示元素
    const hint = document.createElement('div');
    hint.className = 'position-restore-hint';
    hint.innerHTML = `
        <div class="hint-content">
            已从 ${formatTime(position)} 继续播放
        </div>
    `;

    // 添加到播放器容器
    const playerContainer = document.querySelector('.player-container'); // Ensure this selector is correct
    if (playerContainer) { // Check if playerContainer exists
        playerContainer.appendChild(hint);
    } else {
        return; // Exit if container not found
    }

    // 显示提示
    setTimeout(() => {
        hint.classList.add('show');

        // 3秒后隐藏
        setTimeout(() => {
            hint.classList.remove('show');
            setTimeout(() => hint.remove(), 300);
        }, 3000);
    }, 100);
}

// 格式化时间为 mm:ss 格式
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 开始定期保存播放进度
function startProgressSaveInterval() {
    // 清除可能存在的旧计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
    }

    // 每30秒保存一次播放进度
    progressSaveInterval = setInterval(saveCurrentProgress, 30000);
}

// 保存当前播放进度
function saveCurrentProgress() {
    if (!art || !art.video) return;
    const currentTime = art.video.currentTime;
    const duration = art.video.duration;
    if (!duration || currentTime < 1) return;

    // 在localStorage中保存进度
    const progressKey = `videoProgress_${getVideoId()}`;
    const progressData = {
        position: currentTime,
        duration: duration,
        timestamp: Date.now()
    };
    try {
        localStorage.setItem(progressKey, JSON.stringify(progressData));
        // --- 新增：同步更新 viewingHistory 中的进度 ---
        try {
            const historyRaw = localStorage.getItem('viewingHistory');
            if (historyRaw) {
                const history = JSON.parse(historyRaw);
                // 用 title + 集数索引唯一标识
                const idx = history.findIndex(item =>
                    item.title === currentVideoTitle &&
                    (item.episodeIndex === undefined || item.episodeIndex === currentEpisodeIndex)
                );
                if (idx !== -1) {
                    // 只在进度有明显变化时才更新，减少写入
                    if (
                        Math.abs((history[idx].playbackPosition || 0) - currentTime) > 2 ||
                        Math.abs((history[idx].duration || 0) - duration) > 2
                    ) {
                        history[idx].playbackPosition = currentTime;
                        history[idx].duration = duration;
                        history[idx].timestamp = Date.now();
                        localStorage.setItem('viewingHistory', JSON.stringify(history));
                    }
                }
            }
        } catch (e) {
        }
    } catch (e) {
    }
}

// 设置移动端长按三倍速播放功能
function setupLongPressSpeedControl() {
    if (!art || !art.video) return;

    const playerElement = document.getElementById('player');
    let longPressTimer = null;
    let originalPlaybackRate = 1.0;
    let isLongPress = false;

    // 显示快速提示
    function showSpeedHint(speed) {
        showShortcutHint(`${speed}倍速`, 'right');
    }

    // 禁用右键
    playerElement.oncontextmenu = () => {
        // 检测是否为移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // 只在移动设备上禁用右键
        if (isMobile) {
            const dplayerMenu = document.querySelector(".dplayer-menu");
            const dplayerMask = document.querySelector(".dplayer-mask");
            if (dplayerMenu) dplayerMenu.style.display = "none";
            if (dplayerMask) dplayerMask.style.display = "none";
            return false;
        }
        return true; // 在桌面设备上允许右键菜单
    };

    // 触摸开始事件
    playerElement.addEventListener('touchstart', function (e) {
        // 检查视频是否正在播放，如果没有播放则不触发长按功能
        if (art.video.paused) {
            return; // 视频暂停时不触发长按功能
        }

        // 保存原始播放速度
        originalPlaybackRate = art.video.playbackRate;

        // 设置长按计时器
        longPressTimer = setTimeout(() => {
            // 再次检查视频是否仍在播放
            if (art.video.paused) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                return;
            }

            // 长按超过500ms，设置为3倍速
            art.video.playbackRate = 3.0;
            isLongPress = true;
            showSpeedHint(3.0);

            // 只在确认为长按时阻止默认行为
            e.preventDefault();
        }, 500);
    }, { passive: false });

    // 触摸结束事件
    playerElement.addEventListener('touchend', function (e) {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            showSpeedHint(originalPlaybackRate);

            // 阻止长按后的点击事件
            e.preventDefault();
        }
        // 如果不是长按，则允许正常的点击事件（暂停/播放）
    });

    // 触摸取消事件
    playerElement.addEventListener('touchcancel', function () {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }
    });

    // 触摸移动事件 - 防止在长按时触发页面滚动
    playerElement.addEventListener('touchmove', function (e) {
        if (isLongPress) {
            e.preventDefault();
        }
    }, { passive: false });

    // 视频暂停时取消长按状态
    art.video.addEventListener('pause', function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }

        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

// 清除视频进度记录
function clearVideoProgress() {
    const progressKey = `videoProgress_${getVideoId()}`;
    try {
        localStorage.removeItem(progressKey);
    } catch (e) {
    }
}

// 获取视频唯一标识
function getVideoId() {
    // 使用视频标题和集数索引作为唯一标识
    // If currentVideoUrl is available and more unique, prefer it. Otherwise, fallback.
    if (currentVideoUrl) {
        return `${encodeURIComponent(currentVideoUrl)}`;
    }
    return `${encodeURIComponent(currentVideoTitle)}_${currentEpisodeIndex}`;
}

let controlsLocked = false;
function toggleControlsLock() {
    const container = document.getElementById('playerContainer');
    controlsLocked = !controlsLocked;
    container.classList.toggle('controls-locked', controlsLocked);
    const icon = document.getElementById('lockIcon');
    // 切换图标：锁 / 解锁
    icon.innerHTML = controlsLocked
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M12 15v2m0-8V7a4 4 0 00-8 0v2m8 0H4v8h16v-8H6v-6z\"/>'
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M15 11V7a3 3 0 00-6 0v4m-3 4h12v6H6v-6z\"/>';
}

// 支持在iframe中关闭播放器
function closeEmbeddedPlayer() {
    try {
        if (window.self !== window.top) {
            // 如果在iframe中，尝试调用父窗口的关闭方法
            if (window.parent && typeof window.parent.closeVideoPlayer === 'function') {
                window.parent.closeVideoPlayer();
                return true;
            }
        }
    } catch (e) {
        console.error('尝试关闭嵌入式播放器失败:', e);
    }
    return false;
}

function renderResourceInfoBar() {
    // 获取容器元素
    const container = document.getElementById('resourceInfoBarContainer');
    if (!container) {
        console.error('找不到资源信息卡片容器');
        return;
    }
    
    // 获取当前视频 source_code
    const urlParams = new URLSearchParams(window.location.search);
    const currentSource = urlParams.get('source') || '';
    
    // 显示临时加载状态
    container.innerHTML = `
      <div class="resource-info-bar-left flex">
        <span>加载中...</span>
        <span class="resource-info-bar-videos">-</span>
      </div>
      <button class="resource-switch-btn flex" id="switchResourceBtn" onclick="showSwitchResourceModal()">
        <span class="resource-switch-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v16m0 0l-6-6m6 6l6-6" stroke="#a67c2d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        切换资源
      </button>
    `;

    // 查找当前源名称，从 API_SITES 和 custom_api 中查找即可
    let resourceName = currentSource
    if (currentSource && API_SITES[currentSource]) {
        resourceName = API_SITES[currentSource].name;
    }
    if (resourceName === currentSource) {
        const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]');
        const customIndex = parseInt(currentSource.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            resourceName = customAPIs[customIndex].name || '自定义资源';
        }
    }

    container.innerHTML = `
      <div class="resource-info-bar-left flex">
        <span>${resourceName}</span>
        <span class="resource-info-bar-videos">${currentEpisodes.length} 个视频</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="source-refresh-btn" id="refreshSourceBtn" onclick="refreshAllSourceSpeeds()" title="测试所有源速度">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          测速
        </button>
        <button class="resource-switch-btn flex" id="switchResourceBtn" onclick="showSwitchResourceModal()">
          <span class="resource-switch-icon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v16m0 0l-6-6m6 6l6-6" stroke="#a67c2d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          切换资源
        </button>
      </div>
    `;
}

// 测试视频源速率的函数
async function testVideoSourceSpeed(sourceKey, vodId) {
    try {
        const startTime = performance.now();
        
        // 构建API参数
        let apiParams = '';
        if (sourceKey.startsWith('custom_')) {
            const customIndex = sourceKey.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                return { speed: -1, error: 'API配置无效' };
            }
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            apiParams = '&source=' + sourceKey;
        }
        
        // 添加时间戳防止缓存
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        
        // 获取视频详情
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`, {
            method: 'GET',
            cache: 'no-cache'
        });
        
        if (!response.ok) {
            return { speed: -1, error: '获取失败' };
        }
        
        const data = await response.json();
        
        if (!data.episodes || data.episodes.length === 0) {
            return { speed: -1, error: '无播放源' };
        }
        
        // 测试第一个播放链接的响应速度
        const firstEpisodeUrl = data.episodes[0];
        if (!firstEpisodeUrl) {
            return { speed: -1, error: '链接无效' };
        }
        
        // 测试视频链接响应时间
        const videoTestStart = performance.now();
        try {
            const videoResponse = await fetch(firstEpisodeUrl, {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-cache',
                signal: AbortSignal.timeout(5000) // 5秒超时
            });
            
            const videoTestEnd = performance.now();
            const totalTime = videoTestEnd - startTime;
            
            // 返回总响应时间（毫秒）
            return { 
                speed: Math.round(totalTime),
                episodes: data.episodes.length,
                error: null 
            };
        } catch (videoError) {
            // 如果视频链接测试失败，只返回API响应时间
            const apiTime = performance.now() - startTime;
            return { 
                speed: Math.round(apiTime),
                episodes: data.episodes.length,
                error: null,
                note: 'API响应' 
            };
        }
        
    } catch (error) {
        return { 
            speed: -1, 
            error: error.name === 'AbortError' ? '超时' : '测试失败' 
        };
    }
}

// 格式化速度显示
function formatSpeedDisplay(speedResult) {
    if (speedResult.speed === -1) {
        return `<span class="speed-indicator error">❌ ${speedResult.error}</span>`;
    }
    
    const speed = speedResult.speed;
    let className = 'speed-indicator good';
    let icon = '🟢';
    
    if (speed > 2000) {
        className = 'speed-indicator poor';
        icon = '🔴';
    } else if (speed > 1000) {
        className = 'speed-indicator medium';
        icon = '🟡';
    }
    
    const note = speedResult.note ? ` (${speedResult.note})` : '';
    return `<span class="${className}">${icon} ${speed}ms${note}</span>`;
}

async function showSwitchResourceModal() {
    const urlParams = new URLSearchParams(window.location.search);
    const currentSourceCode = urlParams.get('source');
    const currentVideoId = urlParams.get('id');

    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    modalTitle.innerHTML = `<span class="break-words">${currentVideoTitle}</span>`;
    modalContent.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在加载资源列表...</div>';
    modal.classList.remove('hidden');

    // 搜索
    const resourceOptions = selectedAPIs.map((curr) => {
        if (API_SITES[curr]) {
            return { key: curr, name: API_SITES[curr].name };
        }
        const customIndex = parseInt(curr.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            return { key: curr, name: customAPIs[customIndex].name || '自定义资源' };
        }
        return { key: curr, name: '未知资源' };
    });
    let allResults = {};
    await Promise.all(resourceOptions.map(async (opt) => {
        let queryResult = await searchByAPIAndKeyWord(opt.key, currentVideoTitle);
        if (queryResult.length == 0) {
            return 
        }
        // 优先取完全同名资源，否则默认取第一个
        let result = queryResult[0]
        queryResult.forEach((res) => {
            if (res.vod_name == currentVideoTitle) {
                result = res;
            }
        })
        allResults[opt.key] = result;
    }));

    // 更新状态显示：开始速率测试
    modalContent.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在测试各资源速率...</div>';

    // 同时测试所有资源的速率
    const speedResults = {};
    await Promise.all(Object.entries(allResults).map(async ([sourceKey, result]) => {
        if (result) {
            speedResults[sourceKey] = await testVideoSourceSpeed(sourceKey, result.vod_id);
        }
    }));

    // 对结果进行排序
    const sortedResults = Object.entries(allResults).sort(([keyA, resultA], [keyB, resultB]) => {
        // 当前播放的源放在最前面
        const isCurrentA = String(keyA) === String(currentSourceCode) && String(resultA.vod_id) === String(currentVideoId);
        const isCurrentB = String(keyB) === String(currentSourceCode) && String(resultB.vod_id) === String(currentVideoId);
        
        if (isCurrentA && !isCurrentB) return -1;
        if (!isCurrentA && isCurrentB) return 1;
        
        // 其余按照速度排序，速度快的在前面（速度为-1表示失败，排到最后）
        const speedA = speedResults[keyA]?.speed || 99999;
        const speedB = speedResults[keyB]?.speed || 99999;
        
        if (speedA === -1 && speedB !== -1) return 1;
        if (speedA !== -1 && speedB === -1) return -1;
        if (speedA === -1 && speedB === -1) return 0;
        
        return speedA - speedB;
    });

    // 渲染资源列表
    let html = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">';
    
    for (const [sourceKey, result] of sortedResults) {
        if (!result) continue;
        
        // 修复 isCurrentSource 判断，确保类型一致
        const isCurrentSource = String(sourceKey) === String(currentSourceCode) && String(result.vod_id) === String(currentVideoId);
        const sourceName = resourceOptions.find(opt => opt.key === sourceKey)?.name || '未知资源';
        const speedResult = speedResults[sourceKey] || { speed: -1, error: '未测试' };
        
        html += `
            <div class="relative group ${isCurrentSource ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105 transition-transform'}" 
                 ${!isCurrentSource ? `onclick="switchToResource('${sourceKey}', '${result.vod_id}')"` : ''}>
                <div class="aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 relative">
                    <img src="${result.vod_pic}" 
                         alt="${result.vod_name}"
                         class="w-full h-full object-cover"
                         onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48cGF0aCBkPSJNMjEgMTV2NGEyIDIgMCAwIDEtMiAySDVhMiAyIDAgMCAxLTItMnYtNCI+PC9wYXRoPjxwb2x5bGluZSBwb2ludHM9IjE3IDggMTIgMyA3IDgiPjwvcG9seWxpbmU+PHBhdGggZD0iTTEyIDN2MTIiPjwvcGF0aD48L3N2Zz4='">
                    
                    <!-- 速率显示在图片右上角 -->
                    <div class="absolute top-1 right-1 speed-badge bg-black bg-opacity-75">
                        ${formatSpeedDisplay(speedResult)}
                    </div>
                </div>
                <div class="mt-2">
                    <div class="text-xs font-medium text-gray-200 truncate">${result.vod_name}</div>
                    <div class="text-[10px] text-gray-400 truncate">${sourceName}</div>
                    <div class="text-[10px] text-gray-500 mt-1">
                        ${speedResult.episodes ? `${speedResult.episodes}集` : ''}
                    </div>
                </div>
                ${isCurrentSource ? `
                    <div class="absolute inset-0 flex items-center justify-center">
                        <div class="bg-blue-600 bg-opacity-75 rounded-lg px-2 py-0.5 text-xs text-white font-medium">
                            当前播放
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    html += '</div>';
    modalContent.innerHTML = html;
}

// 切换资源的函数
async function switchToResource(sourceKey, vodId) {
    // 关闭模态框
    document.getElementById('modal').classList.add('hidden');
    
    showLoading();
    try {
        // 构建API参数
        let apiParams = '';
        
        // 处理自定义API源
        if (sourceKey.startsWith('custom_')) {
            const customIndex = sourceKey.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                showToast('自定义API配置无效', 'error');
                hideLoading();
                return;
            }
            // 传递 detail 字段
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            // 内置API
            apiParams = '&source=' + sourceKey;
        }
        
        // Add a timestamp to prevent caching
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`);
        
        const data = await response.json();
        
        if (!data.episodes || data.episodes.length === 0) {
            showToast('未找到播放资源', 'error');
            hideLoading();
            return;
        }

        // 获取当前播放的集数索引
        const currentIndex = currentEpisodeIndex;
        
        // 确定要播放的集数索引
        let targetIndex = 0;
        if (currentIndex < data.episodes.length) {
            // 如果当前集数在新资源中存在，则使用相同集数
            targetIndex = currentIndex;
        }
        
        // 获取目标集数的URL
        const targetUrl = data.episodes[targetIndex];
        
        // 构建播放页面URL
        const watchUrl = `player.html?id=${vodId}&source=${sourceKey}&url=${encodeURIComponent(targetUrl)}&index=${targetIndex}&title=${encodeURIComponent(currentVideoTitle)}`;
        
        // 保存当前状态到localStorage
        try {
            localStorage.setItem('currentVideoTitle', data.vod_name || '未知视频');
            localStorage.setItem('currentEpisodes', JSON.stringify(data.episodes));
            localStorage.setItem('currentEpisodeIndex', targetIndex);
            localStorage.setItem('currentSourceCode', sourceKey);
            localStorage.setItem('lastPlayTime', Date.now());
        } catch (e) {
            console.error('保存播放状态失败:', e);
        }

        // 跳转到播放页面
        window.location.href = watchUrl;
        
    } catch (error) {
        console.error('切换资源失败:', error);
        showToast('切换资源失败，请稍后重试', 'error');
    } finally {
        hideLoading();
    }
}

// =================================
// ========== 离线缓存功能 ==========
// =================================
let offlineDB = null;
let activeCaches = {};

function waitForServiceWorker() {
    return new Promise((resolve) => {
        if (!('serviceWorker' in navigator)) { resolve(); return; }
        if (navigator.serviceWorker.controller) { resolve(); return; }
        navigator.serviceWorker.ready.then(() => {
            if (navigator.serviceWorker.controller) { resolve(); return; }
            const onController = () => { resolve(); };
            navigator.serviceWorker.addEventListener('controllerchange', onController, { once: true });
            setTimeout(() => {
                navigator.serviceWorker.removeEventListener('controllerchange', onController);
                resolve();
            }, 3000);
        }).catch(() => resolve());
    });
}

function openOfflineDB() {
    return new Promise((resolve, reject) => {
        if (offlineDB && !offlineDB.closed) { resolve(offlineDB); return; }
        offlineDB = null;
        const request = indexedDB.open('LibreTVOffline', 5);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (db.objectStoreNames.contains('segments')) {
                db.deleteObjectStore('segments');
            }
            if (!db.objectStoreNames.contains('videos')) {
                db.createObjectStore('videos', { keyPath: 'id' });
            }
            db.createObjectStore('segments', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('blobs')) {
                db.createObjectStore('blobs', { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => {
            offlineDB = e.target.result;
            offlineDB.onclose = () => { offlineDB = null; };
            offlineDB.onversionchange = () => { offlineDB.close(); offlineDB = null; };
            resolve(offlineDB);
        };
        request.onerror = (e) => { offlineDB = null; reject(e.target.error); };
        request.onblocked = () => { offlineDB = null; reject(new Error('数据库被占用，请关闭其他标签页后刷新')); };
    });
}

async function saveOfflineVideo(record) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('videos', 'readwrite');
        tx.objectStore('videos').put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getOfflineVideo(id) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('videos', 'readonly');
        const req = tx.objectStore('videos').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function getAllOfflineVideos() {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('videos', 'readonly');
        const req = tx.objectStore('videos').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function deleteOfflineVideo(id) {
    const db = await openOfflineDB();
    const video = await getOfflineVideo(id);
    const segmentCount = video?.segmentCount || 0;
    const keyCount = video?.keyCount || 0;
    return new Promise((resolve, reject) => {
        const storeNames = ['videos', 'segments', 'blobs'];
        const tx = db.transaction(storeNames, 'readwrite');
        tx.objectStore('videos').delete(id);
        tx.objectStore('blobs').delete(id);
        for (let i = 0; i < segmentCount; i++) {
            tx.objectStore('segments').delete(id + '_' + i);
        }
        for (let i = 0; i < keyCount; i++) {
            tx.objectStore('segments').delete(id + '_key_' + i);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function saveSegment(id, data) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('segments', 'readwrite');
        tx.objectStore('segments').put({ id, data, timestamp: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getSegment(id) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('segments', 'readonly');
        const req = tx.objectStore('segments').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => reject(req.error);
    });
}

function getOfflineCacheId(episodeIndex) {
    const urlParams = new URLSearchParams(window.location.search);
    const sourceCode = urlParams.get('source') || 'unknown';
    const videoId = urlParams.get('id') || '';
    return `${sourceCode}_${videoId}_${episodeIndex}`;
}

function getOfflineEpisodeName(ep, index) {
    if (typeof ep === 'string' && ep.includes('$')) return ep.split('$')[0];
    return '第' + (index + 1) + '集';
}

function getOfflineEpisodeUrl(ep) {
    if (typeof ep === 'string') return ep.includes('$') ? ep.split('$').pop() : ep;
    return ep;
}

function showOfflineModal() {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    modalTitle.textContent = '离线缓存';
    
    const episodes = currentEpisodes || [];
    const currentIndex = currentEpisodeIndex || 0;
    
    let html = '<div style="padding:12px;max-height:70vh;overflow-y:auto;">';
    html += '<div style="display:flex;gap:8px;margin-bottom:12px;">';
    html += '<button onclick="cacheCurrentEpisode()" style="flex:1;padding:10px 0;background:linear-gradient(135deg,#00ff88,#00cc66);border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">⬇ 缓存本集</button>';
    html += '<button onclick="cacheAllEpisodes()" style="flex:1;padding:10px 0;background:linear-gradient(135deg,#00ccff,#0088ff);border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">⬇ 全部缓存</button>';
    html += '</div>';
    
    html += '<div id="offlineEpisodeList">';
    episodes.forEach((ep, index) => {
        const epName = getOfflineEpisodeName(ep, index);
        const isCurrent = index === currentIndex;
        html += `<div id="offline-ep-${index}" style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);${isCurrent ? 'background:rgba(0,204,255,0.05);margin:0 -12px;padding:10px 12px;border-radius:6px;' : ''}">`;
        html += `<div style="width:32px;height:32px;border-radius:6px;background:${isCurrent ? 'rgba(0,204,255,0.2)' : 'rgba(255,255,255,0.06)'};display:flex;align-items:center;justify-content:center;font-size:12px;color:${isCurrent ? '#00ccff' : '#888'};font-weight:600;flex-shrink:0;">${index + 1}</div>`;
        html += `<div style="flex:1;min-width:0;margin-left:10px;">`;
        html += `<div style="font-size:13px;color:${isCurrent ? '#00ccff' : '#eee'};font-weight:${isCurrent ? '600' : '400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${isCurrent ? '▶ ' : ''}${epName}</div>`;
        html += `<div id="offline-status-${index}" style="font-size:11px;color:#666;margin-top:2px;"></div>`;
        html += `</div>`;
        html += `<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;">`;
        html += `<button id="offline-btn-${index}" onclick="cacheEpisode(${index})" style="padding:5px 14px;background:rgba(0,204,255,0.12);border:1px solid rgba(0,204,255,0.25);border-radius:14px;color:#00ccff;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;">缓存</button>`;
        html += `</div></div>`;
    });
    html += '</div>';
    
    html += '<div id="offlineProgressArea" style="margin-top:12px;display:none;">';
    html += '<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    html += '<span id="offlineProgressLabel" style="font-size:13px;color:#ccc;font-weight:500;">准备缓存...</span>';
    html += '<span id="offlineProgressPercent" style="font-size:13px;color:#00ccff;font-weight:600;">0%</span>';
    html += '</div>';
    html += '<div style="background:rgba(255,255,255,0.08);border-radius:4px;height:4px;overflow:hidden;">';
    html += '<div id="offlineProgressBar" style="height:100%;background:linear-gradient(90deg,#00ccff,#00ff88);width:0%;transition:width 0.3s;border-radius:4px;"></div>';
    html += '</div>';
    html += '<div style="display:flex;justify-content:space-between;margin-top:8px;">';
    html += '<span id="offlineSpeedLabel" style="font-size:11px;color:#888;"></span>';
    html += '<span id="offlineSizeLabel" style="font-size:11px;color:#888;"></span>';
    html += '</div></div></div>';
    html += '</div>';
    modalContent.innerHTML = html;
    modal.classList.remove('hidden');
    checkOfflineStatuses();
}

async function checkOfflineStatuses() {
    const videos = await getAllOfflineVideos();
    videos.forEach(video => {
        const idx = video.episodeIndex;
        const statusEl = document.getElementById('offline-status-' + idx);
        const btnEl = document.getElementById('offline-btn-' + idx);
        if (!statusEl || !btnEl) return;
        const sizeText = video.blobSize ? formatBytes(video.blobSize) : '';
        const progressText = (typeof video.progress === 'number') ? video.progress.toFixed(2) : '0.00';
        if (video.status === 'complete') {
            statusEl.innerHTML = `<span style="color:#00ff88;">✅ 已缓存</span> ${sizeText ? '<span style="color:#666;">'+sizeText+'</span>' : ''}`;
            btnEl.textContent = '播放'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(0,255,136,0.12);border:1px solid rgba(0,255,136,0.25);border-radius:14px;color:#00ff88;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;';
            btnEl.onclick = () => playOfflineById(video.id);
        } else if (video.status === 'caching') {
            statusEl.innerHTML = `<span style="color:#00ccff;">⬇ ${progressText}%</span> ${sizeText ? '<span style="color:#666;">'+sizeText+'</span>' : ''}`;
            btnEl.textContent = '暂停'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(255,204,0,0.12);border:1px solid rgba(255,204,0,0.25);border-radius:14px;color:#ffcc00;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;';
            btnEl.onclick = () => pauseCacheEpisode(idx);
        } else if (video.status === 'paused') {
            statusEl.innerHTML = `<span style="color:#ffcc00;">⏸ ${progressText}%</span> ${sizeText ? '<span style="color:#666;">'+sizeText+'</span>' : ''}`;
            btnEl.textContent = '继续'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(0,204,255,0.12);border:1px solid rgba(0,204,255,0.25);border-radius:14px;color:#00ccff;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;';
            btnEl.onclick = () => resumeCacheEpisode(idx);
        } else if (video.status === 'error') {
            statusEl.innerHTML = `<span style="color:#ff3333;">❌ 失败</span>`;
            btnEl.textContent = '重试'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(255,80,80,0.12);border:1px solid rgba(255,80,80,0.25);border-radius:14px;color:#ff5050;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;';
            btnEl.onclick = () => cacheEpisode(idx);
        }
    });
}

async function cacheEpisode(index) {
    if (!currentEpisodes || !currentEpisodes[index]) { showToast('无法获取视频地址', 'error'); return; }
    const epUrl = getOfflineEpisodeUrl(currentEpisodes[index]);
    const epName = getOfflineEpisodeName(currentEpisodes[index], index);
    const cacheId = getOfflineCacheId(index);
    const existing = await getOfflineVideo(cacheId);
    if (existing && existing.status === 'complete') { playOfflineById(cacheId); return; }
    if (existing && existing.status === 'caching') { pauseCacheEpisode(index); return; }
    if (existing && existing.status === 'paused') {
        startEpisodeCache(cacheId, index, epUrl, epName, existing.progress || 1);
    } else {
        startEpisodeCache(cacheId, index, epUrl, epName, 0);
    }
}

async function cacheCurrentEpisode() { await cacheEpisode(currentEpisodeIndex || 0); }

async function cacheAllEpisodes() {
    if (!currentEpisodes || currentEpisodes.length === 0) { showToast('没有可缓存的剧集', 'error'); return; }
    showToast(`开始缓存全部 ${currentEpisodes.length} 集`, 'info');
    for (let i = 0; i < currentEpisodes.length; i++) {
        const cacheId = getOfflineCacheId(i);
        const existing = await getOfflineVideo(cacheId);
        if (existing && (existing.status === 'complete' || existing.status === 'caching')) continue;
        await cacheEpisode(i);
        await new Promise(r => setTimeout(r, 300));
    }
}

async function startEpisodeCache(cacheId, episodeIndex, m3u8Url, episodeName, resumeFrom = 0) {
    const statusEl = document.getElementById('offline-status-' + episodeIndex);
    const btnEl = document.getElementById('offline-btn-' + episodeIndex);
    const progressArea = document.getElementById('offlineProgressArea');
    
    if (statusEl) { statusEl.textContent = resumeFrom > 0 ? '⬇ 续传中...' : '⬇ 解析中...'; statusEl.style.color = '#00ccff'; }
    if (btnEl) { btnEl.textContent = '暂停'; btnEl.onclick = () => pauseCacheEpisode(episodeIndex); btnEl.style.cssText = 'padding:5px 14px;background:rgba(255,204,0,0.12);border:1px solid rgba(255,204,0,0.25);border-radius:14px;color:#ffcc00;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;'; }
    if (progressArea) progressArea.style.display = 'block';
    
    const abortController = new AbortController();
    
    let record = await getOfflineVideo(cacheId);
    if (!record || resumeFrom === 0) {
        record = {
            id: cacheId,
            episodeIndex,
            m3u8Url,
            episodeName,
            title: currentVideoTitle,
            status: 'caching',
            progress: 0,
            timestamp: Date.now()
        };
    } else {
        record.status = 'caching';
    }
    await saveOfflineVideo(record);
    activeCaches[cacheId] = { controller: abortController, episodeIndex };
    
    try {
        let segmentUrls = record.segmentUrls || [];
        let m3u8Content = record.m3u8Content || '';
        let keyInfos = [];
        let totalBytes = record.blobSize || 0;
        let startSegIndex = 0;
        
        if (!m3u8Content || !segmentUrls.length) {
            updateOfflineProgress(episodeName, 0, 0, 0);
            const parsed = await parseM3u8AndGetSegments(m3u8Url, abortController.signal);
            if (parsed.segmentUrls.length === 0) throw new Error('未找到视频分片');
            segmentUrls = parsed.segmentUrls;
            m3u8Content = parsed.m3u8Content;
            keyInfos = parsed.keyInfos;
            
            record.m3u8Content = m3u8Content;
            record.segmentCount = segmentUrls.length;
            record.segmentUrls = segmentUrls;
            record.keyCount = keyInfos.length;
            
            for (let k = 0; k < keyInfos.length; k++) {
                if (abortController.signal.aborted) break;
                try {
                    const existingKey = await getSegment(cacheId + '_key_' + k);
                    if (existingKey) continue;
                    const keyData = await downloadSegment(keyInfos[k].uri, abortController.signal);
                    await saveSegment(cacheId + '_key_' + k, keyData);
                } catch (keyErr) {
                    console.warn('加密密钥下载失败:', keyErr);
                }
            }
        } else {
            for (let i = 0; i < segmentUrls.length; i++) {
                const existing = await getSegment(cacheId + '_' + i);
                if (existing) {
                    totalBytes += existing.byteLength;
                    startSegIndex = i + 1;
                } else {
                    startSegIndex = i;
                    break;
                }
            }
            if (startSegIndex >= segmentUrls.length) {
                record.status = 'complete';
                record.progress = 100;
                record.blobSize = totalBytes;
                await saveOfflineVideo(record);
                if (statusEl) { statusEl.textContent = '✅ 已缓存'; statusEl.style.color = '#00ff88'; }
                if (btnEl) { btnEl.textContent = '播放'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(0,255,136,0.12);border:1px solid rgba(0,255,136,0.25);border-radius:14px;color:#00ff88;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;'; btnEl.onclick = () => playOfflineById(cacheId); }
                showToast(`${episodeName} 已全部缓存`, 'success');
                delete activeCaches[cacheId];
                return;
            }
        }
        
        const progressBase = (startSegIndex / segmentUrls.length * 100);
        if (statusEl) { statusEl.textContent = `⬇ ${startSegIndex}/${segmentUrls.length}`; }
        updateOfflineProgress(episodeName, progressBase, 0, totalBytes);
        
        let lastTime = Date.now();
        let lastBytes = totalBytes;
        let currentSpeed = 0;
        
        for (let i = startSegIndex; i < segmentUrls.length; i++) {
            if (abortController.signal.aborted) break;
            
            let segData = null;
            let retries = 5;
            while (retries > 0 && !segData) {
                try {
                    const segStart = Date.now();
                    segData = await downloadSegment(segmentUrls[i], abortController.signal);
                    const segEnd = Date.now();
                    const segDuration = (segEnd - segStart) / 1000;
                    if (segDuration > 0 && segData.byteLength > 0) {
                        currentSpeed = segData.byteLength / segDuration;
                    }
                } catch (segErr) {
                    if (segErr.name === 'AbortError') throw segErr;
                    retries--;
                    if (retries <= 0) throw new Error('分片下载失败: 第' + (i + 1) + '段');
                    const delay = Math.min(2000 * (5 - retries), 8000);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
            
            await saveSegment(cacheId + '_' + i, segData);
            totalBytes += segData.byteLength;
            
            const progress = ((i + 1) / segmentUrls.length * 100);
            record.progress = Math.round(progress * 100) / 100;
            record.blobSize = totalBytes;
            
            if (statusEl) { statusEl.textContent = `⬇ ${i + 1}/${segmentUrls.length}`; }
            updateOfflineProgress(episodeName, progress, currentSpeed, totalBytes);
            
            if (i % 5 === 0) await saveOfflineVideo(record);
        }
        
        if (!abortController.signal.aborted) {
            record.status = 'complete';
            record.progress = 100;
            record.blobSize = totalBytes;
            await saveOfflineVideo(record);
            
            if (statusEl) { statusEl.textContent = '✅ 已缓存'; statusEl.style.color = '#00ff88'; }
            if (btnEl) { btnEl.textContent = '播放'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(0,255,136,0.12);border:1px solid rgba(0,255,136,0.25);border-radius:14px;color:#00ff88;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;'; btnEl.onclick = () => playOfflineById(cacheId); }
            showToast(`${episodeName} 缓存完成`, 'success');
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            record.status = 'paused';
            record.blobSize = record.blobSize || 0;
            await saveOfflineVideo(record);
            if (statusEl) { statusEl.innerHTML = `<span style="color:#ffcc00;">⏸ 已暂停 ${record.progress.toFixed(2)}%</span>`; }
            if (btnEl) { btnEl.textContent = '继续'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(0,204,255,0.12);border:1px solid rgba(0,204,255,0.25);border-radius:14px;color:#00ccff;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;'; btnEl.onclick = () => resumeCacheEpisode(episodeIndex); }
            showToast(`${episodeName} 缓存已暂停`, 'info');
        } else {
            console.error('缓存失败:', err);
            record.status = 'error';
            record.blobSize = record.blobSize || 0;
            await saveOfflineVideo(record);
            if (statusEl) { statusEl.innerHTML = `<span style="color:#ff3333;">❌ 失败</span>`; }
            if (btnEl) { btnEl.textContent = '重试'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(255,80,80,0.12);border:1px solid rgba(255,80,80,0.25);border-radius:14px;color:#ff5050;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;'; btnEl.onclick = () => cacheEpisode(episodeIndex); }
            showToast(`${episodeName} 缓存失败: ${err.message}`, 'error');
        }
    } finally {
        delete activeCaches[cacheId];
    }
}

function extractKeyInfoFromM3u8(m3u8Content, baseUrl) {
    const keyInfos = [];
    const lines = m3u8Content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXT-X-KEY:')) {
            const methodMatch = trimmed.match(/METHOD=([^,\s]+)/);
            const uriMatch = trimmed.match(/URI="([^"]+)"/);
            if (methodMatch && methodMatch[1] !== 'NONE' && uriMatch) {
                let keyUri = uriMatch[1];
                if (!keyUri.startsWith('http') && !keyUri.startsWith('/proxy/')) {
                    keyUri = baseUrl + keyUri;
                }
                keyInfos.push({ method: methodMatch[1], uri: keyUri });
            }
        }
    }
    return keyInfos;
}

async function parseM3u8AndGetSegments(m3u8Url, signal) {
    let proxyUrl = PROXY_URL + encodeURIComponent(m3u8Url);
    if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
        proxyUrl = await window.ProxyAuth.addAuthToProxyUrl(proxyUrl);
    }
    
    const resp = await fetch(proxyUrl, { signal });
    if (!resp.ok) throw new Error('M3U8请求失败: HTTP ' + resp.status);
    let content = await resp.text();
    let baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    let bestStreamUrl = '';
    let bestBandwidth = 0;
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
            const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
            const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
            if (bandwidth > bestBandwidth && i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
                bestBandwidth = bandwidth;
                let streamUrl = lines[i + 1];
                if (!streamUrl.startsWith('http') && !streamUrl.startsWith('/proxy/')) {
                    streamUrl = baseUrl + streamUrl;
                }
                bestStreamUrl = streamUrl;
            }
        }
    }
    
    if (bestStreamUrl) {
        let streamProxyUrl;
        if (bestStreamUrl.startsWith('/proxy/')) {
            streamProxyUrl = bestStreamUrl;
            if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
                streamProxyUrl = await window.ProxyAuth.addAuthToProxyUrl(streamProxyUrl);
            }
        } else {
            streamProxyUrl = PROXY_URL + encodeURIComponent(bestStreamUrl);
            if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
                streamProxyUrl = await window.ProxyAuth.addAuthToProxyUrl(streamProxyUrl);
            }
        }
        const streamResp = await fetch(streamProxyUrl, { signal });
        if (!streamResp.ok) throw new Error('子播放列表请求失败');
        content = await streamResp.text();
        if (bestStreamUrl.startsWith('http')) {
            baseUrl = bestStreamUrl.substring(0, bestStreamUrl.lastIndexOf('/') + 1);
        }
    }
    
    const segmentUrls = [];
    const m3u8Lines = content.split('\n');
    for (const line of m3u8Lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            if (trimmed.startsWith('http')) {
                segmentUrls.push(trimmed);
            } else if (trimmed.startsWith('/proxy/')) {
                segmentUrls.push(trimmed);
            } else {
                segmentUrls.push(baseUrl + trimmed);
            }
        }
    }
    const keyInfos = extractKeyInfoFromM3u8(content, baseUrl);
    return { segmentUrls, m3u8Content: content, keyInfos };
}

async function downloadSegment(segUrl, signal) {
    let fetchUrl;
    if (segUrl.startsWith('/proxy/')) {
        fetchUrl = segUrl;
        if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
            fetchUrl = await window.ProxyAuth.addAuthToProxyUrl(fetchUrl);
        }
    } else {
        fetchUrl = PROXY_URL + encodeURIComponent(segUrl);
        if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
            fetchUrl = await window.ProxyAuth.addAuthToProxyUrl(fetchUrl);
        }
    }
    const resp = await fetch(fetchUrl, { signal });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.arrayBuffer();
}

function pauseCacheEpisode(episodeIndex) {
    const cacheId = getOfflineCacheId(episodeIndex);
    if (activeCaches[cacheId]) {
        activeCaches[cacheId].controller.abort();
    } else {
        const btnEl = document.getElementById('offline-btn-' + episodeIndex);
        if (btnEl) { btnEl.textContent = '继续'; btnEl.style.cssText = 'padding:5px 14px;background:rgba(0,204,255,0.12);border:1px solid rgba(0,204,255,0.25);border-radius:14px;color:#00ccff;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:500;'; btnEl.onclick = () => resumeCacheEpisode(episodeIndex); }
        getOfflineVideo(cacheId).then(video => {
            if (video && video.status === 'caching') {
                video.status = 'paused';
                saveOfflineVideo(video);
            }
        });
    }
}

async function resumeCacheEpisode(episodeIndex) {
    if (!currentEpisodes || !currentEpisodes[episodeIndex]) { showToast('无法获取视频地址', 'error'); return; }
    const epUrl = getOfflineEpisodeUrl(currentEpisodes[episodeIndex]);
    const epName = getOfflineEpisodeName(currentEpisodes[episodeIndex], episodeIndex);
    const cacheId = getOfflineCacheId(episodeIndex);
    const existing = await getOfflineVideo(cacheId);
    if (!existing) { cacheEpisode(episodeIndex); return; }
    if (existing.status === 'caching') { pauseCacheEpisode(episodeIndex); return; }
    if (existing.status === 'complete') { playOfflineById(cacheId); return; }
    startEpisodeCache(cacheId, episodeIndex, epUrl, epName, existing.progress || 1);
}

function updateOfflineProgress(name, progress, speed, totalBytes) {
    const label = document.getElementById('offlineProgressLabel');
    const percent = document.getElementById('offlineProgressPercent');
    const bar = document.getElementById('offlineProgressBar');
    const speedLabel = document.getElementById('offlineSpeedLabel');
    const sizeLabel = document.getElementById('offlineSizeLabel');
    if (label) label.textContent = name;
    if (percent) percent.textContent = progress.toFixed(2) + '%';
    if (bar) bar.style.width = progress.toFixed(2) + '%';
    if (speedLabel) {
        if (speed > 0) {
            const speedKB = speed / 1024;
            const speedMbps = speed * 8 / 1000000;
            if (speedKB > 1024) {
                speedLabel.textContent = (speedKB / 1024).toFixed(1) + ' MB/s (' + speedMbps.toFixed(1) + ' Mbps)';
            } else {
                speedLabel.textContent = speedKB.toFixed(0) + ' KB/s (' + speedMbps.toFixed(1) + ' Mbps)';
            }
            speedLabel.style.color = speedMbps >= 5 ? '#00ff88' : speedMbps >= 2 ? '#ffcc00' : '#ff8800';
        } else {
            speedLabel.textContent = '';
            speedLabel.style.color = '#888';
        }
    }
    if (sizeLabel) sizeLabel.textContent = totalBytes > 0 ? formatBytes(totalBytes) : '';
}

async function playOfflineById(id) {
    const video = await getOfflineVideo(id);
    if (!video || video.status !== 'complete') { showToast('缓存数据不完整', 'error'); return; }
    
    if (!video.m3u8Content || !video.segmentCount) {
        showToast('缓存格式不兼容，请删除后重新缓存', 'error');
        return;
    }
    
    showToast('正在加载离线缓存: ' + video.episodeName, 'info');
    
    try {
        const swActive = navigator.serviceWorker && navigator.serviceWorker.controller;
        
        const m3u8Lines = video.m3u8Content.split('\n');
        let segIndex = 0;
        let keyIndex = 0;
        const rewrittenLines = m3u8Lines.map(line => {
            const trimmed = line.trim();
            
            if (trimmed.startsWith('#EXT-X-KEY:') && trimmed.includes('URI=') && !trimmed.includes('METHOD=NONE')) {
                if (keyIndex < (video.keyCount || 0)) {
                    let newUri;
                    if (swActive) {
                        newUri = '/offline-key/' + id + '/' + keyIndex;
                    } else {
                        newUri = '__OFFLINE_KEY_' + keyIndex + '__';
                    }
                    keyIndex++;
                    return trimmed.replace(/URI="[^"]*"/, 'URI="' + newUri + '"');
                }
            }
            
            if (trimmed && !trimmed.startsWith('#')) {
                if (segIndex < video.segmentCount) {
                    if (swActive) {
                        return '/offline-seg/' + id + '/' + segIndex++;
                    } else {
                        return '__OFFLINE_SEG_' + (segIndex++) + '__';
                    }
                }
            }
            return line;
        });
        const rewrittenM3u8 = rewrittenLines.join('\n');
        
        if (swActive) {
            video.rewrittenM3u8 = rewrittenM3u8;
            await saveOfflineVideo(video);
            
            const m3u8Url = '/offline-m3u8/' + id;
            currentVideoUrl = m3u8Url;
            initPlayer(m3u8Url, { isOffline: true });
        } else {
            const segments = [];
            for (let i = 0; i < video.segmentCount; i++) {
                const segData = await getSegment(id + '_' + i);
                if (!segData) { showToast('缓存分片数据丢失，请删除后重新缓存', 'error'); return; }
                segments.push(segData);
            }
            
            const segBlobUrls = segments.map(segData => {
                const blob = new Blob([segData], { type: 'video/mp2t' });
                return URL.createObjectURL(blob);
            });
            
            const keyBlobUrls = [];
            for (let k = 0; k < (video.keyCount || 0); k++) {
                const keyData = await getSegment(id + '_key_' + k);
                if (keyData) {
                    const blob = new Blob([keyData], { type: 'application/octet-stream' });
                    keyBlobUrls.push(URL.createObjectURL(blob));
                } else {
                    keyBlobUrls.push('');
                }
            }
            
            let finalM3u8 = rewrittenM3u8;
            for (let k = 0; k < keyBlobUrls.length; k++) {
                finalM3u8 = finalM3u8.replace('__OFFLINE_KEY_' + k + '__', keyBlobUrls[k]);
            }
            for (let s = 0; s < segBlobUrls.length; s++) {
                finalM3u8 = finalM3u8.replace('__OFFLINE_SEG_' + s + '__', segBlobUrls[s]);
            }
            
            const m3u8Blob = new Blob([finalM3u8], { type: 'application/vnd.apple.mpegurl' });
            const m3u8BlobUrl = URL.createObjectURL(m3u8Blob);
            
            currentVideoUrl = m3u8BlobUrl;
            initPlayer(m3u8BlobUrl, { isOffline: true });
        }
        
        document.getElementById('player-loading').style.display = 'flex';
        document.getElementById('player-loading').innerHTML = '<div class="loading-spinner"></div><div>正在加载离线缓存...</div>';
    } catch (err) {
        console.error('离线播放失败:', err);
        showToast('离线播放失败: ' + err.message, 'error');
    }
}

async function showOfflineList() {
    const videos = await getAllOfflineVideos();
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    modalTitle.textContent = '离线缓存列表';
    
    if (videos.length === 0) {
        modalContent.innerHTML = '<div style="text-align:center;padding:40px;color:#888;"><div style="font-size:40px;margin-bottom:12px;">📱</div><p>暂无离线缓存</p><p style="font-size:12px;margin-top:8px;">播放视频时点击"离线"按钮即可缓存</p></div>';
        modal.classList.remove('hidden');
        return;
    }
    
    let html = '<div style="padding:16px;max-height:60vh;overflow-y:auto;">';
    videos.forEach(video => {
        const statusText = video.status === 'complete' ? '✅ 已缓存' : video.status === 'caching' ? `⬇ ${video.progress||0}%` : video.status === 'paused' ? `⏸ ${video.progress||0}%` : '❌ 失败';
        const statusColor = video.status === 'complete' ? '#00ff88' : video.status === 'caching' ? '#00ccff' : video.status === 'paused' ? '#ffcc00' : '#ff3333';
        const sizeText = video.blobSize ? formatBytes(video.blobSize) : '';
        html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;">`;
        html += `<div style="flex:1;min-width:0;"><div style="font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${video.title||'未知'}</div>`;
        html += `<div style="font-size:11px;color:#888;margin-top:2px;">${video.episodeName} <span style="color:${statusColor};">${statusText}</span> ${sizeText ? '<span style="color:#666;">'+sizeText+'</span>' : ''}</div></div>`;
        html += `<div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px;">`;
        if (video.status === 'complete') {
            html += `<button onclick="playOfflineById('${video.id}')" style="padding:5px 12px;background:rgba(0,255,136,0.15);border:1px solid rgba(0,255,136,0.3);border-radius:6px;color:#00ff88;font-size:11px;cursor:pointer;font-weight:500;">播放</button>`;
        } else if (video.status === 'paused') {
            html += `<button onclick="resumeOfflineCache('${video.id}')" style="padding:5px 12px;background:rgba(0,204,255,0.15);border:1px solid rgba(0,204,255,0.3);border-radius:6px;color:#00ccff;font-size:11px;cursor:pointer;font-weight:500;">继续下载</button>`;
        } else if (video.status === 'caching') {
            html += `<button onclick="pauseOfflineCache('${video.id}')" style="padding:5px 12px;background:rgba(255,204,0,0.15);border:1px solid rgba(255,204,0,0.3);border-radius:6px;color:#ffcc00;font-size:11px;cursor:pointer;font-weight:500;">暂停</button>`;
        } else if (video.status === 'error') {
            html += `<button onclick="retryOfflineCache('${video.id}')" style="padding:5px 12px;background:rgba(255,80,80,0.15);border:1px solid rgba(255,80,80,0.3);border-radius:6px;color:#ff5050;font-size:11px;cursor:pointer;font-weight:500;">重试</button>`;
        }
        html += `<button onclick="deleteOfflineVideo('${video.id}').then(()=>showOfflineList())" style="padding:5px 12px;background:rgba(255,80,80,0.15);border:1px solid rgba(255,80,80,0.3);border-radius:6px;color:#ff5050;font-size:11px;cursor:pointer;font-weight:500;">删除</button>`;
        html += `</div></div>`;
    });
    html += '</div>';
    modalContent.innerHTML = html;
    modal.classList.remove('hidden');
}

async function resumeOfflineCache(id) {
    const video = await getOfflineVideo(id);
    if (!video || video.status !== 'paused') return;
    startEpisodeCache(id, video.episodeIndex, video.m3u8Url, video.episodeName, video.progress || 1);
    showOfflineList();
}

async function pauseOfflineCache(id) {
    if (activeCaches[id]) activeCaches[id].controller.abort();
    setTimeout(() => showOfflineList(), 500);
}

async function retryOfflineCache(id) {
    const video = await getOfflineVideo(id);
    if (!video) return;
    startEpisodeCache(id, video.episodeIndex, video.m3u8Url, video.episodeName, 1);
    showOfflineList();
}

// =================================
// ========== 滑动快进功能 ==========
// =================================
let swipeSeekState = {
    active: false,
    startX: 0,
    startTime: 0,
    currentSeek: 0,
    direction: 0
};

function setupSwipeSeek() {
    const playerElement = document.getElementById('player');
    if (!playerElement) return;
    
    const SWIPE_THRESHOLD = 30;
    const SEEK_SENSITIVITY = 0.15;
    
    playerElement.addEventListener('touchstart', function(e) {
        if (!art || !art.video || art.video.paused) return;
        if (e.touches.length !== 1) return;
        
        const touch = e.touches[0];
        const rect = playerElement.getBoundingClientRect();
        const touchY = touch.clientY - rect.top;
        const touchX = touch.clientX - rect.left;
        
        if (touchY > rect.height * 0.7) return;
        if (touchX < rect.width * 0.2 || touchX > rect.width * 0.8) return;
        
        swipeSeekState.active = true;
        swipeSeekState.startX = touch.clientX;
        swipeSeekState.startTime = art.video.currentTime;
        swipeSeekState.currentSeek = 0;
        swipeSeekState.direction = 0;
    }, { passive: true });
    
    playerElement.addEventListener('touchmove', function(e) {
        if (!swipeSeekState.active || !art || !art.video) return;
        
        const touch = e.touches[0];
        const deltaX = touch.clientX - swipeSeekState.startX;
        const duration = art.video.duration || 0;
        
        if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
        
        e.preventDefault();
        
        const seekSeconds = deltaX * SEEK_SENSITIVITY;
        swipeSeekState.currentSeek = seekSeconds;
        swipeSeekState.direction = deltaX > 0 ? 1 : -1;
        
        const overlay = document.getElementById('swipeSeekOverlay');
        const seekIcon = document.getElementById('swipeSeekIcon');
        const seekTime = document.getElementById('swipeSeekTime');
        const seekLabel = document.getElementById('swipeSeekLabel');
        
        if (overlay) {
            overlay.classList.add('active');
            seekIcon.textContent = deltaX > 0 ? '⏩' : '⏪';
            const absSeek = Math.abs(seekSeconds);
            seekTime.textContent = (deltaX > 0 ? '+' : '-') + formatTime(absSeek);
            seekLabel.textContent = deltaX > 0 ? '快进' : '快退';
        }
    }, { passive: false });
    
    playerElement.addEventListener('touchend', function(e) {
        if (!swipeSeekState.active) return;
        
        const overlay = document.getElementById('swipeSeekOverlay');
        if (overlay) overlay.classList.remove('active');
        
        if (art && art.video && Math.abs(swipeSeekState.currentSeek) >= 1) {
            const newTime = Math.max(0, Math.min(art.video.duration, swipeSeekState.startTime + swipeSeekState.currentSeek));
            art.seek(newTime);
            showShortcutHint(
                swipeSeekState.direction > 0 ? '快进' : '快退',
                swipeSeekState.direction > 0 ? 'right' : 'left'
            );
        }
        
        swipeSeekState.active = false;
        swipeSeekState.currentSeek = 0;
    }, { passive: true });
    
    playerElement.addEventListener('touchcancel', function() {
        const overlay = document.getElementById('swipeSeekOverlay');
        if (overlay) overlay.classList.remove('active');
        swipeSeekState.active = false;
        swipeSeekState.currentSeek = 0;
    }, { passive: true });
}

// =================================
// ======= 源自动刷新测试功能 =======
// =================================
let sourceSpeedCache = {};
let sourceTestInProgress = false;

async function refreshAllSourceSpeeds() {
    if (sourceTestInProgress) return;
    sourceTestInProgress = true;
    
    const urlParams = new URLSearchParams(window.location.search);
    const currentVideoId = urlParams.get('id');
    if (!currentVideoId) {
        showToast('无法获取视频ID', 'error');
        sourceTestInProgress = false;
        return;
    }
    
    const refreshBtn = document.querySelector('.source-refresh-btn');
    if (refreshBtn) refreshBtn.classList.add('testing');
    
    const apis = selectedAPIs.filter(key => API_SITES[key] || key.startsWith('custom_'));
    const results = {};
    
    await Promise.all(apis.map(async (sourceKey) => {
        try {
            const startTime = performance.now();
            let apiParams = '';
            if (sourceKey.startsWith('custom_')) {
                const customIndex = sourceKey.replace('custom_', '');
                const customApi = getCustomApiInfo(customIndex);
                if (!customApi) { results[sourceKey] = { speed: -1, error: '配置无效' }; return; }
                apiParams = customApi.detail 
                    ? '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom'
                    : '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            } else {
                apiParams = '&source=' + sourceKey;
            }
            
            const timestamp = Date.now();
            const response = await fetch(`/api/detail?id=${encodeURIComponent(currentVideoId)}${apiParams}&_t=${timestamp}`, {
                cache: 'no-cache',
                signal: AbortSignal.timeout(8000)
            });
            
            if (!response.ok) { results[sourceKey] = { speed: -1, error: '请求失败' }; return; }
            
            const data = await response.json();
            const totalTime = Math.round(performance.now() - startTime);
            
            results[sourceKey] = {
                speed: totalTime,
                episodes: data.episodes ? data.episodes.length : 0,
                error: null
            };
        } catch (err) {
            results[sourceKey] = { speed: -1, error: err.name === 'AbortError' ? '超时' : '失败' };
        }
    }));
    
    sourceSpeedCache = { ...sourceSpeedCache, ...results };
    sourceTestInProgress = false;
    
    if (refreshBtn) refreshBtn.classList.remove('testing');
    
    updateSourceSpeedTags(results);
    return results;
}

function updateSourceSpeedTags(results) {
    Object.entries(results).forEach(([sourceKey, result]) => {
        const tag = document.querySelector(`[data-source-speed="${sourceKey}"]`);
        if (!tag) return;
        
        if (result.speed === -1) {
            tag.className = 'source-speed-tag error';
            tag.textContent = '❌ ' + result.error;
        } else if (result.speed < 500) {
            tag.className = 'source-speed-tag fast';
            tag.textContent = '⚡ ' + result.speed + 'ms';
        } else if (result.speed < 1500) {
            tag.className = 'source-speed-tag medium';
            tag.textContent = '🟡 ' + result.speed + 'ms';
        } else {
            tag.className = 'source-speed-tag slow';
            tag.textContent = '🔴 ' + result.speed + 'ms';
        }
    });
}

function getSpeedTagHtml(sourceKey) {
    const cached = sourceSpeedCache[sourceKey];
    if (!cached) {
        return `<span class="source-speed-tag testing" data-source-speed="${sourceKey}">⏳ 待测</span>`;
    }
    if (cached.speed === -1) {
        return `<span class="source-speed-tag error" data-source-speed="${sourceKey}">❌ ${cached.error}</span>`;
    }
    if (cached.speed < 500) {
        return `<span class="source-speed-tag fast" data-source-speed="${sourceKey}">⚡ ${cached.speed}ms</span>`;
    }
    if (cached.speed < 1500) {
        return `<span class="source-speed-tag medium" data-source-speed="${sourceKey}">🟡 ${cached.speed}ms</span>`;
    }
    return `<span class="source-speed-tag slow" data-source-speed="${sourceKey}">🔴 ${cached.speed}ms</span>`;
}

// =================================
// ========== 投屏功能 ==========
// =================================
let castSession = null;
let dlnaDeviceScanTimer = null;

function showCastModal() {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    modalTitle.textContent = '投屏';
    
    const hasAirPlay = !!window.WebKitPlaybackTargetAvailabilityEvent;
    const hasRemotePlayback = !!(navigator.remotePlayback);
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);
    
    let html = '<div style="padding:12px;max-height:70vh;overflow-y:auto;">';
    
    html += '<div style="text-align:center;margin-bottom:16px;">';
    html += '<div style="width:64px;height:64px;margin:0 auto 10px;background:rgba(0,204,255,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;">';
    html += '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#00ccff" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M5 12.55a11 11 0 0114 0" stroke-dasharray="2 2"/><path d="M8.53 16.11a6 6 0 016.95 0" stroke-dasharray="2 2"/></svg>';
    html += '</div>';
    html += '<div style="font-size:14px;color:#ccc;">选择投屏方式</div>';
    html += '</div>';
    
    html += '<div id="castDeviceList" style="margin-bottom:16px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 0;color:#888;font-size:12px;">';
    html += '<div style="width:6px;height:6px;border-radius:50%;background:#00ccff;animation:pulse 1.5s infinite;"></div>';
    html += '<span>正在搜索同一网络下的设备...</span>';
    html += '</div>';
    html += '</div>';
    
    html += '<div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;margin-bottom:12px;">';
    html += '<div style="font-size:12px;color:#666;margin-bottom:10px;">快捷投屏</div>';
    
    if (hasAirPlay || hasRemotePlayback) {
        html += '<button onclick="startAirPlay()" style="width:100%;padding:12px;margin-bottom:8px;background:rgba(0,204,255,0.08);border:1px solid rgba(0,204,255,0.2);border-radius:10px;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:10px;">';
        html += '<div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#00ccff,#0088ff);display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
        html += '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M5 12.55a11 11 0 0114 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>';
        html += '</div>';
        html += '<div style="text-align:left;"><div style="font-weight:600;">AirPlay 投屏</div><div style="font-size:11px;color:#888;margin-top:2px;">Apple TV / 智能电视</div></div>';
        html += '</button>';
    }
    
    html += '<button onclick="startChromecast()" style="width:100%;padding:12px;margin-bottom:8px;background:rgba(66,133,244,0.08);border:1px solid rgba(66,133,244,0.2);border-radius:10px;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:10px;">';
    html += '<div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#4285f4,#34a853);display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
    html += '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M5 12.55a11 11 0 0114 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>';
    html += '</div>';
    html += '<div style="text-align:left;"><div style="font-weight:600;">Chromecast 投屏</div><div style="font-size:11px;color:#888;margin-top:2px;">Chromecast / Google TV</div></div>';
    html += '</button>';
    
    html += '<button onclick="startDLNA()" style="width:100%;padding:12px;margin-bottom:8px;background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.2);border-radius:10px;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:10px;">';
    html += '<div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#ff6b6b,#ee5a24);display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
    html += '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
    html += '</div>';
    html += '<div style="text-align:left;"><div style="font-weight:600;">DLNA / 局域网投屏</div><div style="font-size:11px;color:#888;margin-top:2px;">乐播投屏 / 智能电视 / 机顶盒</div></div>';
    html += '</button>';
    
    html += '</div>';
    
    html += '<div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;">';
    html += '<button onclick="copyVideoUrl()" style="width:100%;padding:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#aaa;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">';
    html += '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    html += '复制视频地址';
    html += '</button>';
    html += '</div>';
    
    html += '</div>';
    modalContent.innerHTML = html;
    modal.classList.remove('hidden');
    
    scanCastDevices();
}

async function scanCastDevices() {
    const deviceList = document.getElementById('castDeviceList');
    if (!deviceList) return;
    
    let devices = [];
    
    try {
        if (navigator.remotePlayback && navigator.remotePlayback.watchAvailability) {
            navigator.remotePlayback.watchAvailability(async (available) => {
                if (available) {
                    devices.push({ name: 'Remote Playback 设备', type: 'remote', available: true });
                }
                renderDeviceList(devices);
            });
        }
    } catch (e) {}
    
    try {
        if (window.chrome && chrome.cast && chrome.cast.isAvailable) {
            devices.push({ name: 'Chromecast', type: 'chromecast', available: true });
        }
    } catch (e) {}
    
    if (window.WebKitPlaybackTargetAvailabilityEvent) {
        devices.push({ name: 'AirPlay 设备', type: 'airplay', available: true });
    }
    
    setTimeout(() => {
        if (devices.length === 0) {
            deviceList.innerHTML = '<div style="padding:12px;text-align:center;">' +
                '<div style="font-size:12px;color:#888;margin-bottom:8px;">未发现同一网络下的设备</div>' +
                '<div style="font-size:11px;color:#666;">请确保手机和电视连接同一WiFi，或使用下方投屏方式</div>' +
                '</div>';
        } else {
            renderDeviceList(devices);
        }
    }, 2000);
}

function renderDeviceList(devices) {
    const deviceList = document.getElementById('castDeviceList');
    if (!deviceList) return;
    
    let html = '<div style="font-size:12px;color:#666;margin-bottom:8px;">发现的设备</div>';
    devices.forEach(device => {
        const icon = device.type === 'airplay' ? '📺' : device.type === 'chromecast' ? '📡' : '📶';
        const action = device.type === 'airplay' ? 'startAirPlay()' : device.type === 'chromecast' ? 'startChromecast()' : 'startRemotePlayback()';
        html += `<button onclick="${action}" style="width:100%;padding:10px;margin-bottom:6px;background:rgba(0,255,136,0.06);border:1px solid rgba(0,255,136,0.15);border-radius:8px;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:10px;">`;
        html += `<span style="font-size:18px;">${icon}</span>`;
        html += `<div style="flex:1;text-align:left;"><div style="font-weight:500;">${device.name}</div><div style="font-size:11px;color:#00ff88;">可连接</div></div>`;
        html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#00ff88" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>';
        html += '</button>';
    });
    deviceList.innerHTML = html;
}

function startAirPlay() {
    if (!art || !art.video) {
        showToast('请先播放视频', 'error');
        return;
    }
    const video = art.video;
    if (video.webkitShowPlaybackTargetPicker) {
        video.webkitShowPlaybackTargetPicker();
        showToast('正在搜索 AirPlay 设备...', 'info');
    } else if (video.remote && video.remote.prompt) {
        video.remote.prompt();
        showToast('正在搜索投屏设备...', 'info');
    } else {
        showToast('当前浏览器不支持 AirPlay，请在 Safari 中使用', 'error');
    }
}

function startRemotePlayback() {
    if (!art || !art.video) return;
    if (art.video.remote && art.video.remote.prompt) {
        art.video.remote.prompt();
        showToast('正在连接设备...', 'info');
    }
}

function startChromecast() {
    if (!art || !art.video) {
        showToast('请先播放视频', 'error');
        return;
    }
    if (!window.chrome || !chrome.cast) {
        showToast('Chromecast 需要 Chrome 浏览器支持，正在尝试加载...', 'info');
        loadChromecastSDK();
        return;
    }
    chrome.cast.requestSession(function(session) {
        castSession = session;
        const mediaInfo = new chrome.cast.media.MediaInfo(currentVideoUrl, 'application/x-mpegurl');
        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        session.loadMedia(request, function() {
            showToast('Chromecast 投屏成功', 'success');
        }, function(err) {
            showToast('Chromecast 加载失败: ' + err.description, 'error');
        });
    }, function(err) {
        showToast('Chromecast 连接失败: ' + err.description, 'error');
    });
}

function loadChromecastSDK() {
    if (document.getElementById('cast-sdk')) {
        showToast('Chromecast SDK 加载中，请稍后重试', 'info');
        return;
    }
    const script = document.createElement('script');
    script.id = 'cast-sdk';
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.onload = function() {
        setTimeout(() => {
            if (window.chrome && chrome.cast) {
                initializeCastApi();
            }
        }, 1000);
    };
    document.head.appendChild(script);
    showToast('正在加载 Chromecast SDK...', 'info');
}

function initializeCastApi() {
    try {
        const cast = window.chrome.cast;
        const sessionRequest = new cast.SessionRequest(cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID);
        const apiConfig = new cast.ApiConfig(sessionRequest, function() {}, function() {});
        cast.initialize(apiConfig, function() {
            showToast('Chromecast 就绪，请重新点击投屏', 'success');
        }, function(err) {
            showToast('Chromecast 初始化失败', 'error');
        });
    } catch(e) {
        showToast('Chromecast 不可用', 'error');
    }
}

function startDLNA() {
    if (!currentVideoUrl) {
        showToast('没有可播放的视频地址', 'error');
        return;
    }
    
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    modalTitle.textContent = 'DLNA / 局域网投屏';
    
    let html = '<div style="padding:12px;max-height:70vh;overflow-y:auto;">';
    
    html += '<div style="background:rgba(0,204,255,0.06);border:1px solid rgba(0,204,255,0.15);border-radius:10px;padding:14px;margin-bottom:14px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">';
    html += '<div style="width:28px;height:28px;border-radius:6px;background:rgba(0,204,255,0.15);display:flex;align-items:center;justify-content:center;">📱</div>';
    html += '<span style="font-size:13px;color:#00ccff;font-weight:600;">投屏步骤</span>';
    html += '</div>';
    html += '<div style="font-size:12px;color:#ccc;line-height:2;">';
    html += '<div style="display:flex;align-items:center;gap:8px;"><span style="width:20px;height:20px;border-radius:50%;background:rgba(0,204,255,0.2);display:flex;align-items:center;justify-content:center;font-size:10px;color:#00ccff;flex-shrink:0;">1</span>确保手机和电视连接同一WiFi</div>';
    html += '<div style="display:flex;align-items:center;gap:8px;"><span style="width:20px;height:20px;border-radius:50%;background:rgba(0,204,255,0.2);display:flex;align-items:center;justify-content:center;font-size:10px;color:#00ccff;flex-shrink:0;">2</span>电视上打开乐播投屏 / 接收投屏APP</div>';
    html += '<div style="display:flex;align-items:center;gap:8px;"><span style="width:20px;height:20px;border-radius:50%;background:rgba(0,204,255,0.2);display:flex;align-items:center;justify-content:center;font-size:10px;color:#00ccff;flex-shrink:0;">3</span>点击下方按钮复制视频地址</div>';
    html += '<div style="display:flex;align-items:center;gap:8px;"><span style="width:20px;height:20px;border-radius:50%;background:rgba(0,204,255,0.2);display:flex;align-items:center;justify-content:center;font-size:10px;color:#00ccff;flex-shrink:0;">4</span>在投屏APP中粘贴地址并播放</div>';
    html += '</div></div>';
    
    html += '<div style="margin-bottom:14px;">';
    html += '<div style="font-size:12px;color:#888;margin-bottom:6px;">视频地址</div>';
    html += '<div style="display:flex;gap:8px;">';
    html += `<input type="text" value="${currentVideoUrl}" readonly style="flex:1;padding:10px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;font-size:11px;font-family:monospace;" id="dlnaVideoUrl">`;
    html += '<button onclick="copyDLNAUrl()" style="padding:10px 16px;background:linear-gradient(135deg,#ff6b6b,#ee5a24);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">复制</button>';
    html += '</div></div>';
    
    if (isAndroid) {
        html += '<div style="margin-bottom:14px;">';
        html += '<div style="font-size:12px;color:#888;margin-bottom:8px;">一键打开投屏APP</div>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button onclick="openCastApp(\'lebo\')" style="flex:1;padding:10px;background:rgba(0,204,255,0.08);border:1px solid rgba(0,204,255,0.2);border-radius:8px;color:#fff;font-size:12px;cursor:pointer;">乐播投屏</button>';
        html += '<button onclick="openCastApp(\'escreen\')" style="flex:1;padding:10px;background:rgba(0,204,255,0.08);border:1px solid rgba(0,204,255,0.2);border-radius:8px;color:#fff;font-size:12px;cursor:pointer;">易投屏</button>';
        html += '<button onclick="openCastApp(\'bubbleupnp\')" style="flex:1;padding:10px;background:rgba(0,204,255,0.08);border:1px solid rgba(0,204,255,0.2);border-radius:8px;color:#fff;font-size:12px;cursor:pointer;">BubbleUPnP</button>';
        html += '</div></div>';
    }
    
    html += '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;">';
    html += '<div style="font-size:11px;color:#666;line-height:1.6;">';
    html += '💡 <b style="color:#888;">提示：</b>部分智能电视支持直接在电视浏览器中打开视频地址播放。也可以将视频地址发送到微信/QQ，然后在电视端微信/QQ中打开。';
    html += '</div></div>';
    
    html += '</div>';
    modalContent.innerHTML = html;
}

function openCastApp(app) {
    const schemes = {
        'lebo': 'lebo://',
        'escreen': 'escreen://',
        'bubbleupnp': 'intent://#Intent;package=com.bubblesoft.android.bubbleupnp;end'
    };
    const url = schemes[app];
    if (url) {
        window.location.href = url;
        setTimeout(() => {
            showToast('如果未打开APP，请手动打开投屏APP并粘贴视频地址', 'info');
        }, 1500);
    }
}

function copyDLNAUrl() {
    const input = document.getElementById('dlnaVideoUrl');
    if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
            showToast('视频地址已复制，请打开投屏APP粘贴', 'success');
        }).catch(() => {
            input.select();
            document.execCommand('copy');
            showToast('视频地址已复制，请打开投屏APP粘贴', 'success');
        });
    }
}

function copyVideoUrl() {
    if (!currentVideoUrl) {
        showToast('没有可复制的视频地址', 'error');
        return;
    }
    navigator.clipboard.writeText(currentVideoUrl).then(() => {
        showToast('视频地址已复制到剪贴板', 'success');
    }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = currentVideoUrl;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('视频地址已复制到剪贴板', 'success');
    });
}