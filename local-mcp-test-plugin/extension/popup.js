const API = "http://127.0.0.1:8765";
const $ = (id) => document.getElementById(id);

async function call(path, options = {}) {
  const { bridgeToken } = await chrome.storage.local.get("bridgeToken");
  if (!bridgeToken) throw new Error("Pair this extension first.");
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${bridgeToken}` };
  const response = await fetch(`${API}${path}`, { ...options, headers, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || `Local server returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function renderItems(items) {
  const box = $("items");
  if (!items.length) {
    box.innerHTML = '<div class="muted">No items received yet.</div>';
    return;
  }
  box.innerHTML = items.slice().reverse().map((item) => {
    const payload = typeof item.payload === "string" ? item.payload : JSON.stringify(item.payload, null, 2);
    const title = item.kind === "event" ? `${item.kind}: ${item.name || "event"}` : item.kind;
    return `<div class="item"><div class="kind">${escapeHtml(title)} · ${escapeHtml(item.direction || "server")}</div><div class="payload">${escapeHtml(payload)}</div><div class="small">${escapeHtml(item.created_at || "")}</div></div>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function refresh() {
  try {
    const response = await call("/api/extension/outbox");
    const { receivedItems = [] } = await chrome.storage.local.get("receivedItems");
    const known = new Set(receivedItems.map((item) => item.bridge_id));
    const fresh = response.items.filter((item) => !known.has(item.id)).map((item) => ({ ...item, bridge_id: item.id, direction: "server_to_extension" }));
    const merged = [...receivedItems, ...fresh].slice(-100);
    if (fresh.length) {
      await chrome.storage.local.set({ receivedItems: merged });
      await call("/api/extension/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: fresh.map((item) => item.id) }) });
    }
    renderItems(merged);
    $("status").textContent = "Connected to the local MCP server";
    $("status").classList.remove("error");
    $("app").classList.remove("hidden");
    $("pairCard").classList.add("hidden");
  } catch (error) {
    $("status").textContent = String(error.message || error);
    $("status").classList.add("error");
    const { bridgeToken } = await chrome.storage.local.get("bridgeToken");
    if (!bridgeToken || error.status === 401) {
      if (error.status === 401) await chrome.storage.local.remove(["bridgeToken", "receivedItems", "lastBridgePoll", "bridgeError"]);
      $("pairCard").classList.remove("hidden");
      $("app").classList.add("hidden");
    }
  }
}

$("pairButton").addEventListener("click", async () => {
  const status = $("status");
  try {
    status.textContent = "Pairing…";
    const response = await fetch(`${API}/api/extension/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: $("pairCode").value.trim() }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Pairing failed");
    await chrome.storage.local.set({ bridgeToken: result.token });
    await refresh();
  } catch (error) {
    status.textContent = String(error.message || error);
    status.classList.add("error");
  }
});

$("kind").addEventListener("change", () => {
  const kind = $("kind").value;
  $("nameLabel").classList.toggle("hidden", kind !== "event");
  $("name").classList.toggle("hidden", kind !== "event");
  $("payloadLabel").textContent = kind === "message" ? "Message" : "JSON payload";
  $("payload").placeholder = kind === "message" ? "Type a message" : '{ "key": "value" }';
});
$("kind").dispatchEvent(new Event("change"));

$("sendButton").addEventListener("click", async () => {
  try {
    const kind = $("kind").value;
    let payload = $("payload").value;
    if (kind !== "message") payload = JSON.parse(payload);
    const item = { kind, payload };
    if (kind === "event") item.name = $("name").value.trim();
    const result = await call("/api/extension/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
    $("notice").textContent = `Sent item ${result.id} to the MCP inbox.`;
    $("payload").value = "";
  } catch (error) {
    $("notice").textContent = String(error.message || error);
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.receivedItems) renderItems(changes.receivedItems.newValue || []);
});
refresh();
const timer = setInterval(() => { chrome.runtime.sendMessage({ type: "poll_now" }); refresh(); }, 2000);
window.addEventListener("unload", () => clearInterval(timer));
