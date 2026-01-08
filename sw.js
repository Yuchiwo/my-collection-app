const CACHE_NAME = 'ghost-pioneer-v11';
const ASSETS_TO_CACHE = [
    './index.html',
    './styles.css?v=7',
    './script.js?v=7',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700&family=Outfit:wght@400;600&display=swap',
    'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Network first for better dev experience, fallback to cache
    event.respondWith(
        fetch(event.request)
            .catch(() => {
                return caches.match(event.request);
            })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
