from __future__ import annotations

import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

if len(sys.argv) < 2 or not " ".join(sys.argv[1:]).strip():
    raise SystemExit('Usage: py -3 .\\server\\trigger_event.py "message for the subscribed Work chat"')

log_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "LocalMcpTest"
log_dir.mkdir(parents=True, exist_ok=True)
database_path = log_dir / "events.sqlite3"
if not database_path.exists():
    raise SystemExit("The MCP server has not created its event store yet. Start the plugin/server first.")
message = " ".join(sys.argv[1:]).strip()
created_at = datetime.now(timezone.utc).isoformat()
event_id = "evt_" + uuid.uuid4().hex
payload = {"message": message, "created_at": created_at}
with sqlite3.connect(database_path, timeout=10) as db:
    db.execute("INSERT INTO event_queue(event_id,data_json,created_at,processed) VALUES(?,?,?,0)", (event_id, json.dumps(payload, ensure_ascii=False), created_at))
    db.commit()
print(f"Queued event {event_id}; it will be delivered if an active ChatGPT Work subscription exists.")