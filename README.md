# Media Admin

A Linux-native TV show organization tool with web UI. Written in Python with FastAPI backend and modern web frontend.

## Features

- Search and add TV shows from TMDB
- Scan library folders for existing episodes
- Detect missing episodes
- Scan download folders for new files
- Preview and approve rename/move operations
- Customizable naming formats
- Modern, responsive web UI

## Requirements

- Python 3.10+
- TMDB API key (free from [themoviedb.org](https://www.themoviedb.org/settings/api))

## Installation

### Development Setup

```bash
git clone https://github.com/coex177/media-admin.git
cd media-admin
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Running the Server

```bash
# Development mode with auto-reload
uvicorn src.main:app --reload --port 8095

# Or run directly
python -m src.main
```

Access the web UI at http://localhost:8095

### Production Deployment (systemd)

Create `/etc/systemd/system/media-admin.service`:

```ini
[Unit]
Description=Media Admin
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/media-admin
ExecStart=/path/to/media-admin/venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8095
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable media-admin
sudo systemctl start media-admin
```

## First-Time Setup

1. Open http://localhost:8095
2. Enter your TMDB API key
3. Add at least one library folder (where your TV shows are stored)
4. Optionally add download folders to watch

## API Documentation

Once running, API documentation is available at:
- Swagger UI: http://localhost:8095/docs
- ReDoc: http://localhost:8095/redoc

## Configuration

Settings are stored in the SQLite database (`data/media-admin.db`) and can be modified through the web UI.

### Naming Formats

Episode format variables:
- `{season}` - Season number
- `{episode}` - Episode number (use `{episode:02d}` for zero-padded)
- `{title}` - Episode title

Season folder variables:
- `{season}` - Season number

Default formats:
- Episode: `{season}x{episode:02d} - {title}`
- Season folder: `Season {season}`

## Project Structure

```
media-admin/
├── src/
│   ├── main.py              # FastAPI application
│   ├── config.py            # Configuration
│   ├── database.py          # SQLite database
│   ├── models/              # Database models
│   ├── services/            # Business logic
│   ├── routers/             # API endpoints
│   └── static/              # Web UI files
├── data/
│   └── media-admin.db       # SQLite database
├── requirements.txt
└── README.md
```

## License

MIT
