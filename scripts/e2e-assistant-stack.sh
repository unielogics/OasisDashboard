#!/usr/bin/env bash
# e2e-assistant-stack: `pnpm e2e:assistant` start to end in one shell (docs/screens-settings.md "Settings → Oasis AI: tabs"):
# a live stack of the given backend with the assistant's server switch on, the dev object store and the worker running the
# jobs (the PDF extraction is a job), frozen at the design's instant; then the e2e (default phases: settings and tabs);
# the stack is always brought down and its schema dropped. On the test server (its own network and process namespaces;
# every process it starts dies with the run), after mirroring the backend:
#
#   oasis-remote ~/oasis/wt/k-asst-core -- true
#   oasis-remote ~/oasis/wt/k-asst-dash -- 'bash scripts/e2e-assistant-stack.sh /home/ec2-user/oasis/wt/k-asst-core'
#
# Further arguments go to the e2e (`--phases settings,tabs,messages,identity`, `--keep-going`).
# Exit status: the e2e's (the stack failing to start exits 2).
set -u
DASH=$(cd "$(dirname "$0")/.." && pwd)
BE=${1:-$HOME/oasis/backend}
NAME=${E2E_STACK_NAME:-kasst}
API=4097
WEB=3297
LOGDIR=$(mktemp -d)
echo "e2e-assistant-stack: dashboard $DASH, backend $BE, stack $NAME"

export AI_ENABLED=true ALLOW_DEV_ENDPOINTS=true STORAGE_PROVIDER=fs \
  SMS_ALLOWLIST=+12015550181,+12015550182,+12015550183

down() { (cd "$DASH" && pnpm -s live:down --name "$NAME" --drop >/dev/null 2>&1); }
trap down EXIT

cd "$DASH" || exit 2
if ! timeout 1500 pnpm -s live:up --name "$NAME" --api-port $API --web-port $WEB \
  --profile design,parity-ops --freeze 2026-06-13T10:36:00-04:00 --jobs --backend "$BE" >"$LOGDIR/up.log" 2>&1; then
  echo "e2e-assistant-stack: live:up failed"
  tail -40 "$LOGDIR/up.log"
  exit 2
fi
ARGS=("${@:2}")
if [ ${#ARGS[@]} -eq 0 ]; then ARGS=(--phases settings,tabs); fi
timeout 1800 pnpm -s e2e:assistant --name "$NAME" "${ARGS[@]}"
RC=$?
if [ "$RC" != 0 ]; then
  echo "--- api log (tail)"
  tail -60 "$DASH/.live-stack/$NAME.api.log" 2>/dev/null | grep -v -i "token\|secret\|password" | cut -c1-400
  echo "--- worker log (tail)"
  tail -40 "$DASH/.live-stack/$NAME.worker.log" 2>/dev/null | grep -v -i "token\|secret\|password" | cut -c1-400
fi
echo "e2e-assistant-stack: e2e:assistant exit $RC"
exit $RC
