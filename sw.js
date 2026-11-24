// App shell cache so نَوء opens like an installed app. Data always comes live from Supabase.
const V = "nawa-v33";
const SHELL = ["./", "index.html", "styles.css", "manifest.webmanifest", "js/app.js", "js/lib.js", "js/config.js", "js/workspace.js", "js/pdf.js", "js/heat.js", "icons/icon.svg", "icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/_vercel/")) return; // never cache API/auth calls
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
