#!/bin/bash
# Build-time owner seed for the codevibe n8n template.
# Boots n8n briefly, POSTs to /rest/owner/setup, verifies the user row
# landed in SQLite, then exits. Fails non-zero on any error so the e2b
# template build halts instead of shipping an unconfigured sandbox.
set -e

n8n start >/tmp/n8n-bootstrap.log 2>&1 &
PID=$!

# Wait for n8n to come up. `curl -sf` returns nonzero on connection
# failure or non-2xx, so the if-condition cleanly drives the retry loop
# without set -e tripping on the failed curl.
echo "Waiting for n8n /healthz..."
UP=0
for i in $(seq 1 180); do
  if curl -sf -o /dev/null --max-time 2 http://localhost:5678/healthz; then
    UP=1
    echo "n8n is up after ${i}s"
    break
  fi
  sleep 1
done

if [ "$UP" != "1" ]; then
  echo "FAIL: n8n did not start within 180s"
  tail -100 /tmp/n8n-bootstrap.log || true
  kill -SIGTERM $PID 2>/dev/null || true
  exit 1
fi

# Owner setup. n8n's /healthz comes up before migrations finish, and during
# that window /rest/owner/setup returns 200 with body "n8n is starting up.
# Please wait." — the request is NOT actually processed. We retry until the
# response is a real owner JSON (contains "email") OR we hit the cap.
SETUP_OK=0
for j in $(seq 1 60); do
  STATUS=$(curl -s -o /tmp/owner-setup.log -w "%{http_code}" \
    -X POST http://localhost:5678/rest/owner/setup \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@codevibe.com","firstName":"Admin","lastName":"User","password":"CodeVibe@2025"}' \
    || echo "ERR")
  BODY=$(cat /tmp/owner-setup.log 2>/dev/null || echo "")
  echo "owner-setup attempt $j: HTTP $STATUS"
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "201" ]; then
    if echo "$BODY" | grep -qi "starting up"; then
      echo "  (n8n still booting, retrying)"
    else
      SETUP_OK=1
      break
    fi
  fi
  sleep 2
done

cat /tmp/owner-setup.log || true
echo

kill -SIGTERM $PID 2>/dev/null || true
wait $PID 2>/dev/null || true

DB=/home/user/.n8n/database.sqlite
if [ ! -f "$DB" ]; then
  echo "FAIL: $DB not created"
  tail -100 /tmp/n8n-bootstrap.log || true
  exit 1
fi

COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM user WHERE email='admin@codevibe.com';")
echo "owner rows in DB: $COUNT"
if [ "$COUNT" != "1" ]; then
  echo "FAIL: owner not seeded (setup_ok=$SETUP_OK)"
  sqlite3 "$DB" "SELECT email FROM user;" || true
  tail -100 /tmp/n8n-bootstrap.log || true
  exit 1
fi

echo "owner seed OK"
