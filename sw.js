self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Show a generic reminder. */ }
  event.waitUntil(self.registration.showNotification('Rota reminder', {
    body: typeof payload.body === 'string' ? payload.body.slice(0, 180) : 'You have a rota task due today.',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: 'housemate-rota-' + (typeof payload.choreId === 'string' ? payload.choreId : 'reminder'),
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('./index.html#rotas', self.registration.scope).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clientsList.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); return existing.focus(); }
    return self.clients.openWindow(target);
  })());
});
