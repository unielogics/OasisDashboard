#!/usr/bin/env bash
# e2e-kiosk-stack: `pnpm e2e:kiosk` start to end in one shell (ADR 0180 and its 2026-10-14 amendment): a live stack on the
# given backend with TRUST_PROXY=true (--trust-proxy: each browser context says which internet address it comes from, through
# the dashboard's proxy, as behind production's nginx) and the frozen design day, then the e2e; the stack is always brought
# down and its schema dropped. On the test server (its own network and process namespaces; every process it starts dies with
# the run), after mirroring the backend:
#
#   oasis-remote ~/oasis/wt/k-pin -- true
#   oasis-remote ~/oasis/wt/k-pin-dash -- 'bash scripts/e2e-kiosk-stack.sh /home/ec2-user/oasis/wt/k-pin'
#
# Exit status: the e2e's (the stack failing to start exits 2).
set -u
DASH=$(cd "$(dirname "$0")/.." && pwd)
BE=${1:-$HOME/oasis/backend}
NAME=${E2E_STACK_NAME:-kiosk}
API=4031
WEB=3231
LOGDIR=$(mktemp -d)
echo "e2e-kiosk-stack: dashboard $DASH, backend $BE, stack $NAME"

export SMS_ALLOWLIST=+13055550171,+13055550172 ALLOW_DEV_ENDPOINTS=true

down() { (cd "$DASH" && pnpm -s live:down --name "$NAME" --drop >/dev/null 2>&1); }
trap down EXIT

cd "$DASH" || exit 2
if ! timeout 1500 pnpm -s live:up --name "$NAME" --api-port $API --web-port $WEB --profile design,parity-ops \
  --freeze 2026-06-13T10:36:00-04:00 --trust-proxy --backend "$BE" >"$LOGDIR/up.log" 2>&1; then
  echo "e2e-kiosk-stack: live:up failed"
  tail -40 "$LOGDIR/up.log"
  exit 2
fi
timeout 1200 pnpm -s e2e:kiosk --name "$NAME" "${@:2}"
RC=$?
if [ "$RC" != 0 ]; then
  echo "--- api log (tail)"
  tail -60 "$DASH/.live-stack/$NAME.api.log" 2>/dev/null | grep -v -i "token\|secret\|pepper\|pin" | cut -c1-400
fi
echo "e2e-kiosk-stack: e2e:kiosk exit $RC"
exit $RC
