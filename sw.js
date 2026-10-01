/* ============================================================
   BIKAR · Service Worker  (v3)
   - Recibe notificaciones PUSH aunque la app esté cerrada o en segundo plano
   - Las muestra en la barra / pantalla principal del móvil (conductor y pasajero)
   - Avisa a la app (si está abierta) para que reproduzca el sonido BIKAR
   - Solo se omite la notificación si la página PRINCIPAL (app.html) está a la vista,
     porque es la única que sabe sonar. Si el usuario está en viaje.html u otra página,
     la notificación SIEMPRE se muestra (con el sonido del sistema).
   - Al tocar la notificación abre / enfoca la app
   NOTA: este archivo debe estar en la misma carpeta que app.html.
   ============================================================ */
'use strict';

const SW_VERSION = 'bikar-sw-v3';
const PAGINA_APP = 'app.html';   // página principal que reproduce el sonido BIKAR
const ICONO = new URL('icon-192.png', self.registration.scope).href;
// Vibración característica BIKAR (solo Android)
const VIBRACION_VIAJE = [350, 120, 350, 120, 700, 200, 350, 120, 350];
const VIBRACION_AVISO = [250, 100, 250, 100, 400];

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
// Sin caché: la app siempre carga la versión más reciente (el handler existe para que sea instalable)
self.addEventListener('fetch', () => {});

const esPaginaApp = (c) => {
  try { return new URL(c.url).pathname.split('/').pop() === PAGINA_APP; } catch (e) { return false; }
};

/* ---------------- PUSH RECIBIDO ---------------- */
self.addEventListener('push', (event) => {
  let datos = {};
  if (event.data) {
    try { datos = event.data.json() || {}; }
    catch (e) { datos = { cuerpo: event.data.text() }; }
  }

  const tipo = datos.tipo || '';
  const esViaje = tipo === 'nuevo_viaje';          // solicitud nueva (conductor)
  const esEstado = tipo === 'estado_viaje';        // cambio de estado del viaje (pasajero / conductor)
  const titulo = datos.titulo || 'BIKAR';
  const opciones = {
    body: datos.cuerpo || 'Tienes una nueva notificación en BIKAR',
    icon: datos.icono || ICONO,
    tag: datos.tag || (datos.viaje_id ? 'bikar-viaje-' + datos.viaje_id : 'bikar-aviso'),
    renotify: false,                 // si ya existe una con el mismo tag (p. ej. creada por la app) se reemplaza sin sonar dos veces
    requireInteraction: esViaje,     // en escritorio permanece hasta que el conductor la atienda
    silent: false,                   // usa el sonido de notificación del sistema
    vibrate: esViaje ? VIBRACION_VIAJE : VIBRACION_AVISO,
    timestamp: Date.now(),
    data: { url: datos.url || null, viaje_id: datos.viaje_id || null, tipo: tipo || null }
  };
  if (esViaje) opciones.actions = [{ action: 'ver', title: 'Ver solicitud' }];

  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // A cualquier ventana abierta de la app se le avisa para que actualice y suene el tono BIKAR
    ventanas.forEach((c) => {
      try {
        if (esViaje) c.postMessage({ tipo: 'push-viaje', viaje_id: datos.viaje_id || null });
        else if (esEstado) c.postMessage({ tipo: 'push-estado', viaje_id: datos.viaje_id || null, estado: datos.estado || null });
      } catch (e) {}
    });

    // Solo si la página principal está a la vista y con foco ella misma avisa (sonido + toast): no se duplica.
    // En viaje.html u otras páginas NO hay sonido propio, así que la notificación del sistema se muestra siempre.
    // En iPhone/iPad siempre se debe mostrar una notificación (política de Safari).
    const esApple = /iPhone|iPad|iPod/i.test((self.navigator && self.navigator.userAgent) || '');
    const appEnPrimerPlano = ventanas.some((c) => esPaginaApp(c) && c.visibilityState === 'visible' && c.focused);
    if (appEnPrimerPlano && !esApple) return;

    try {
      await self.registration.showNotification(titulo, opciones);
    } catch (e) {
      // Si algún ajuste no lo admite el dispositivo, se muestra la versión básica para que el aviso NUNCA se pierda
      await self.registration.showNotification(titulo, { body: opciones.body, icon: ICONO, tag: opciones.tag, data: opciones.data });
    }
  })());
});

/* ---------------- TOQUE EN LA NOTIFICACIÓN ---------------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const datos = event.notification.data || {};
  const destino = new URL(datos.url || PAGINA_APP, self.registration.scope).href;
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
