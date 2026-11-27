---
name: local-mcp-test
description: Use when checking local MCP connectivity, exchanging messages, data, or events with the paired Chrome extension, or subscribing to the local test event in ChatGPT Work.
---

# Local MCP Test

Start with `ping` and optionally `get_server_status` to check the local MCP connection. `send_message` stores a persistent message and queues it for the paired Chrome extension; `get_message` reads the latest ChatGPT message. Use `send_to_extension` with kind `message`, `data`, or `event` to queue another item for Chrome. Use `get_extension_messages` to retrieve message, data, or event items received from Chrome, passing `after_id` to continue from a cursor. When asked to check messages from Chrome, call this tool and report the returned items. The return path is pull-based in local stdio mode: ChatGPT receives the data when it calls the inbox tool; it cannot wake an idle chat. Automatic Work-chat event delivery requires Streamable HTTP and Secure MCP Tunnel. Use `get_extension_status` to check pairing and queues.

To pair Chrome, run `py -3 .\\server\\dashboard.py`, open `http://127.0.0.1:8765`, load the package's `extension` directory from `chrome://extensions` using **Load unpacked**, then enter the dashboard's one-time pairing code in the extension popup. Keep the dashboard running. The dashboard **Clear all data** action deletes local messages, events, subscriptions, extension inbox/outbox, and activity, then unpairs Chrome and creates a fresh one-time code. The extension clears its local cached inbox on the next poll after reset. The popup polls frequently while open; Chrome's background alarm can be delayed while closed.

For event testing, ChatGPT Work must subscribe to `test.message.created`. A local operator can queue one event with `py -3 .\\server\\trigger_event.py "test message"`. Events are delivered by signed HTTPS webhook to the already-subscribed Work chat. Event subscriptions require the supported Streamable HTTP connection path and a running Secure MCP Tunnel for a private local server. This plugin does not call an OpenAI inference API or start arbitrary new chats.
