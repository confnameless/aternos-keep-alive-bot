#!/bin/bash
set -e

# US Shadowsocks VPN
SS_HOST="${SS_HOST:-38.65.93.241}"
SS_PORT="${SS_PORT:-17525}"
SS_PASS="${SS_PASS:-9992b78c6a1122b3aa364721af799807}"
SS_METHOD="${SS_METHOD:-aes-256-gcm}"

ss-local \
  -s "$SS_HOST" \
  -p "$SS_PORT" \
  -k "$SS_PASS" \
  -m "$SS_METHOD" \
  -l 1080 \
  -b 127.0.0.1 &

sleep 3
node index.js
