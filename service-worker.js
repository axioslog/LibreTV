const CACHE_NAME = 'libretv-v3.2.0';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/player.html',
    '/offline.html',
    '/watch.html',
    '/VERSION.txt',
    '/css/styles.css',
    '/css/index.css',
    '/css/player.css',
    '/css/watch.css',
    '/css/modals.css',
    '/js/config.js',
    '/js/app.js',
    '/js/api.js',
    '/js/search.js',
    '/js/player.js',
    '/js/ui.js',
    '/js/douban.js',
    '/js/password.js',
    '/js/proxy-auth.js',
    '/js/customer_site.js',
    '/js/pwa-register.js',
    '/js/version-check.js',
    '/js/offline-cache-enhanced.js',
    '/js/download-manager.js',
    '/libs/hls.min.js',
    '/libs/artplayer.min.js',
    '/libs/tailwindcss.min.js',
    '/libs/sha256.min.js',
    '/image/logo.png',
    '/image/logo-black.png',
    '/manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('SW: 部分资源缓存失败', err);
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

function swOpenDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LibreTVOffline', 6);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (db.objectStoreNames.contains('segments')) db.deleteObjectStore('segments');
            if (!db.objectStoreNames.contains('videos')) {
                const videoStore = db.createObjectStore('videos', { keyPath: 'id' });
                videoStore.createIndex('status', 'status', { unique: false });
                videoStore.createIndex('sourceCode', 'sourceCode', { unique: false });
                videoStore.createIndex('createdAt', 'createdAt', { unique: false });
                videoStore.createIndex('expiresAt', 'expiresAt', { unique: false });
            }
            const segmentStore = db.createObjectStore('segments', { keyPath: 'id' });
            segmentStore.createIndex('cacheId', 'cacheId', { unique: false });
            if (!db.objectStoreNames.contains('blobs')) {
                const blobStore = db.createObjectStore('blobs', { keyPath: 'id' });
                blobStore.createIndex('cacheId', 'cacheId', { unique: false });
            }
            if (!db.objectStoreNames.contains('cache_meta')) {
                const metaStore = db.createObjectStore('cache_meta', { keyPath: 'id' });
                metaStore.createIndex('key', 'key', { unique: true });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function swGetRecord(db, storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function handleOfflineData(pathname) {
    try {
        const db = await swOpenDB();

        if (pathname.startsWith('/offline-m3u8/')) {
            const cacheId = pathname.replace('/offline-m3u8/', '');
            const video = await swGetRecord(db, 'videos', cacheId);
            if (!video || !video.rewrittenM3u8) {
                return new Response('Not found', { status: 404 });
            }
            return new Response(video.rewrittenM3u8, {
                headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' }
            });
        }

        if (pathname.startsWith('/offline-seg/')) {
            const pathPart = pathname.replace('/offline-seg/', '');
            const lastSlash = pathPart.lastIndexOf('/');
            if (lastSlash === -1) return new Response('Bad request', { status: 400 });
            const cacheId = pathPart.substring(0, lastSlash);
            const index = pathPart.substring(lastSlash + 1);
            const segKey = cacheId + '_' + index;
            const segment = await swGetRecord(db, 'segments', segKey);
            if (!segment || !segment.data) {
                return new Response('Not found', { status: 404 });
            }
            return new Response(segment.data, {
                headers: { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache' }
            });
        }

        if (pathname.startsWith('/offline-key/')) {
            const pathPart = pathname.replace('/offline-key/', '');
            const lastSlash = pathPart.lastIndexOf('/');
            if (lastSlash === -1) return new Response('Bad request', { status: 400 });
            const cacheId = pathPart.substring(0, lastSlash);
            const index = pathPart.substring(lastSlash + 1);
            const keyKey = cacheId + '_key_' + index;
            const keyData = await swGetRecord(db, 'segments', keyKey);
            if (!keyData || !keyData.data) {
                return new Response('Not found', { status: 404 });
            }
            return new Response(keyData.data, {
                headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-cache' }
            });
        }

        return new Response('Not found', { status: 404 });
    } catch (err) {
        console.error('SW offline data error:', err);
        return new Response('Internal error', { status: 500 });
    }
}

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // VERSION.txt 始终不缓存，确保获取最新版本
    if (url.pathname === '/VERSION.txt') {
        event.respondWith(fetch(event.request));
        return;
    }

    if (url.pathname.startsWith('/offline-m3u8/') ||
        url.pathname.startsWith('/offline-seg/') ||
        url.pathname.startsWith('/offline-key/')) {
        event.respondWith(handleOfflineData(url.pathname));
        return;
    }

    if (url.pathname.startsWith('/proxy/')) {
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        return;
    }

    if (event.request.method !== 'GET') {
        return;
    }

    if (url.origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            const fetchPromise = fetch(event.request).then(response => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response;
            }).catch(() => {
                return cached;
            });

            return cached || fetchPromise;
        })
    );
});
