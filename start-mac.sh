#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/ariel_live"
node tools/bootstrap-local.mjs
exec node auto-host-server.mjs
