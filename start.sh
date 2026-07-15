#!/bin/bash
set -e

# Finland Shadowsocks VPN (fastest)
SS_HOST="${SS_HOST:-31.76.80.205}"
SS_PORT="${SS_PORT:-8388}"
SS_PASS="${SS_PASS:-cAqbBYBB0f9CAmpU_mc_7FyvvLCcwzt0}"
SS_METHOD="${SS_METHOD:-chacha20-ietf-poly1305}"

/usr/local/bin/sslocal \
  -s "$SS_HOST:$SS_PORT" \
  -k "$SS_PASS" \
  -m "$SS_METHOD" \
  -b "127.0.0.1:1080" &

sleep 3
node index.js
