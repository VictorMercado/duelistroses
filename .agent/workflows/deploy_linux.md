---
description: Deploy Duelist Roses on Linux (Systemd)
---

# Deploying to Linux VPS (Ubuntu/Debian)

This guide assumes you have a Linux server and have copied the project files to it.

## 1. Prerequisites
- **Node.js** (v18+)
- **Go** (v1.21+)
- **Nginx** (Optional, for reverse proxy)

## 2. Build the Application

Navigate to the project directory on your server:

```bash
# 1. Build Frontend
cd web
npm install
npm run build
cd ..

# 2. Build Backend
go mod tidy
go build -o duelist-server main.go
```

## 3. Setup Systemd Service

Create a service file: `sudo nano /etc/systemd/system/duelist-game.service`

```ini
[Unit]
Description=Duelist Roses Game Server
After=network.target

[Service]
# Replace 'youruser' and paths with actual values
User=root
WorkingDirectory=/root/duelistRoses
ExecStart=/root/duelistRoses/duelist-server
Restart=always
RestartSec=5
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

## 4. Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable duelist-game
sudo systemctl start duelist-game
sudo systemctl status duelist-game
```

The game should now be running on port 8080.
