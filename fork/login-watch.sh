#!/usr/bin/env bash
# Tells you in Discord when a saved provider login can no longer renew.
#
# The fallback plugin keeps saved logins alive by itself (opencode-fallback, RPC
# `keepalive`). This only reports what that check finds, once per login, and again
# when the login works. Run it from a timer; it costs one local HTTP call.
#
#   ~/.kimaki/login-watch.env   NOTIFY_CHANNEL=<Discord channel id>  NOTIFY_USER=<Discord user id>
#   ~/.kimaki/login-watch.json  logins already reported
#   ~/.kimaki/login-watch.log   one line per run that found something
set -u
CONF="$HOME/.kimaki/login-watch.env"
[ -f "$CONF" ] && . "$CONF"
: "${NOTIFY_CHANNEL:?set NOTIFY_CHANNEL in $CONF}"
cd "$HOME/.kimaki" || exit 0

result=""
for _ in 1 2 3; do
  result=$(opencode api post /api/rpc/fallback/keepalive --data '{"input":{}}' 2>/dev/null) && [ -n "$result" ] && break
  result=""
  sleep 20
done
[ -n "$result" ] || exit 0   # OpenCode is not running: nothing to check

message=$(RESULT="$result" python3 - <<'PY'
import json, os, pathlib, time
state_file = pathlib.Path.home() / '.kimaki/login-watch.json'
try:
    reported = json.loads(state_file.read_text())
except Exception:
    reported = {}
try:
    output = json.loads(os.environ['RESULT']).get('output') or {}
except Exception:
    output = {}
logins = output.get('logins') or []
lines = []
for login in logins:
    key, name = login.get('credentialID'), f"{login.get('providerID')} login \"{login.get('label')}\""
    if login.get('state') == 'dead' and key not in reported:
        reported[key] = int(time.time())
        lines.append(f"The {name} can no longer renew and needs a new sign-in (/login). It is skipped until then.")
    elif login.get('state') == 'ok' and key in reported:
        del reported[key]
        lines.append(f"The {name} works again.")
known = {login.get('credentialID') for login in logins}
for key in [key for key in reported if key not in known]:
    del reported[key]   # the login was removed
labels = {login.get('credentialID'): login.get('label') for login in logins}
for credential in output.get('activated') or []:
    lines.append(f"The active login was dead, so \"{labels.get(credential, credential)}\" took over. Threads keep running.")
working = [login for login in logins if login.get('state') == 'ok']
if lines and not working:
    lines.append("No saved login works now: every thread on this provider fails until you sign in.")
state_file.write_text(json.dumps(reported))
print('\n'.join(lines))
PY
)
[ -n "$message" ] || exit 0
echo "[$(date -u +%FT%TZ)] $message" >> "$HOME/.kimaki/login-watch.log"
kimaki send --channel "$NOTIFY_CHANNEL" --notify-only ${NOTIFY_USER:+--user "$NOTIFY_USER"} --prompt "$message" >> "$HOME/.kimaki/login-watch.log" 2>&1
