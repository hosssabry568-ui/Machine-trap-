/* ══════════════════════════════════════════════════════════
   MACHINE TRAP — Service Worker v2.0
   استراتيجية: Cache First للأصول الثابتة، Network First للـ Firebase
══════════════════════════════════════════════════════════ */

const CACHE_NAME      = 'machine-trap-v2';
const RUNTIME_CACHE   = 'machine-trap-runtime-v2';
const FONT_CACHE      = 'machine-trap-fonts-v1';

/* الأصول الأساسية التي تُحمَّل عند التثبيت */
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* روابط الخطوط — تُخزَّن بشكل منفصل */
const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Orbitron:wght@400;700;900&display=swap',
];

/* روابط خارجية تُستخدم أونلاين فقط (Firebase) */
const NETWORK_ONLY_PATTERNS = [
  /firebaseio\.com/,
  /firebase\.googleapis\.com/,
  /gstatic\.com\/firebasejs/,
  /googleapis\.com/,
];

/* ──────────────────────────────────────────
   INSTALL — تثبيت وتخزين الأصول الأساسية
────────────────────────────────────────── */
self.addEventListener('install', event => {
  console.log('[SW] Installing Machine Trap v2...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching core assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Pre-cache complete');
        return self.skipWaiting(); // تفعيل فوري بدون انتظار
      })
      .catch(err => console.warn('[SW] Pre-cache failed (some assets missing):', err))
  );
});

/* ──────────────────────────────────────────
   ACTIVATE — حذف الكاشات القديمة
────────────────────────────────────────── */
self.addEventListener('activate', event => {
  console.log('[SW] Activating Machine Trap v2...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name =>
            name !== CACHE_NAME &&
            name !== RUNTIME_CACHE &&
            name !== FONT_CACHE
          )
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Activation complete');
      return self.clients.claim(); // السيطرة الفورية على جميع التابات
    })
  );
});

/* ──────────────────────────────────────────
   FETCH — استراتيجيات الكاش
────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Firebase وروابط الـ API → Network Only (لا نخزنها) */
  if (NETWORK_ONLY_PATTERNS.some(pattern => pattern.test(request.url))) {
    event.respondWith(
      fetch(request).catch(() => {
        // إذا فشل الـ Firebase نرجع رسالة offline JSON
        if (request.headers.get('accept')?.includes('application/json')) {
          return new Response(
            JSON.stringify({ error: 'offline', message: 'لا يوجد اتصال بالإنترنت' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  /* 2. الخطوط من Google Fonts → Cache First (مع Stale While Revalidate) */
  if (
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const fetchPromise = fetch(request)
            .then(response => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            })
            .catch(() => null);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  /* 3. الملف الرئيسي index.html → Network First (دائماً نحاول الجديد) */
  if (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('Machine-trap-/')
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match('./index.html').then(cached => {
            if (cached) return cached;
            // صفحة بديلة إذا لم يكن هناك كاش
            return new Response(OFFLINE_PAGE_HTML, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          })
        )
    );
    return;
  }

  /* 4. باقي الأصول (icons, css, js) → Cache First */
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request)
        .then(response => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          // إذا كان الطلب لصورة نرجع placeholder
          if (request.destination === 'image') {
            return new Response(PLACEHOLDER_SVG, {
              headers: { 'Content-Type': 'image/svg+xml' }
            });
          }
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

/* ──────────────────────────────────────────
   BACKGROUND SYNC — مزامنة الدرجات عند العودة للإنترنت
────────────────────────────────────────── */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-scores') {
    console.log('[SW] Background sync: syncing scores');
    event.waitUntil(syncPendingScores());
  }
});

async function syncPendingScores() {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    // يمكن توسيع هذا لاحقاً لمزامنة الدرجات المحفوظة محلياً
    console.log('[SW] Scores sync complete');
  } catch (err) {
    console.error('[SW] Scores sync failed:', err);
  }
}

/* ──────────────────────────────────────────
   PUSH NOTIFICATIONS (للمستقبل)
────────────────────────────────────────── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'فخ الآلة', {
      body: data.body || 'لديك تحدي جديد!',
      icon: './icons/icon-192.png',
      badge: './icons/icon-96.png',
      dir: 'rtl',
      lang: 'ar',
      vibrate: [200, 100, 200],
      data: { url: data.url || './' },
      actions: [
        { action: 'play', title: '🎮 العب الآن' },
        { action: 'close', title: '✖ لاحقاً' }
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'close') return;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('Machine-trap') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(event.notification.data?.url || './');
    })
  );
});

/* ──────────────────────────────────────────
   OFFLINE FALLBACK PAGE
────────────────────────────────────────── */
const OFFLINE_PAGE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>فخ الآلة — بدون اتصال</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family:'Cairo',sans-serif;
    background:#0a0a0f;
    color:#fff0d8;
    min-height:100vh;
    display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:20px;
    text-align:center;padding:24px;
  }
  .robot{font-size:72px;animation:flt 2s ease-in-out infinite}
  @keyframes flt{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
  h1{font-size:1.6rem;font-weight:900;color:#ff9f1c;text-shadow:0 0 20px #ff9f1c}
  p{color:#bba070;font-size:.95rem;line-height:1.7;max-width:300px}
  .btn{
    margin-top:8px;padding:13px 32px;
    background:linear-gradient(180deg,#ffb84d,#e07800);
    color:#fff;font-size:1rem;font-weight:900;
    border:none;border-radius:10px;cursor:pointer;
    border-bottom:4px solid #7a3200;
    box-shadow:0 6px 0 #7a3200;
    font-family:'Cairo',sans-serif;
  }
  .btn:active{transform:translateY(4px);box-shadow:none}
  .dot{width:8px;height:8px;border-radius:50%;background:#ff9f1c;display:inline-block;
    animation:d 1.2s ease-in-out infinite}
  .dot:nth-child(2){animation-delay:.2s} .dot:nth-child(3){animation-delay:.4s}
  @keyframes d{0%,80%,100%{transform:scale(.5);opacity:.4}40%{transform:scale(1);opacity:1}}
</style>
</head>
<body>
  <div class="robot">🤖</div>
  <h1>أنت بدون إنترنت!</h1>
  <p>الآلة تنتظر اتصالك... تحقق من شبكتك وحاول مجدداً.</p>
  <div style="display:flex;gap:6px;align-items:center;color:#ff9f1c;font-size:.85rem">
    في انتظار الاتصال
    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
  </div>
  <button class="btn" onclick="location.reload()">🔄 حاول مجدداً</button>
</body>
</html>`;

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" fill="#111118" rx="20"/>
  <text x="96" y="110" font-size="80" text-anchor="middle">🤖</text>
</svg>`;

console.log('[SW] Machine Trap Service Worker v2 loaded ✅');
