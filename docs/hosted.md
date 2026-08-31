# Hosted mode: control plane + agents

Media Admin can run as a hosted, multi-tenant service. The **cloud** (this app, behind
nginx, on Postgres) holds accounts, metadata, matching, naming and job state. It never
touches a file. An **agent** on each customer's machine executes filesystem verbs inside
the roots declared in its own config, and streams "file settled" events from the folders
the cloud asks it to watch.

```
browser ──► nginx ──► app (uvicorn :8095) ──► Postgres
                        ▲ wss /api/agent/ws (outbound from the agent, bearer token)
                        │
             customer box: python -m agent agent.toml   (roots = the only paths it will touch)
```

## Trust boundary

* Every API route requires a session (`require_user`), which also scopes every ORM query
  to the caller's tenant (`src/models/tenant.py`).
* Every filesystem operation goes through `storage_for_path(db, path)`
  (`src/services/storage.py`): the configured folder that contains the path picks the
  backend — its agent, or local disk when `agent_id` is NULL. A path under no configured
  folder is refused. The agent enforces its own root jail again on its side.
* Agents authenticate with a per-agent token (created in Settings → Folders → Pair Agent,
  shown once, stored hashed).

## Deploy (VPS)

```bash
git clone … media-admin && cd media-admin
cp .env.example .env            # set PG_PASSWORD, TMDB/TVDB keys
docker compose up -d --build    # app on 127.0.0.1:8095, Postgres on a named volume
```

nginx site (TLS via certbot as usual):

```nginx
location / {
    proxy_pass http://127.0.0.1:8095;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # agent websocket
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600;                      # long-lived agent connections
}
```

Schema: on Postgres the app runs `alembic upgrade head` at startup. After changing a
model: `DATABASE_URL=… venv/bin/alembic revision --autogenerate -m "what changed"`, review,
commit. SQLite (self-hosted) still uses `create_all` + the in-app migrations in `main.py`.

## Agent install (customer box)

```bash
pip install -r agent/requirements.txt      # websockets, watchdog; ffmpeg optional (quality compare)
cp agent/agent.example.toml agent.toml     # server URL, token from the UI, roots
python -m agent agent.toml
```

Then add folders in Settings → Folders choosing that agent as the location. The path must
exist on the agent's box and lie under one of its `roots`.

## Self-hosted (single box)

Leave `DATABASE_URL` unset (SQLite) and add folders with location "This server". The same
storage layer runs the agent's filesystem code in-process, jailed to the configured folders.
