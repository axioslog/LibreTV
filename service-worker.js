const CACHE_NAME = 'libretv-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/player.html',
    '/watch.html',
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

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
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
