#!/usr/bin/env bash
# e2e-billing-stack: `pnpm e2e:billing` start to end in one shell (docs/screens-payments-live.md "Saved cards, fees and Square
# memberships"): the backend's HTTP Square simulator (`scripts/sim-square.ts`, webhooks signed with a key made here for this run),
# a live stack on that backend with Square taking card money, Square writes and memberships on, the personal links on (a test
# PIN_PEPPER made here for this run) and the worker running the jobs; then the e2e; the stack is always brought down and its
# schema dropped. The key and the pepper are never printed. On the test server (its own network and process namespaces; every
# process it starts dies with the run), after mirroring the backend:
#
#   oasis-remote ~/oasis/wt/q3-dashapi -- true
#   oasis-remote ~/oasis/wt/q3-dash -- 'bash scripts/e2e-billing-stack.sh /home/ec2-user/oasis/wt/q3-dashapi'
#
# Exit status: the e2e's (the stack failing to start exits 2).
set -u
DASH=$(cd "$(dirname "$0")/.." && pwd)
BE=${1:-$HOME/oasis/backend}
NAME=${E2E_STACK_NAME:-qbill}
API=4091
WEB=3291
SIMPORT=4593
LOGDIR=$(mktemp -d)
rand() { node -e "console.log(require('crypto').randomBytes($1).toString('$2'))"; }
K=$(rand 24 hex)
PIN_PEPPER=$(rand 32 base64)
export PIN_PEPPER
echo "e2e-billing-stack: dashboard $DASH, backend $BE, stack $NAME"

(cd "$BE" && exec pnpm exec tsx scripts/sim-square.ts --port $SIMPORT --seed none \
  --webhook-url http://127.0.0.1:$API/hooks/square --webhook-key "$K" >"$LOGDIR/sim.log" 2>&1 &)

export PAYMENT_PROCESSOR=square SQUARE_PROVIDER=live SQUARE_API_BASE=http://127.0.0.1:$SIMPORT \
  SQUARE_ACCESS_TOKEN=sim-square-access-token SQUARE_LOCATION_ID=LSIMOASIS0001 SQUARE_APPLICATION_ID=sim-app \
  SQUARE_WEBHOOK_SIGNATURE_KEY="$K" SQUARE_WEBHOOK_URL=http://127.0.0.1:$API/hooks/square SQUARE_MATCH_DELAY_SECONDS=0 \
  SQUARE_WRITES_ENABLED=true SQUARE_MEMBERSHIPS_ENABLED=true PUBLIC_LINKS_ENABLED=true PUBLIC_SITE_URL=http://127.0.0.1:3399 \
  SMS_ALLOWLIST=+12015550181,+12015550182,+12015550183

down() { (cd "$DASH" && pnpm -s live:down --name "$NAME" --drop >/dev/null 2>&1); }
trap down EXIT

cd "$DASH" || exit 2
if ! timeout 1500 pnpm -s live:up --name "$NAME" --api-port $API --web-port $WEB \
  --profile design,website-catalog,pricing-defaults --jobs --backend "$BE" >"$LOGDIR/up.log" 2>&1; then
  echo "e2e-billing-stack: live:up failed"
  tail -40 "$LOGDIR/up.log"
  exit 2
fi
SQUARE_SIM_URL=http://127.0.0.1:$SIMPORT timeout 1800 pnpm -s e2e:billing --name "$NAME" "${@:2}"
RC=$?
if [ "$RC" != 0 ]; then
  echo "--- api log (tail)"
  tail -60 "$DASH/.live-stack/$NAME.api.log" 2>/dev/null | grep -v -i "token\|signature\|pepper" | cut -c1-400
  echo "--- worker log (tail)"
  tail -40 "$DASH/.live-stack/$NAME.worker.log" 2>/dev/null | grep -v -i "token\|signature\|pepper" | cut -c1-400
fi
echo "e2e-billing-stack: e2e:billing exit $RC"
exit $RC
