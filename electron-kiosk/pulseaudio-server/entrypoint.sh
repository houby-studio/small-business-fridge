#!/bin/sh
set -e

# Run as root briefly to ensure the bind-mounted socket directory
# on the host exists and is writable by the kiosk user (uid 1000).
mkdir -p /run/user/1000/pulse
chown 1000:1000 /run/user/1000 /run/user/1000/pulse 2>/dev/null || true
chmod 700 /run/user/1000/pulse

# Drop to kiosk user (uid 1000) for the actual PulseAudio process.
# setpriv is part of util-linux, available in Ubuntu base image.
exec setpriv --reuid=1000 --regid=1000 --init-groups /usr/local/bin/init.sh "$@"
