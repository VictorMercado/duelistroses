#!/bin/bash
# Move to the app directory
cd /opt/duelistroses

# Pull the latest code from the main branch
git pull origin main

# Build and restart the containers
# --build: forces a rebuild of the image
# -d: runs in the background
# --remove-orphans: cleans up old unused containers
docker compose up -d --build --remove-orphans

# Optional: Clean up old, unused images to save disk space
docker image prune -f