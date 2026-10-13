#!/usr/bin/env bash
# e2e-items-stack: `pnpm e2e:items` start to end in one shell (docs/screens-settings.md "Square item library and the sales
# tax"): the backend's HTTP Square simulator (`scripts/sim-square.ts`, webhooks signed with a key made here for this run), a
# live stack on that backend in the rollout state of the item library (Square writes and SQUARE_ITEMS_SYNC_ENABLED on,
# Squarespace still the processor; no worker, so "Sync now" is the only sync and never meets the 5-minute job), then the
# e2e; the stack is always brought down and its schema dropped. The key is never printed. On the test server (its own
# network and process namespaces; every process it starts dies with the run), after mirroring the backend:
#
#   oasis-remote ~/oasis/wt/k-items -- true
#   oasis-remote ~/oasis/wt/k-items-dash -- 'bash scripts/e2e-items-stack.sh /home/ec2-user/oasis/wt/k-items'
#
# Exit status: the e2e's (the stack failing to start exits 2).
set -u
DASH=$(cd "$(dirname "$0")/.." && pwd)
BE=${1:-$HOME/oasis/backend}
NAME=${E2E_STACK_NAME:-qitems}
API=4093
WEB=3293
SIMPORT=4595
LOGDIR=$(mktemp -d)
K=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
echo "e2e-items-stack: dashboard $DASH, backend $BE, stack $NAME"

(cd "$BE" && exec pnpm exec tsx scripts/sim-square.ts --port $SIMPORT --seed none \
  --webhook-url http://127.0.0.1:$API/hooks/square --webhook-key "$K" >"$LOGDIR/sim.log" 2>&1 &)

export PAYMENT_PROCESSOR=squarespace SQUARE_PROVIDER=live SQUARE_API_BASE=http://127.0.0.1:$SIMPORT \
  SQUARE_ACCESS_TOKEN=sim-square-access-token SQUARE_LOCATION_ID=LSIMOASIS0001 SQUARE_APPLICATION_ID=sim-app \
  SQUARE_WEBHOOK_SIGNATURE_KEY="$K" SQUARE_WEBHOOK_URL=http://127.0.0.1:$API/hooks/square \
  SQUARE_WRITES_ENABLED=true SQUARE_ITEMS_SYNC_ENABLED=true \
  SMS_ALLOWLIST=+12015550191,+12015550192

down() { (cd "$DASH" && pnpm -s live:down --name "$NAME" --drop >/dev/null 2>&1); }
trap down EXIT

cd "$DASH" || exit 2
if ! timeout 1500 pnpm -s live:up --name "$NAME" --api-port $API --web-port $WEB \
  --profile design,website-catalog,pricing-defaults --backend "$BE" >"$LOGDIR/up.log" 2>&1; then
  echo "e2e-items-stack: live:up failed"
  tail -40 "$LOGDIR/up.log"
  exit 2
fi
SQUARE_SIM_URL=http://127.0.0.1:$SIMPORT timeout 1200 pnpm -s e2e:items --name "$NAME" "${@:2}"
RC=$?
if [ "$RC" != 0 ]; then
  echo "--- api log (tail)"
  tail -60 "$DASH/.live-stack/$NAME.api.log" 2>/dev/null | grep -v -i "token\|signature\|pepper" | cut -c1-400
fi
echo "e2e-items-stack: e2e:items exit $RC"
exit $RC
