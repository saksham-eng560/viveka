// Offscreen document: pings the service worker every 20 s so Chrome keeps it alive.
const PING_INTERVAL_MS = 20_000;

function ping() {
  chrome.runtime.sendMessage({ type: "KEEPALIVE_PING", ts: Date.now() }).catch(() => {
    /* worker is waking up; the next ping will reach it */
  });
}

ping();
setInterval(ping, PING_INTERVAL_MS);
