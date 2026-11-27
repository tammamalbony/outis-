from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import server as mcp_server

HOST = "127.0.0.1"
PORT = int(os.environ.get("LOCAL_MCP_DASHBOARD_PORT", "8765"))
DB = mcp_server.database_path
DATA_TABLE_COLUMNS = {
    "event_queue": ("event_id", "data_json", "created_at", "processed", "delivery_status"),
    "subscriptions": ("id", "name", "arguments_json", "url", "secret", "expires_at", "active"),
    "messages": ("id", "message", "received_at"),
    "activity": ("id", "occurred_at", "action", "detail"),
    "extension_inbox": ("id", "kind", "name", "payload_json", "created_at"),
    "extension_outbox": ("id", "kind", "name", "payload_json", "created_at", "acknowledged"),
}


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def backup_current_database() -> Path:
    export_dir = Path(os.environ.get("LOCAL_MCP_EXPORT_DIR", DB.parent / "exports"))
    export_dir.mkdir(parents=True, exist_ok=True)
    target = export_dir / "events.sqlite3"
    with sqlite3.connect(DB, timeout=10) as source, sqlite3.connect(target, timeout=10) as destination:
        source.backup(destination)
    return target


def export_payload() -> dict:
    with connect() as db:
        tables = {
            name: [dict(row) for row in db.execute(f"SELECT {','.join(columns)} FROM {name} ORDER BY rowid")]
            for name, columns in DATA_TABLE_COLUMNS.items()
        }
    return {"format": "local-mcp-test-data", "version": 1, "exported_at": datetime.now(timezone.utc).isoformat(), "tables": tables}


