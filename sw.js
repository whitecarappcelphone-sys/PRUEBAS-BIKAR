/* ============================================================
   BIKAR · Service Worker
   Maneja las notificaciones push (aunque la app esté cerrada),
   el clic en la notificación y la comunicación con las páginas.
   Debe estar en la MISMA carpeta que index.html, app.html y viaje.html.
   ============================================================ */

const VERSION = 'bikar-sw-v3';
const ICONO = './icon-192.png';
const ICONO_GRANDE = './icon-512.png';

/* ---------- ciclo de vida ---------- */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const claves = await caches.keys();
      await Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    } catch (_) { /* sin caché */ }
    await self.clients.claim();
    await avisarClientes({ tipo: 'sw-activado', version: VERSION });
  })());
});

/* ---------- utilidades ---------- */
async function avisarClientes(mensaje) {
  try {
    const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    lista.forEach((c) => c.postMessage(mensaje));
  } catch (_) { /* nada */ }
}

function leerPayload(event) {
  if (!event.data) return {};
  try { return event.data.json(); } catch (_) { /* puede venir texto */ }
  try { return JSON.parse(event.data.text()); } catch (_) { return { cuerpo: event.data.text() }; }
}

function urlSegura(payload) {
  const url = payload?.url || payload?.data?.url || payload?.url_app || self.registration.scope;
  try { return new URL(url, self.registration.scope).href; }
  catch (_) { return self.registration.scope; }
}

/* ---------- push entrante ---------- */
self.addEventListener('push', (event) => {
  const payload = leerPayload(event);

  const anidado = payload.notification || {};
  const titulo = payload.titulo || payload.title || anidado.title || 'BIKAR';
  const cuerpo = payload.cuerpo || payload.body || payload.message || anidado.body || 'Tienes una novedad en tu viaje.';
  const url = urlSegura(payload);
  const viajeId = payload.viaje_id || payload.data?.viaje_id || null;
  const tipo = payload.tipo || payload.data?.tipo || 'bikar-aviso';
  const tag = payload.tag || ('bikar-' + tipo + (viajeId ? '-' + viajeId : ''));

  const opciones = {
    body: cuerpo,
    icon: ICONO,
    badge: ICONO,
    image: payload.imagen || undefined,
    tag: tag,
    renotify: true,
    requireInteraction: !!payload.requireInteraction,
    vibrate: payload.vibrate || [250, 100, 250, 100, 400],
    timestamp: Date.now(),
    silent: false,
    data: {
      url: url,
      viaje_id: viajeId,
      tipo: tipo,
      estado: payload.estado || payload.data?.estado || null,
      rol: payload.rol || payload.data?.rol || null
    }
  };

  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(titulo, opciones);
    } catch (_) {
      /* Navegadores que exigen opciones mínimas */
      await self.registration.showNotification(titulo, { body: cuerpo, icon: ICONO, tag: tag, data: opciones.data });
    }
    /* Avisa a las pestañas abiertas para que refresquen y/o suenen */
    await avisarClientes({
      tipo: tipo === 'nuevo_viaje' || tipo === 'push-viaje' ? 'push-viaje' : 'push-estado',
      viaje_id: viajeId,
      estado: opciones.data.estado,
      titulo: titulo,
      cuerpo: cuerpo,
      url: url
    });
  })());
});

/* ---------- clic en la notificación ---------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const destino = data.url || self.registration.scope;

  if (event.action === 'cerrar') return;

  event.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cliente of lista) {
      try {
        if ('focus' in cliente) {
          if (cliente.url !== destino && 'navigate' in cliente) await cliente.navigate(destino);
          return cliente.focus();
        }
      } catch (_) { /* sigue con el siguiente */ }
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino);
  })());
});

/* Cierra la notificación si el usuario la descarta */
self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};
  avisarClientes({ tipo: 'push-cerrado', viaje_id: data.viaje_id || null });
});

/* ---------- mensajes desde las páginas ---------- */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.tipo === 'saltar-espera') self.skipWaiting();
  if (data.tipo === 'renovar-push') {
    avisarClientes({ tipo: 'renovar-push' });
  }
});

/* ---------- fetch: red primero (evita HTML viejo en caché) ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      return await fetch(req, { cache: 'no-store' });
    } catch (_) {
      const guardado = await caches.match(req);
      if (guardado) return guardado;
      throw _;
    }
  })());
});
