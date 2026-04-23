/*! coi-serviceworker — Cross-Origin Isolation via Service Worker
    Based on gzuidhof/coi-serviceworker (MIT). Patches COOP/COEP headers
    client-side so static hosts like GitHub Pages can run in
    cross-origin-isolated mode, enabling SharedArrayBuffer + WASM threads. */

(() => {
  // When executing as a service worker (no `window` present)
  if (typeof window === 'undefined') {
    let coepCredentialless = false;

    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener('message', (ev) => {
      if (!ev.data) return;
      if (ev.data.type === 'deregister') {
        self.registration.unregister()
          .then(() => self.clients.matchAll())
          .then(clients => clients.forEach(c => c.navigate(c.url)));
      } else if (ev.data.type === 'coepCredentialless') {
        coepCredentialless = !!ev.data.value;
      }
    });

    self.addEventListener('fetch', (event) => {
      const r = event.request;
      if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

      const request = (coepCredentialless && r.mode === 'no-cors')
        ? new Request(r, { credentials: 'omit', cache: r.cache })
        : r;

      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.status === 0) return response;
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Cross-Origin-Embedder-Policy',
              coepCredentialless ? 'credentialless' : 'require-corp');
            if (!coepCredentialless) newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
            newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders,
            });
          })
          .catch((e) => console.error(e))
      );
    });
    return;
  }

  // When executing as a regular page script
  const reloadedBySelf = window.sessionStorage.getItem('coiReloadedBySelf');
  window.sessionStorage.removeItem('coiReloadedBySelf');

  const coi = Object.assign({
    shouldRegister: () => !reloadedBySelf,
    shouldDeregister: () => false,
    coepCredentialless: () => !(window.chrome || window.netscape),
    coepDegrade: () => true,
    doReload: () => window.location.reload(),
    quiet: false,
  }, window.coi || {});

  const n = navigator;
  if (!n.serviceWorker || !n.serviceWorker.controller && window.isSecureContext === false) {
    !coi.quiet && console.log('COOP/COEP Service Worker: insecure context, skipping.');
    return;
  }

  if (coi.shouldDeregister()) {
    n.serviceWorker.controller && n.serviceWorker.controller.postMessage({ type: 'deregister' });
    return;
  }

  // Already isolated? Nothing to do.
  if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

  if (!window.isSecureContext) {
    !coi.quiet && console.log('COOP/COEP Service Worker: needs HTTPS or localhost.');
    return;
  }

  n.serviceWorker.register(window.document.currentScript.src).then(
    (registration) => {
      !coi.quiet && console.log('COOP/COEP Service Worker registered', registration.scope);

      registration.addEventListener('updatefound', () => {
        !coi.quiet && console.log('Reloading to apply updated COOP/COEP SW.');
        window.sessionStorage.setItem('coiReloadedBySelf', 'updatefound');
        coi.doReload();
      });

      if (registration.active && !n.serviceWorker.controller) {
        !coi.quiet && console.log('Reloading to activate COOP/COEP SW.');
        window.sessionStorage.setItem('coiReloadedBySelf', 'notcontrolling');
        coi.doReload();
      }
    },
    (err) => {
      !coi.quiet && console.error('COOP/COEP Service Worker failed to register:', err);
    }
  );
})();
