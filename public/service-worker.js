const CACHE_NAME = "hdw-connect-shell-v7";
const BASE_URL = new URL("./", self.location.href).pathname;
const SHELL_URL = `${BASE_URL}_shell.html`;
const CORE_URLS = [
  SHELL_URL,
  `${BASE_URL}manifest.webmanifest`,
  `${BASE_URL}favicon.ico`,
  `${BASE_URL}icons/icon-192.png`,
  `${BASE_URL}icons/icon-512.png`,
  `${BASE_URL}icons/apple-touch-icon.png`,
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const shellResponse = await fetch(SHELL_URL, { cache: "reload" });
    if (!shellResponse.ok) throw new Error("The offline app shell could not be downloaded.");
    await cache.put(SHELL_URL, shellResponse.clone());

    // Save the versioned JavaScript and stylesheet files referenced by the shell.
    const shellText = await shellResponse.text();
    const assets = [...shellText.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)]
      .map((match) => new URL(match[1], self.location.origin).href)
      .filter((url) => {
        const asset = new URL(url);
        return asset.origin === self.location.origin && asset.pathname.startsWith(BASE_URL);
      });
    await Promise.allSettled([...CORE_URLS.filter((url) => url !== SHELL_URL), ...assets].map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      if (response.ok) await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("hdw-connect-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Never intercept or cache authenticated backend requests, even if a URL
  // resembles an asset or is opened as a navigation.
  if (url.pathname.startsWith("/.netlify/functions/")) return;
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE_URL)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.status !== 404) return response;
        return (await caches.match(SHELL_URL)) || response;
      } catch {
        const shell = await caches.match(SHELL_URL);
        return shell || new Response("HDW CONNECT has not been opened online on this device yet. Reconnect once to finish offline setup.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })());
    return;
  }

  // The offline bundle contains only app files; patient records remain in
  // encrypted browser storage and are never placed in the Cache API.
  if (/\.(?:js|css|svg|png|ico|woff2?|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
