# Local MCP Test and Chrome Bridge

A dependency-free Python MCP server for ping, persistent two-way messages, and a local Chrome extension bridge for messages, JSON data, and named events. It stores messages, recent activity, extension queues, event subscriptions, and queued test events under `%LOCALAPPDATA%\\LocalMcpTest`.

## Important connection requirement

The current plugin install uses local stdio, which works for local ChatGPT Desktop tool calls. MCP Events are supported in ChatGPT Work web or Work with Cloud selected in desktop and require an MCP connection that supports Streamable HTTP. To use events with this server, connect it through Secure MCP Tunnel and keep `tunnel-client` running. Tunnel setup needs a `tunnel_id` and a restricted Platform runtime API key; this is not an OpenAI inference API key. The tunnel must be associated with the ChatGPT workspace and the operator must have Tunnels Read + Use.

The server implements MCP `events/list`, `events/subscribe`, and `events/unsubscribe`, callback challenge verification, signed webhook delivery, persistent subscriptions, and an event queue. A subscription lasts 24 hours and ChatGPT refreshes it. The event callback must be HTTPS and resolve to public IP addresses. The process needs outbound HTTPS to the callback.

## Windows local setup

No package installation is required. Python 3.10+ and the Windows `py` launcher are required.

For a local stdio connectivity run:

```powershell
py -3 .\\server\\server.py
```

ChatGPT Desktop normally starts the stdio process for plugin calls. Stop a manually started process with Ctrl+C.

After updating the private plugin, restart ChatGPT Desktop or reconnect the plugin so its local MCP process loads the new version.

### Live local dashboard

Open a second PowerShell window in the plugin folder and run:

```powershell
py -3 .\\server\\dashboard.py
```

Then open <http://127.0.0.1:8765>. The dashboard refreshes automatically and shows whether the MCP process is alive, the latest message, event delivery states, active event subscriptions, and recent tool activity. Its **Queue event** button adds a test event. The dashboard listens only on this computer; close its PowerShell window or press Ctrl+C to stop it.

## Connect the Chrome extension

1. Start the local dashboard as above and leave it running.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**.
3. Select the package's `extension` folder.
4. Open the dashboard at <http://127.0.0.1:8765> and copy the one-time pairing code shown in the **Chrome extension** card.
5. Open the **Local MCP Bridge** extension, enter the code, and select **Connect**. The code expires after ten minutes and can be regenerated from the dashboard.

The route is two-way: ChatGPT sends through `send_message` or `send_to_extension` → MCP plugin → local server → Chrome extension. Chrome sends messages, JSON data, or named events → local server → `get_extension_messages` → ChatGPT. Ask ChatGPT to check the extension inbox, or call `get_extension_messages` with the last `next_after_id` cursor. A local stdio MCP tool response cannot wake an idle chat; automatic push into a ChatGPT Work chat requires the separate Streamable HTTP event subscription and Secure MCP Tunnel setup above. For local extension message exchange, no tunnel or inference API key is needed. The extension popup checks for new items while open; its background worker also checks periodically. `get_extension_status` reports pairing and queue state. The dashboard's **Clear all data** button deletes local message/event/activity and extension history, invalidates the pairing, and provides a fresh pairing code; Chrome's cached received history is removed the next time it contacts the server.

The browser extension uses the dashboard's `127.0.0.1:8765` API and a one-time pairing code. Keep the dashboard running while using the extension. The extension's bearer token is saved in Chrome's local extension storage and can be replaced by creating a new pairing code and pairing again.

## Test protocol locally

With the dashboard open, ask ChatGPT Desktop to call `ping`, send a short message with `send_message`, and read it back with `get_message`. Watch the recent activity and latest message update. Messages remain in the local store across server restarts until **Clear all data** is selected from the dashboard. The event catalog can be checked with `events/list` by an MCP client that supports the MCP Events extension.

## Test an event after tunnel and subscription setup

1. In a ChatGPT Work chat on web, or Work with Cloud selected in desktop, subscribe to `test.message.created` and ask ChatGPT to show the test message when it arrives.
2. Keep the local server and `tunnel-client` running.
3. In PowerShell run:

```powershell
py -3 .\\server\\trigger_event.py "hello from my local Windows terminal"
```

4. ChatGPT should receive the event in the subscribed Work chat. Review `%LOCALAPPDATA%\\LocalMcpTest\\server.log` for subscription and delivery outcomes.

No event can create an arbitrary new chat; ChatGPT delivers an event to the chat that subscribed. No event orchestration beyond this test event is included.
