#!/usr/bin/env bash
# Deploy the Change Control prototype into a running IRIS for Health container.
#
#   ./scripts/deploy.sh [container] [namespace]
#
# Copies the static UI to /usr/irissys/csp/hcccicd/, loads and compiles the
# installer class, then runs Apply() to create the web application and add the
# Change Control tab to the Interoperability editor.
#
# Re-runnable. Static files are overwritten; the installer is idempotent.

set -euo pipefail

CONTAINER="${1:-iris-agentic}"
NAMESPACE="${2:-HSCUSTOM}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "error: container '$CONTAINER' is not running" >&2
  exit 1
fi

echo "==> deploying to $CONTAINER / $NAMESPACE"

echo "--> static UI"
docker exec "$CONTAINER" mkdir -p /usr/irissys/csp/hcccicd
for f in index.html change.css change.js inject.js; do
  docker cp "$ROOT/src/csp/hcccicd/$f" "$CONTAINER:/usr/irissys/csp/hcccicd/$f"
done
docker exec "$CONTAINER" bash -lc 'chown -R irisowner:irisowner /usr/irissys/csp/hcccicd 2>/dev/null || true'

echo "--> classes"
docker exec "$CONTAINER" mkdir -p /tmp/hcccicd
docker cp "$ROOT/src/cls/HCCCICD/Install/Setup.cls" "$CONTAINER:/tmp/hcccicd/Setup.cls"
docker cp "$ROOT/src/cls/HCCCICD/REST/Dispatch.cls" "$CONTAINER:/tmp/hcccicd/Dispatch.cls"

docker exec -i "$CONTAINER" iris session iris -U "$NAMESPACE" <<EOF
set sc = \$system.OBJ.Load("/tmp/hcccicd/Dispatch.cls","ck")
write !,"load Dispatch: ",\$select(sc:"ok",1:\$system.Status.GetErrorText(sc)),!
set sc = \$system.OBJ.Load("/tmp/hcccicd/Setup.cls","ck")
write !,"load Setup: ",\$select(sc:"ok",1:\$system.Status.GetErrorText(sc)),!
do ##class(HCCCICD.Install.Setup).Apply("$NAMESPACE")
do ##class(HCCCICD.Install.Setup).Status()
halt
EOF

PORT="$(docker port "$CONTAINER" 52773 2>/dev/null | head -1 | sed 's/.*://')"
echo
echo "==> done"
echo "    tool             http://localhost:${PORT:-52773}/hcccicd/index.html"
echo "    inside the editor  http://localhost:${PORT:-52773}/ui/interop/index.html  -> Change Control tab"
echo
echo "    Hard-refresh once: the CSP gateway may still hold the previous page."
