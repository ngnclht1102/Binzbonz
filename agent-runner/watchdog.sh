#!/bin/bash
# Watchdog: restarts agent-runner if it crashes
# Max 10 restarts with exponential backoff, resets after 60s stable

MAX_RESTARTS=10
RESTART_COUNT=0
MAX_DELAY=30

while true; do
  START_TIME=$(date +%s)
  echo "[watchdog] Starting agent-runner (attempt $((RESTART_COUNT + 1)))..."

  npx tsx src/index.ts
  EXIT_CODE=$?

  END_TIME=$(date +%s)
  UPTIME=$((END_TIME - START_TIME))

  # Clean exit
  if [ $EXIT_CODE -eq 0 ]; then
    echo "[watchdog] Agent-runner exited cleanly."
    break
  fi

  # Reset counter if it ran for >60s
  if [ $UPTIME -gt 60 ]; then
    RESTART_COUNT=0
  fi

  RESTART_COUNT=$((RESTART_COUNT + 1))

  if [ $RESTART_COUNT -gt $MAX_RESTARTS ]; then
    echo "[watchdog] Agent-runner crashed $MAX_RESTARTS times. Giving up."
    exit 1
  fi

  # Exponential backoff: 2, 4, 8, 16... capped at MAX_DELAY
  DELAY=$((2 ** RESTART_COUNT))
  if [ $DELAY -gt $MAX_DELAY ]; then
    DELAY=$MAX_DELAY
  fi

  echo "[watchdog] Agent-runner crashed (code=$EXIT_CODE, uptime=${UPTIME}s). Restarting in ${DELAY}s... ($RESTART_COUNT/$MAX_RESTARTS)"
  sleep $DELAY
done
