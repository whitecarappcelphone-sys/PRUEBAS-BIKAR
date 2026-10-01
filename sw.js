/* ============================================================
   BIKAR · Service Worker
   - Recibe notificaciones PUSH aunque la app esté cerrada o en segundo plano
   - Muestra la notificación con vibración característica de BIKAR
   - Avisa a la app (si está abierta) para que reproduzca el sonido BIKAR
   - Al tocar la notificación abre / enfoca la app
   NOTA: este archivo debe estar en la misma carpeta que la página de la app.
   ============================================================ */
'use strict';

const SW_VERSION = 'bikar-sw-v1';
const ICONO = new URL('icon-192.png', self.registration.scope).href;
// Vibración característica BIKAR (solo Android): tres pulsos cortos y uno largo
const VIBRACION_VIAJE = [350, 120, 350, 120, 700, 200, 350, 120, 350];

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
// Sin caché: la app siempre carga la versión más reciente (el handler existe para que sea instalable)
self.addEventListener('fetch', () => {});

/* ---------------- PUSH RECIBIDO ---------------- */
self.addEventListener('push', (event) => {
  let datos = {};
  if (event.data) {
    try { datos = event.data.json() || {}; }
    catch (e) { datos = { cuerpo: event.data.text() }; }
  }

  const esViaje = datos.tipo === 'nuevo_viaje';
  const titulo = datos.titulo || 'BIKAR';
  const opciones = {
    body: datos.cuerpo || 'Tienes una nueva notificación en BIKAR',
    icon: datos.icono || ICONO,
    tag: datos.tag || (esViaje ? 'bikar-viaje-' + datos.viaje_id : 'bikar-aviso'),
    renotify: true,                  // vuelve a sonar / vibrar aunque ya exista una notificación igual
    requireInteraction: esViaje,     // en escritorio permanece hasta que el conductor la atienda
    silent: false,                   // usa el sonido de notificación del sistema
    vibrate: esViaje ? VIBRACION_VIAJE : [200, 100, 200],
    timestamp: Date.now(),
    data: { url: datos.url || null, viaje_id: datos.viaje_id || null, tipo: datos.tipo || null },
    actions: esViaje ? [{ action: 'ver', title: 'Ver solicitud' }] : []
  };

  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // Si la app está abierta (en primer plano o en segundo plano) le pedimos que suene el tono BIKAR
    if (esViaje) {
      ventanas.forEach((c) => {
        try { c.postMessage({ tipo: 'push-viaje', viaje_id: datos.viaje_id || null }); } catch (e) {}
      });
    }

    // Si la app está visible y con foco, ella misma avisa (sonido + tarjeta): no duplicamos la notificación.
    // En iPhone/iPad siempre se debe mostrar una notificación (política de Safari).
    const esApple = /iPhone|iPad|iPod/i.test((self.navigator && self.navigator.userAgent) || '');
    const appEnPrimerPlano = ventanas.some((c) => c.visibilityState === 'visible' && c.focused);
    if (appEnPrimerPlano && !esApple) return;

    await self.registration.showNotification(titulo, opciones);
  })());
});

/* ---------------- TOQUE EN LA NOTIFICACIÓN ---------------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const datos = event.notification.data || {};
  const destino = new URL(datos.url || './', self.registration.scope).href;
  const rutaDestino = new URL(destino).pathname;

  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reutiliza la ventana de la app si ya está abierta
    for (const c of ventanas) {
      let ruta = '';
      try { ruta = new URL(c.url).pathname; } catch (e) {}
      if (ruta === rutaDestino && 'focus' in c) {
        await c.focus();
        try { c.postMessage({ tipo: 'abrir-viaje', viaje_id: datos.viaje_id || null }); } catch (e) {}
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(destino);
  })());
});

/* ---------------- LA SUSCRIPCIÓN CAMBIÓ / EXPIRÓ ---------------- */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    ventanas.forEach((c) => { try { c.postMessage({ tipo: 'renovar-push' }); } catch (e) {} });
  })());
});
