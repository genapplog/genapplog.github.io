/**
 * ARQUIVO: sw.js
 * DESCRIÇÃO: Service Worker Enterprise (Offline-First)
 * AJUSTE: Inclusão do Chart.js no cache vital e bump de versão.
 */

const CACHE_NAME = 'applog-v3-enterprise'; // Subi a versão para v3
const DYNAMIC_CACHE = 'applog-dynamic-v3';

// Arquivos vitais que devem ser baixados imediatamente na instalação.
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/img/icon-512.png',
  // ✅ CORREÇÃO: Adicionamos o Chart.js aqui para garantir que os gráficos funcionem offline
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// --- 1. INSTALAÇÃO (Cache Inicial) ---
self.addEventListener('install', (event) => {
  // Força o SW a assumir o controle imediatamente
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching Shell Assets & Chart.js');
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// --- 2. ATIVAÇÃO (Limpeza de Versões Antigas) ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== DYNAMIC_CACHE) {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  // Garante que o SW controle todas as abas abertas imediatamente
  return self.clients.claim();
});

// --- 3. INTERCEPTAÇÃO DE REDE (Estratégia Híbrida) ---
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A) IGNORAR FIREBASE/GOOGLE APIS
  // Deixamos a biblioteca do Firestore cuidar do cache de dados (ela faz isso melhor que nós).
  if (url.origin.includes('firestore.googleapis.com') || 
      url.origin.includes('identitytoolkit.googleapis.com') ||
      url.href.includes('google.com/recaptcha')) {
    return; // Segue fluxo normal da rede
  }

  // B) ESTRATÉGIA: Stale-While-Revalidate (Para JS, CSS, Fontes, Imagens)
  // "Use o que tem no cache (rápido), mas atualize em segundo plano para a próxima vez."
  if (event.request.destination === 'script' || 
      event.request.destination === 'style' || 
      event.request.destination === 'image' ||
      event.request.destination === 'font') {
      
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          return caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
        // Retorna o cache se existir, senão espera a rede
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // C) ESTRATÉGIA: Network First (Para HTML / Navegação)
  // "Tente pegar a versão mais nova do site. Se cair a net, mostre o cache."
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          // Se falhar (offline), pega do cache
          return caches.match(event.request);
        })
    );
    return;
  }
});

// --- 4. TRATAMENTO DE NOTIFICAÇÕES PUSH ---
self.addEventListener('push', (event) => {
    let data = { title: 'AppLog', body: 'Nova atualização no sistema.' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: '/img/icon-192.png',
        badge: '/img/icon-192.png',
        vibrate: [100, 50, 100],
        data: { url: data.url || '/' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Abre o app ao clicar na notificação
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});