#!/bin/bash
# Binzbonz — kill stale processes and start all services

echo "🧹 Installing..."
pnpm install

echo "🧹 Cleaning up stale processes..."

# Kill by port
for port in 3000 3001 54329; do
  pids=$(lsof -ti:$port 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "  Killing processes on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null
  fi
done

# Kill by name
for name in "tsx" "nest" "next" "turbo"; do
  pkill -f "$name" 2>/dev/null
done

sleep 1

# Verify
for port in 3000 3001 54329; do
  if lsof -ti:$port >/dev/null 2>&1; then
    echo "⚠️  Port $port still in use!"
  fi
done

echo "✅ Ports clear"
echo ""
echo "🚀 Starting all services..."
exec pnpm dev
