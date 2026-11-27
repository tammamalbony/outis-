const API = "http://127.0.0.1:8765";
const ALARM = "local-mcp-bridge-poll";

async function ensureAlarm() {
  await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}

async function authorizedFetch(path, options = {}) {
  const { bridgeToken } = await chrome.storage.local.get("bridgeToken");
  if (!bridgeToken) return null;
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${bridgeToken}` };
  return fetch(`${API}${path}`, { ...options, headers, cache: "no-store" });
}

async function pollOutbox() {
  try {
    const response = await authorizedFetch("/api/extension/outbox");
    if (!response) return;
    if (response.status === 401) {
      await chrome.storage.local.remove(["bridgeToken", "receivedItems", "lastBridgePoll", "bridgeError"]);
      return;
    }
    if (!response.ok) throw new Error(`Local server returned ${response.status}`);
    const { items } = await response.json();
    if (!items.length) return;
    const { receivedItems = [] } = await chrome.storage.local.get("receivedItems");
    const known = new Set(receivedItems.map((item) => item.bridge_id));
    const fresh = items.filter((item) => !known.has(item.id)).map((item) => ({ ...item, bridge_id: item.id, direction: "server_to_extension" }));
    const merged = [...receivedItems, ...fresh].slice(-100);
    await chrome.storage.local.set({ receivedItems: merged, lastBridgePoll: new Date().toISOString() });
    await authorizedFetch("/api/extension/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: items.map((item) => item.id) })
    });
  } catch (error) {
    await chrome.storage.local.set({ bridgeError: String(error) });
  }
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) pollOutbox();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "poll_now") pollOutbox();
});
ensureAlarm();
