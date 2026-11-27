from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import ipaddress
import json
import logging
import os
import secrets
import socket
import ssl
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

SERVER_NAME = "Local MCP Test"
SERVER_VERSION = "0.4.3"
PROTOCOL_VERSION = "2025-03-26"
EVENT_NAME = "test.message.created"
_started_at = datetime.now(timezone.utc)
_extension_pairing_code: str | None = None
_extension_pairing_expires: str | None = None

log_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "LocalMcpTest"
log_dir.mkdir(parents=True, exist_ok=True)
database_path = log_dir / "events.sqlite3"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stderr), logging.FileHandler(log_dir / "server.log", encoding="utf-8")],
)
log = logging.getLogger("local-mcp-test")

TOOLS = [
    {"name": "ping", "description": "Check that the local Python MCP server is reachable.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "send_message", "description": "Send a message from ChatGPT through the local MCP server to the paired Chrome extension, and store it as the latest ChatGPT message.", "inputSchema": {"type": "object", "properties": {"message": {"type": "string", "description": "Message to store and queue for Chrome"}}, "required": ["message"], "additionalProperties": False}},
    {"name": "get_message", "description": "Read the latest ChatGPT-to-server message, or report that none exists.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_server_status", "description": "Return simple status information for the local test server.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "send_to_extension", "description": "Send a message, JSON data item, or named event from ChatGPT through the local MCP server to the paired Chrome extension.", "inputSchema": {"type": "object", "properties": {"kind": {"type": "string", "enum": ["message", "data", "event"]}, "message": {"type": "string"}, "data": {}, "name": {"type": "string"}}, "required": ["kind"], "additionalProperties": False}},
    {"name": "get_extension_messages", "description": "Read the paired Chrome extension's inbox through the local server so ChatGPT can receive its messages, JSON data, and events. Call this when asked to check for Chrome messages; use after_id to continue from the returned cursor.", "inputSchema": {"type": "object", "properties": {"after_id": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}, "additionalProperties": False}},
    {"name": "get_extension_status", "description": "Check pairing state, recent extension contact, and queued items.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
]
EVENTS = [{
    "name": EVENT_NAME,
    "description": "A test message was added to the local event queue. ChatGPT Work can receive the message in a subscribed chat.",
    "delivery": ["webhook"],
    "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    "payloadSchema": {
        "type": "object",
        "properties": {"message": {"type": "string"}, "created_at": {"type": "string"}},
        "required": ["message", "created_at"],
        "additionalProperties": False,
    },
}]


def db_connect():
    return __import__("sqlite3").connect(database_path, timeout=10)


def init_db() -> None:
    with db_connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, name TEXT NOT NULL, arguments_json TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, expires_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)")
        db.execute("CREATE TABLE IF NOT EXISTS event_queue (event_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, created_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0)")
        columns = {row[1] for row in db.execute("PRAGMA table_info(event_queue)")}
        if "delivery_status" not in columns:
            db.execute("ALTER TABLE event_queue ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'")
        db.execute("UPDATE event_queue SET delivery_status='unknown' WHERE processed=1 AND delivery_status='pending'")
        db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY CHECK(id=1), message TEXT NOT NULL, received_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS server_state (id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT NOT NULL, last_seen TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS extension_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS extension_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS extension_auth (id INTEGER PRIMARY KEY CHECK(id=1), pairing_hash TEXT, pairing_expires TEXT, pairing_used INTEGER NOT NULL DEFAULT 0, token_hash TEXT, paired_at TEXT, last_seen TEXT)")
        db.execute("INSERT OR IGNORE INTO extension_auth(id,pairing_used) VALUES(1,1)")
        db.commit()


def rotate_extension_pairing_code() -> tuple[str, str]:
    global _extension_pairing_code, _extension_pairing_expires
    code = secrets.token_urlsafe(9)
    expires = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    digest = hashlib.sha256(code.encode()).hexdigest()
    with db_connect() as db:
        db.execute("UPDATE extension_auth SET pairing_hash=?,pairing_expires=?,pairing_used=0 WHERE id=1", (digest, expires))
        db.commit()
    _extension_pairing_code, _extension_pairing_expires = code, expires
    return code, expires


def extension_pairing_info() -> dict[str, str | None]:
    return {"code": _extension_pairing_code, "expires_at": _extension_pairing_expires}


def pair_extension(code: str) -> str | None:
    global _extension_pairing_code
    if not isinstance(code, str) or not code:
        return None
    now = datetime.now(timezone.utc).isoformat()
    digest = hashlib.sha256(code.encode()).hexdigest()
    token = secrets.token_urlsafe(32)
    with db_connect() as db:
        row = db.execute("SELECT pairing_hash,pairing_expires,pairing_used FROM extension_auth WHERE id=1").fetchone()
        if not row or row[2] or not row[0] or not hmac.compare_digest(row[0], digest) or not row[1] or row[1] < now:
            return None
        db.execute("UPDATE extension_auth SET pairing_used=1,pairing_hash=NULL,token_hash=?,paired_at=?,last_seen=? WHERE id=1", (hashlib.sha256(token.encode()).hexdigest(), now, now))
        db.commit()
    _extension_pairing_code = None
    record_activity("extension_paired", "Chrome extension paired")
    return token


def authorize_extension(token: str) -> bool:
    digest = hashlib.sha256(token.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with db_connect() as db:
        row = db.execute("SELECT token_hash FROM extension_auth WHERE id=1").fetchone()
        if not row or not row[0] or not hmac.compare_digest(row[0], digest):
            return False
        db.execute("UPDATE extension_auth SET last_seen=? WHERE id=1", (now,))
        db.commit()
    return True


def queue_extension_item(kind: str, payload: Any, name: str | None = None) -> int:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 256 * 1024:
        raise ValueError("extension item exceeds 256 KiB")
    created_at = datetime.now(timezone.utc).isoformat()
    with db_connect() as db:
        cursor = db.execute("INSERT INTO extension_outbox(kind,name,payload_json,created_at,acknowledged) VALUES(?,?,?,?,0)", (kind, name, encoded, created_at))
        item_id = int(cursor.lastrowid)
        db.commit()
    record_activity("extension_outgoing_" + kind, name or (payload if isinstance(payload, str) else encoded))
    return item_id


def record_activity(action: str, detail: str = "") -> None:
    with db_connect() as db:
        now = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT INTO activity(occurred_at,action,detail) VALUES(?,?,?)", (now, action, detail[:240]))
        db.execute("DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 100)")
        db.execute("INSERT INTO server_state(id,started_at,last_seen) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen", (_started_at.isoformat(), now))
        db.commit()


def response(request_id: Any, result: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def rpc_error(request_id: Any, code: int, message: str, data: dict[str, Any] | None = None) -> None:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "error": error}) + "\n")
    sys.stdout.flush()


def text_result(value: str, is_error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": value}], "isError": is_error}


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name == "ping":
        record_activity("ping", "Connectivity check")
        log.info("tool=ping")
        return text_result("pong - local Python MCP server is connected")
    if name == "send_message":
        message = arguments.get("message")
        if not isinstance(message, str) or not message.strip():
            return text_result("message must be a non-empty string", is_error=True)
        message = message.strip()
        received_at = datetime.now(timezone.utc).isoformat()
        with db_connect() as db:
            db.execute("INSERT INTO messages(id,message,received_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET message=excluded.message,received_at=excluded.received_at", (message, received_at))
            db.commit()
        extension_id = queue_extension_item("message", message)
        record_activity("send_message", message)
        log.info("tool=send_message characters=%d", len(message))
        return text_result(f"Message stored locally and queued for the Chrome extension (item {extension_id}). Call get_message to read it back.")
    if name == "get_message":
        with db_connect() as db:
            row = db.execute("SELECT message,received_at FROM messages WHERE id=1").fetchone()
        latest = {"message": row[0], "received_at": row[1]} if row else {"message": None, "received_at": None}
        record_activity("get_message", "Message available" if row else "No message stored")
        log.info("tool=get_message has_message=%s", row is not None)
        return text_result(json.dumps(latest, ensure_ascii=False))
    if name == "get_server_status":
        record_activity("get_server_status", "Status requested")
        log.info("tool=get_server_status")
        return text_result(json.dumps({"status": "ok", "server": SERVER_NAME, "started_at": _started_at.isoformat(), "checked_at": datetime.now(timezone.utc).isoformat()}))
    if name == "send_to_extension":
        kind = arguments.get("kind")
        if kind == "message":
            payload = arguments.get("message")
            if not isinstance(payload, str) or not payload.strip():
                return text_result("message kind requires a non-empty message", is_error=True)
            payload = payload.strip()
            item_id = queue_extension_item(kind, payload)
        elif kind == "data":
            if "data" not in arguments:
                return text_result("data kind requires a data value", is_error=True)
            item_id = queue_extension_item(kind, arguments["data"])
        elif kind == "event":
            event_name = arguments.get("name")
            if not isinstance(event_name, str) or not event_name.strip() or len(event_name) > 120:
                return text_result("event kind requires a name of 1 to 120 characters", is_error=True)
            item_id = queue_extension_item(kind, arguments.get("data"), event_name.strip())
        else:
            return text_result("kind must be message, data, or event", is_error=True)
        log.info("tool=send_to_extension kind=%s item_id=%s", kind, item_id)
        return text_result(json.dumps({"queued": True, "id": item_id, "kind": kind, "name": arguments.get("name")}))
    if name == "get_extension_messages":
        after_id = arguments.get("after_id", 0)
        limit = arguments.get("limit", 50)
        if not isinstance(after_id, int) or after_id < 0 or not isinstance(limit, int) or not 1 <= limit <= 100:
            return text_result("after_id must be non-negative and limit must be 1 to 100", is_error=True)
        with db_connect() as db:
            rows = db.execute("SELECT id,kind,name,payload_json,created_at FROM extension_inbox WHERE id>? ORDER BY id LIMIT ?", (after_id, limit)).fetchall()
        items = [{"id": row[0], "kind": row[1], "name": row[2], "payload": json.loads(row[3]), "created_at": row[4]} for row in rows]
        record_activity("extension_inbox_read", f"{len(items)} item(s) after {after_id}")
        return text_result(json.dumps({"items": items, "next_after_id": items[-1]["id"] if items else after_id}, ensure_ascii=False))
    if name == "get_extension_status":
        with db_connect() as db:
            auth = db.execute("SELECT token_hash,paired_at,last_seen FROM extension_auth WHERE id=1").fetchone()
            pending = db.execute("SELECT COUNT(*) FROM extension_outbox WHERE acknowledged=0").fetchone()[0]
            received = db.execute("SELECT COUNT(*) FROM extension_inbox").fetchone()[0]
        status = {"paired": bool(auth and auth[0]), "paired_at": auth[1] if auth else None, "last_seen": auth[2] if auth else None, "pending_outbound": pending, "received_items": received}
        return text_result(json.dumps(status))
    return text_result(f"Unknown tool: {name}", is_error=True)


def validate_public_https_url(url: str) -> tuple[str, int, str, tuple[tuple[Any, ...], ...]]:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("callback must be an HTTPS URL without credentials or a fragment")
    hostname = parsed.hostname
    port = parsed.port or 443
    infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    sockaddrs = tuple(dict.fromkeys(info[4] for info in infos))
    if not sockaddrs:
        raise ValueError("callback hostname did not resolve")
    for sockaddr in sockaddrs:
        ip = ipaddress.ip_address(sockaddr[0].split("%", 1)[0])
        if not ip.is_global:
            raise ValueError("callback resolves to a non-public address")
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return hostname, port, path, sockaddrs


def signed_headers(secret_text: str, subscription_id: str, webhook_id: str, body: bytes) -> dict[str, str]:
    if not secret_text.startswith("whsec_"):
        raise ValueError("webhook secret must start with whsec_")
    secret = base64.b64decode(secret_text[6:], validate=True)
    if not 24 <= len(secret) <= 64:
        raise ValueError("webhook signing secret must decode to 24-64 bytes")
    timestamp = str(int(time.time()))
    signed = webhook_id.encode() + b"." + timestamp.encode() + b"." + body
    signature = base64.b64encode(hmac.new(secret, signed, hashlib.sha256).digest()).decode("ascii")
    return {
        "Content-Type": "application/json",
        "webhook-id": webhook_id,
        "webhook-timestamp": timestamp,
        "webhook-signature": "v1," + signature,
        "X-MCP-Subscription-Id": subscription_id,
    }


def post_callback(url: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes]:
    hostname, port, path, sockaddrs = validate_public_https_url(url)
    conn = http.client.HTTPSConnection(hostname, port, timeout=10, context=ssl.create_default_context())
    conn._create_connection = lambda _address, timeout=None, source_address=None: socket.create_connection(sockaddrs[0], timeout=timeout, source_address=source_address)  # type: ignore[method-assign]
    try:
        conn.request("POST", path, body=body, headers=headers)
        result = conn.getresponse()
        payload = result.read(256 * 1024 + 1)
        if len(payload) > 256 * 1024:
            raise ValueError("callback response exceeds 256 KiB")
        return result.status, payload
    finally:
        conn.close()


def subscription_id(name: str, arguments: dict[str, Any], url: str) -> str:
    identity = json.dumps({"name": name, "arguments": arguments, "url": url}, sort_keys=True, separators=(",", ":"))
    return "sub_" + hashlib.sha256(identity.encode()).hexdigest()[:32]


def verify_callback(url: str, secret: str, sub_id: str) -> None:
    challenge = uuid.uuid4().hex
    webhook_id = "msg_verification_" + uuid.uuid4().hex
    body = json.dumps({"type": "verification", "challenge": challenge}, separators=(",", ":")).encode()
    status, response_body = post_callback(url, signed_headers(secret, sub_id, webhook_id, body), body)
    if not 200 <= status < 300:
        raise ValueError(f"callback verification returned HTTP {status}")
    try:
        echoed = json.loads(response_body).get("challenge")
    except (json.JSONDecodeError, AttributeError):
        echoed = None
    if not isinstance(echoed, str) or not hmac.compare_digest(echoed, challenge):
        raise ValueError("callback did not echo the verification challenge")


def handle_subscribe(request_id: Any, params: dict[str, Any]) -> None:
    name = params.get("name")
    arguments = params.get("arguments") or {}
    delivery = params.get("delivery") or {}
    url = delivery.get("url")
    secret = delivery.get("secret")
    if name != EVENT_NAME or arguments != {} or delivery.get("mode") != "webhook" or not isinstance(url, str) or not isinstance(secret, str):
        rpc_error(request_id, -32602, "invalid event subscription")
        return
    try:
        # Validate before verifying. Callback verification is required before activation.
        validate_public_https_url(url)
        sub_id = subscription_id(name, arguments, url)
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        verify_callback(url, secret, sub_id)
        with db_connect() as db:
            db.execute("INSERT INTO subscriptions(id,name,arguments_json,url,secret,expires_at,active) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,expires_at=excluded.expires_at,active=1", (sub_id, name, "{}", url, secret, expires.isoformat()))
            db.commit()
        log.info("event subscription active id=%s name=%s", sub_id, name)
        response(request_id, {"id": sub_id, "refreshBefore": expires.isoformat(), "cursor": None, "truncated": False})
    except Exception as exc:
        log.warning("event subscription rejected: %s", exc)
        rpc_error(request_id, -32015, "CallbackEndpointError", {"reason": "verification_failed"})


def handle_unsubscribe(request_id: Any, params: dict[str, Any]) -> None:
    name = params.get("name")
    arguments = params.get("arguments") or {}
    delivery = params.get("delivery") or {}
    url = delivery.get("url")
    if name == EVENT_NAME and arguments == {} and isinstance(url, str):
        sub_id = subscription_id(name, arguments, url)
        with db_connect() as db:
            db.execute("UPDATE subscriptions SET active=0 WHERE id=?", (sub_id,))
            db.commit()
        log.info("event subscription stopped id=%s", sub_id)
    response(request_id, {})


def enqueue_event(message: str) -> str:
    event_id = "evt_" + uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()
    payload = {"message": message, "created_at": created_at}
    with db_connect() as db:
        db.execute("INSERT INTO event_queue(event_id,data_json,created_at,processed) VALUES(?,?,?,0)", (event_id, json.dumps(payload, ensure_ascii=False), created_at))
        db.commit()
    log.info("event queued id=%s characters=%d", event_id, len(message))
    record_activity("event_queued", message)
    return event_id


def deliver_event(event_id: str, data_json: str, created_at: str, subscriptions: list[tuple[str, str, str]]) -> str:
    if not subscriptions:
        log.info("event not delivered id=%s reason=no_active_subscribers", event_id)
        return "no_subscribers"
    event = {"eventId": event_id, "name": EVENT_NAME, "timestamp": created_at, "data": json.loads(data_json), "cursor": None}
    body = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(body) > 256 * 1024:
        raise ValueError("event exceeds the 256 KiB delivery limit")
    delivered = 0
    for sub_id, url, secret in subscriptions:
        subscription_delivered = False
        for attempt in range(3):
            try:
                headers = signed_headers(secret, sub_id, event_id, body)
                status, _ = post_callback(url, headers, body)
                if 200 <= status < 300:
                    log.info("event delivered id=%s subscription=%s", event_id, sub_id)
                    subscription_delivered = True
                    break
                if status in (410, 413):
                    log.warning("event rejected status=%d subscription=%s", status, sub_id)
                    break
                raise OSError(f"webhook returned HTTP {status}")
            except Exception as exc:
                if attempt == 2:
                    log.error("event delivery failed id=%s subscription=%s: %s", event_id, sub_id, exc)
                else:
                    time.sleep(2 ** attempt)
        if subscription_delivered:
            delivered += 1
    return "delivered" if delivered == len(subscriptions) else "failed"


def event_dispatcher() -> None:
    while True:
        try:
            with db_connect() as db:
                pending = db.execute("SELECT event_id,data_json,created_at FROM event_queue WHERE processed=0 ORDER BY created_at LIMIT 1").fetchone()
                if not pending:
                    time.sleep(0.5)
                    continue
                event_id, data_json, created_at = pending
                subscriptions = db.execute("SELECT id,url,secret FROM subscriptions WHERE name=? AND active=1 AND expires_at>?", (EVENT_NAME, datetime.now(timezone.utc).isoformat())).fetchall()
            delivery_status = deliver_event(event_id, data_json, created_at, subscriptions)
            with db_connect() as db:
                db.execute("UPDATE event_queue SET processed=1,delivery_status=? WHERE event_id=?", (delivery_status, event_id))
                db.commit()
            record_activity("event_" + delivery_status, event_id)
        except Exception:
            log.exception("event dispatcher error")
            time.sleep(2)


def handle(request: dict[str, Any]) -> None:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}
    if not isinstance(params, dict):
        rpc_error(request_id, -32602, "params must be an object")
        return
    if method == "initialize":
        response(request_id, {"protocolVersion": params.get("protocolVersion", PROTOCOL_VERSION), "capabilities": {"tools": {"listChanged": False}, "events": {}}, "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION}})
    elif method == "notifications/initialized":
        return
    elif method == "ping":
        response(request_id, {})
    elif method == "tools/list":
        response(request_id, {"tools": TOOLS})
    elif method == "events/list":
        response(request_id, {"events": EVENTS})
    elif method == "events/subscribe":
        handle_subscribe(request_id, params)
    elif method == "events/unsubscribe":
        handle_unsubscribe(request_id, params)
    elif method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(arguments, dict):
            rpc_error(request_id, -32602, "tools/call needs a tool name and object arguments")
            return
        response(request_id, call_tool(name, arguments))
    elif request_id is not None:
        rpc_error(request_id, -32601, f"Method not found: {method}")


def main() -> None:
    init_db()
    record_activity("server_started", f"PID {os.getpid()}")
    def heartbeat() -> None:
        while True:
            record_activity("server_heartbeat", f"PID {os.getpid()}")
            time.sleep(3)
    threading.Thread(target=heartbeat, name="server-heartbeat", daemon=True).start()
    threading.Thread(target=event_dispatcher, name="event-dispatcher", daemon=True).start()
    log.info("Starting %s over MCP stdio with event support; log file: %s", SERVER_NAME, log_dir / "server.log")
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if isinstance(message, dict):
                handle(message)
        except json.JSONDecodeError:
            log.warning("Ignoring malformed JSON-RPC input")
        except Exception:
            log.exception("Request failed")


if __name__ == "__main__":
    main()
