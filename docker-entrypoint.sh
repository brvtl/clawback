#!/bin/sh
set -e

# Run database migrations
echo "Running database migrations..."
node packages/db/dist/migrate.js

# Start nginx (daemonizes by default)
echo "Starting nginx reverse proxy..."
nginx

# Start web UI in background
echo "Starting web UI on port ${PORT_WEB:-3001}..."
PORT=${PORT_WEB:-3001} ORIGIN=${ORIGIN:-http://localhost} node apps/web/build &

# Start daemon in foreground (PID 1 — container stops if this dies)
echo "Starting Clawback daemon on port ${PORT:-3000}..."
exec node apps/daemon/dist/index.js