def import_payload(payload: object) -> tuple[str, str]:
    if not isinstance(payload, dict) or payload.get("format") != "local-mcp-test-data" or payload.get("version") != 1:
        raise ValueError("Choose a Local MCP Test JSON export (format version 1).")
    tables = payload.get("tables")
    if not isinstance(tables, dict) or set(tables) != set(DATA_TABLE_COLUMNS):
        raise ValueError("The import file is missing required data tables or contains unsupported fields.")
    total_rows = 0
    for name, columns in DATA_TABLE_COLUMNS.items():
        rows = tables[name]
        if not isinstance(rows, list):
            raise ValueError(f"Table {name} must contain a list of rows.")
        total_rows += len(rows)
        if total_rows > 100_000:
            raise ValueError("The import contains too many rows (maximum 100,000).")
        for row in rows:
            if not isinstance(row, dict) or set(row) != set(columns):
                raise ValueError(f"A row in {name} does not match the expected export format.")
            if any(value is not None and not isinstance(value, (str, int, float, bool)) for value in row.values()):
                raise ValueError(f"A row in {name} contains an unsupported value.")

    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        for name, columns in DATA_TABLE_COLUMNS.items():
            db.execute(f"DELETE FROM {name}")
            placeholders = ",".join("?" for _ in columns)
            column_sql = ",".join(columns)
            rows = [tuple(row[column] for column in columns) for row in tables[name]]
            if rows:
                db.executemany(f"INSERT INTO {name} ({column_sql}) VALUES ({placeholders})", rows)
        db.execute("UPDATE extension_auth SET pairing_hash=NULL,pairing_expires=NULL,pairing_used=1,token_hash=NULL,paired_at=NULL,last_seen=NULL WHERE id=1")
        db.commit()
    code, expires = mcp_server.rotate_extension_pairing_code()
    mcp_server.record_activity("data_imported", f"Imported {total_rows} rows; Chrome needs pairing again")
    return code, expires


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_json(self, code: int, data: dict, download_filename: str | None = None) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if download_filename:
            self.send_header("Content-Disposition", f'attachment; filename="{download_filename}"')
        origin = self.headers.get("Origin", "")
        if self.is_extension_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def is_extension_origin(origin: str) -> bool:
        parsed = urlparse(origin)
        return parsed.scheme == "chrome-extension" and bool(re.fullmatch(r"[a-p]{32}", parsed.hostname or ""))

    def local_host(self) -> bool:
        return self.headers.get("Host", "").split(":", 1)[0].lower() in ("127.0.0.1", "localhost")

    def extension_token(self) -> str | None:
        origin = self.headers.get("Origin", "")
        authorization = self.headers.get("Authorization", "")
        if not self.is_extension_origin(origin) or not authorization.startswith("Bearer "):
            return None
        return authorization[7:].strip()

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin", "")
        if not self.local_host() or not self.is_extension_origin(origin):
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            body = Path(__file__).with_name("dashboard.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not self.local_host():
            self.send_json(403, {"error": "local requests only"})
            return
        if path == "/api/data/export":
            data = export_payload()
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            filename = f"local-mcp-test-export-{timestamp}.json"
            export_dir = Path(os.environ.get("LOCAL_MCP_EXPORT_DIR", DB.parent / "exports"))
            export_dir.mkdir(parents=True, exist_ok=True)
            backup_current_database()
            export_path = export_dir / filename
            temp_path = export_path.with_suffix(export_path.suffix + ".tmp")
            temp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temp_path, export_path)
            self.send_json(200, data, filename)
            return
        if path == "/api/bridge/pairing-code":
            origin = self.headers.get("Origin", "")
            if origin and origin not in ("http://127.0.0.1:8765", "http://localhost:8765"):
                self.send_json(403, {"error": "pairing code is available from the local dashboard only"})
                return
            self.send_json(200, mcp_server.extension_pairing_info())
            return
        if path == "/api/extension/outbox":
            token = self.extension_token()
            if not token or not mcp_server.authorize_extension(token):
                self.send_json(401, {"error": "extension is not paired"})
                return
            with connect() as db:
                rows = db.execute("SELECT id,kind,name,payload_json,created_at FROM extension_outbox WHERE acknowledged=0 ORDER BY id LIMIT 100").fetchall()
            items = [{"id": r[0], "kind": r[1], "name": r[2], "payload": json.loads(r[3]), "created_at": r[4]} for r in rows]
            self.send_json(200, {"items": items})
            return
        if path != "/api/status":
            self.send_json(404, {"error": "not found"})
            return
        now = datetime.now(timezone.utc)
        with connect() as db:
            state = db.execute("SELECT started_at,last_seen FROM server_state WHERE id=1").fetchone()
            message = db.execute("SELECT message,received_at FROM messages WHERE id=1").fetchone()
            activity = db.execute("SELECT occurred_at,action,detail FROM activity WHERE action!='server_heartbeat' ORDER BY id DESC LIMIT 15").fetchall()
            event_counts = {r[0]: r[1] for r in db.execute("SELECT delivery_status,COUNT(*) FROM event_queue GROUP BY delivery_status")}
            active_subs = db.execute("SELECT COUNT(*) FROM subscriptions WHERE active=1 AND expires_at>?", (now.isoformat(),)).fetchone()[0]
            extension_auth = db.execute("SELECT token_hash,paired_at,last_seen FROM extension_auth WHERE id=1").fetchone()
            extension_pending = db.execute("SELECT COUNT(*) FROM extension_outbox WHERE acknowledged=0").fetchone()[0]
            extension_received = db.execute("SELECT COUNT(*) FROM extension_inbox").fetchone()[0]
        last_seen = state["last_seen"] if state else None
        online = False
        if last_seen:
            try:
                online = (now - datetime.fromisoformat(last_seen)).total_seconds() < 12
            except ValueError:
                pass
        log_path = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "LocalMcpTest" / "server.log"
        cutoff_path = log_path.with_name("activity-cutoff.txt")
        try:
            log_cutoff = datetime.fromisoformat(cutoff_path.read_text(encoding="utf-8").strip()) if cutoff_path.exists() else None
        except (OSError, ValueError):
            log_cutoff = None
        if log_path.exists():
            try:
                log_mtime = datetime.fromtimestamp(log_path.stat().st_mtime, timezone.utc)
                if (now - log_mtime).total_seconds() < 20:
                    online = True
                    last_seen = log_mtime.isoformat()
                lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-80:]
                for line in lines:
                    match = re.match(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d+) INFO (.*)$", line)
                    if match and ("tool=" in match[2] or "Starting Local MCP Test" in match[2] or "event queued" in match[2] or "event delivered" in match[2]):
                        try:
                            occurred = datetime.strptime(match[1], "%Y-%m-%d %H:%M:%S,%f").astimezone().isoformat()
                        except ValueError:
                            occurred = log_mtime.isoformat()
                        if log_cutoff and datetime.fromisoformat(occurred) < log_cutoff:
                            continue
                        activity.append({"occurred_at": occurred, "action": match[2], "detail": "From local MCP server log"})
            except OSError:
                pass
        activity_items = [{"time": r["occurred_at"], "action": r["action"], "detail": r["detail"]} for r in activity]
        activity_items.sort(key=lambda r: datetime.fromisoformat(r["time"]).timestamp(), reverse=True)
        self.send_json(200, {
            "server": {"online": online, "started_at": state["started_at"] if state else None, "last_seen": last_seen},
            "message": dict(message) if message else None,
            "events": {"pending": event_counts.get("pending", 0), "delivered": event_counts.get("delivered", 0), "failed": event_counts.get("failed", 0), "no_subscribers": event_counts.get("no_subscribers", 0), "unknown": event_counts.get("unknown", 0)},
            "subscriptions": {"active": active_subs},
            "extension": {"paired": bool(extension_auth and extension_auth[0]), "paired_at": extension_auth[1] if extension_auth else None, "last_seen": extension_auth[2] if extension_auth else None, "pending_outbound": extension_pending, "received_items": extension_received},
            "activity": activity_items[:15],
        })

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if not self.local_host():
            self.send_json(403, {"error": "local requests only"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > (25 * 1024 * 1024 if path == "/api/data/import" else 300 * 1024):
            self.send_json(413, {"error": "request too large"})
            return
        try:
            raw = self.rfile.read(length)
            payload = json.loads(raw) if raw else {}
            if path == "/api/bridge/pairing-code":
                origin = self.headers.get("Origin", "")
                if origin and origin not in ("http://127.0.0.1:8765", "http://localhost:8765"):
                    self.send_json(403, {"error": "pairing code can only be rotated from the local dashboard"})
                    return
                code, expires = mcp_server.rotate_extension_pairing_code()
                self.send_json(200, {"code": code, "expires_at": expires})
                return
            if path == "/api/data/clear":
                origin = self.headers.get("Origin", "")
                if origin and origin not in ("http://127.0.0.1:8765", "http://localhost:8765"):
                    self.send_json(403, {"error": "data can only be cleared from the local dashboard"})
                    return
                with connect() as db:
                    for table in ("event_queue", "subscriptions", "messages", "activity", "extension_inbox", "extension_outbox"):
                        db.execute(f"DELETE FROM {table}")
                    db.execute("UPDATE extension_auth SET pairing_hash=NULL,pairing_expires=NULL,pairing_used=1,token_hash=NULL,paired_at=NULL,last_seen=NULL WHERE id=1")
                    db.commit()
                log_path = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "LocalMcpTest" / "server.log"
                log_path.parent.mkdir(parents=True, exist_ok=True)
                log_path.with_name("activity-cutoff.txt").write_text(datetime.now().astimezone().isoformat(), encoding="utf-8")
                code, expires = mcp_server.rotate_extension_pairing_code()
                mcp_server.record_activity("data_cleared", "Local messages, events, extension history, and activity were cleared; Chrome needs pairing again")
                backup_current_database()
                self.send_json(200, {"cleared": True, "extension_unpaired": True, "pairing_code": code, "pairing_expires_at": expires})
                return
            if path == "/api/data/import":
                origin = self.headers.get("Origin", "")
                if origin and origin not in ("http://127.0.0.1:8765", "http://localhost:8765"):
                    self.send_json(403, {"error": "data can only be imported from the local dashboard"})
                    return
                code, expires = import_payload(payload)
                backup_current_database()
                self.send_json(200, {"imported": True, "extension_unpaired": True, "pairing_code": code, "pairing_expires_at": expires})
                return
            if path == "/api/server/stop":
                origin = self.headers.get("Origin", "")
                if origin and origin not in ("http://127.0.0.1:8765", "http://localhost:8765"):
                    self.send_json(403, {"error": "the dashboard can only be stopped from this computer"})
                    return
                self.send_json(200, {"stopping": True, "message": "Dashboard stopping. Restart it from the Local MCP Test Control terminal."})
                threading.Thread(target=self.server.shutdown, name="dashboard-shutdown", daemon=True).start()
                return
            if path.startswith("/api/extension/"):
                origin = self.headers.get("Origin", "")
                if not self.is_extension_origin(origin):
                    self.send_json(403, {"error": "Chrome extension origin required"})
                    return
                if path == "/api/extension/pair":
                    code = payload.get("code") if isinstance(payload, dict) else None
                    token = mcp_server.pair_extension(code)
                    if not token:
                        self.send_json(403, {"error": "pairing code is invalid, expired, or already used"})
                        return
                    self.send_json(200, {"token": token})
                    return
                token = self.extension_token()
                if not token or not mcp_server.authorize_extension(token):
                    self.send_json(401, {"error": "extension is not paired"})
                    return
                if path == "/api/extension/items":
                    kind = payload.get("kind") if isinstance(payload, dict) else None
                    name = payload.get("name") if isinstance(payload, dict) else None
                    item = payload.get("payload") if isinstance(payload, dict) else None
                    if kind not in ("message", "data", "event") or "payload" not in payload:
                        raise ValueError("kind must be message, data, or event, with a payload")
                    if kind == "message" and (not isinstance(item, str) or not item.strip()):
                        raise ValueError("message payload must be a non-empty string")
                    if kind == "event" and (not isinstance(name, str) or not name.strip() or len(name) > 120):
                        raise ValueError("event items require a name of 1 to 120 characters")
                    encoded = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
                    if len(encoded.encode("utf-8")) > 256 * 1024:
                        raise ValueError("payload exceeds 256 KiB")
                    created_at = datetime.now(timezone.utc).isoformat()
                    with connect() as db:
                        cursor = db.execute("INSERT INTO extension_inbox(kind,name,payload_json,created_at) VALUES(?,?,?,?)", (kind, name.strip() if isinstance(name, str) else None, encoded, created_at))
                        item_id = int(cursor.lastrowid)
                        db.commit()
                    mcp_server.record_activity("extension_incoming_" + kind, name or (item if isinstance(item, str) else encoded))
                    self.send_json(200, {"received": True, "id": item_id, "created_at": created_at})
                    return
                if path == "/api/extension/ack":
                    ids = payload.get("ids") if isinstance(payload, dict) else None
                    if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(item_id, int) or item_id < 1 for item_id in ids):
                        raise ValueError("ids must be a list of up to 100 positive integers")
                    if ids:
                        placeholders = ",".join("?" for _ in ids)
                        with connect() as db:
                            db.execute(f"UPDATE extension_outbox SET acknowledged=1 WHERE id IN ({placeholders})", ids)
                            db.commit()
                    self.send_json(200, {"acknowledged": len(ids)})
                    return
                self.send_json(404, {"error": "not found"})
                return
            if path != "/api/trigger":
                self.send_json(404, {"error": "not found"})
                return
            origin = self.headers.get("Origin", "")
            if origin and origin not in ("http://127.0.0.1:8765", "http://localhost:8765"):
                self.send_json(403, {"error": "event trigger is available from the local dashboard only"})
                return
            message = payload.get("message", "") if isinstance(payload, dict) else ""
            if not isinstance(message, str) or not message.strip() or len(message) > 4000:
                raise ValueError("Enter a message between 1 and 4000 characters")
            event_id = mcp_server.enqueue_event(message.strip())
            self.send_json(200, {"queued": True, "event_id": event_id})
        except (json.JSONDecodeError, ValueError, sqlite3.Error, OSError) as exc:
            self.send_json(400, {"error": str(exc)})


def main() -> None:
    mcp_server.init_db()
    mcp_server.rotate_extension_pairing_code()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Local MCP dashboard: http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Dashboard stopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
