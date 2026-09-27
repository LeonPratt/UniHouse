// Rota reminders are opt-in for each browser installation, after sign-in.
const pushStatus = document.getElementById('pushStatus');
const pushEnable = document.getElementById('pushEnable');
const pushDisable = document.getElementById('pushDisable');
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function vapidBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function matchesVapid(subscription, publicKey) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const expected = vapidBytes(publicKey);
  const actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

async function currentPushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription() || null;
}

async function refreshPushControls() {
  const config = window.HOUSEMATE_CONFIG || {};
  if (!window.housemateAuth) {
    pushStatus.textContent = 'Sign in to manage reminders.';
    return;
  }
  if (!window.isSecureContext || !pushSupported) {
    pushStatus.textContent = 'This browser does not support push reminders here. Use HTTPS or localhost in a supported browser.';
    return;
  }
  if (!config.vapidPublicKey) {
    pushStatus.textContent = 'Rota reminders have not been set up for this house yet.';
    return;
  }
  try {
    const subscription = await currentPushSubscription();
    const { data, error } = subscription
      ? await window.housemateAuth.supabase.from('push_subscriptions').select('id')
          .eq('endpoint', subscription.endpoint).eq('user_id', window.housemateAuth.session.user.id).maybeSingle()
      : { data: null, error: null };
    if (error) throw error;
    const enabled = Boolean(subscription && data);
    pushStatus.textContent = enabled
      ? 'Rota reminders are on for this device. Due tasks arrive at 9am UK time.'
      : 'Rota reminders are off on this device.';
    pushEnable.hidden = enabled || Notification.permission === 'denied';
    pushDisable.hidden = !enabled;
    if (Notification.permission === 'denied') pushStatus.textContent = 'Notifications are blocked. Allow them in your browser settings, then reopen this page.';
  } catch (error) {
    pushStatus.textContent = `Could not check reminders: ${error.message}`;
  }
}

async function enableRotaPush() {
  const auth = window.housemateAuth;
  const vapidKey = window.HOUSEMATE_CONFIG?.vapidPublicKey;
  if (!auth || !pushSupported || !window.isSecureContext || !vapidKey) return;
  pushEnable.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable reminders.');
    const registration = await navigator.serviceWorker.register('./sw.js');
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !matchesVapid(subscription, vapidKey)) {
      const { error } = await auth.supabase.from('push_subscriptions').delete()
        .eq('endpoint', subscription.endpoint).eq('user_id', auth.session.user.id);
      if (error) throw error;
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(vapidKey) });

    async function save(current) {
      const json = current.toJSON();
      const { data, error } = await auth.supabase.from('push_subscriptions').select('id')
        .eq('endpoint', current.endpoint).eq('user_id', auth.session.user.id).maybeSingle();
      if (error) throw error;
      if (data) return null;
      const result = await auth.supabase.from('push_subscriptions').insert({
        user_id: auth.session.user.id, endpoint: current.endpoint,
        p256dh: json.keys.p256dh, auth: json.keys.auth,
      });
      return result.error;
    }
    let error = await save(subscription);
    // A browser left signed in to another account may retain the old endpoint.
    // Replace the browser subscription to obtain a fresh endpoint for this user.
    if (error?.code === '23505') {
      await subscription.unsubscribe();
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(vapidKey) });
      error = await save(subscription);
    }
    if (error) throw error;
    await refreshPushControls();
  } catch (error) {
    pushStatus.textContent = `Could not enable reminders: ${error.message}`;
  } finally {
    pushEnable.disabled = false;
  }
}

async function disableRotaPush() {
  if (!window.housemateAuth || !pushSupported) return true;
  pushDisable.disabled = true;
  try {
    const subscription = await currentPushSubscription();
    if (subscription) {
      const { error } = await window.housemateAuth.supabase.from('push_subscriptions').delete()
        .eq('endpoint', subscription.endpoint).eq('user_id', window.housemateAuth.session.user.id);
      if (error) throw error;
      if (!await subscription.unsubscribe()) throw new Error('The browser could not remove its push subscription.');
    }
    await refreshPushControls();
    return true;
  } catch (error) {
    pushStatus.textContent = `Could not disable reminders: ${error.message}`;
    return false;
  } finally {
    pushDisable.disabled = false;
  }
}

pushEnable.addEventListener('click', enableRotaPush);
pushDisable.addEventListener('click', disableRotaPush);
window.addEventListener('housemate-auth-ready', refreshPushControls);
if (window.housemateAuth) refreshPushControls();
window.disableRotaPush = disableRotaPush;
