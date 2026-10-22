#!/bin/bash
set -u
export PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
ROOT=/workspace/scratch/c01bd6fe117d/reconciliation-dot-20261022
OUT=$ROOT/evidence/dot-followup-20261022/browser/supplement
mkdir -p "$OUT"
cd "$ROOT"
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort > "$OUT/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
QA_IN=$ROOT/evidence/dot-followup-20261022/browser/inputs QA_OUT=$OUT node "$ROOT/evidence/dot-followup-20261022/browser/qa-supplement.mjs" > "$OUT/run.log" 2>&1
printf '%s\n' "$?" > "$OUT/exit-code.txt"
