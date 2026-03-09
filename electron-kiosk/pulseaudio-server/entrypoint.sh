#!/bin/sh
set -e

# Ensure the bind-mounted socket directory exists and is writable by uid 1000.
mkdir -p /run/user/1000/pulse
chown 1000:1000 /run/user/1000 /run/user/1000/pulse 2>/dev/null || true
chmod 700 /run/user/1000/pulse

# Pass ALL current supplementary groups (as set by Docker via group_add) through
# to the PulseAudio process.  We enumerate them from the running process rather
# than looking up by name, because the host audio GID (1005 on this machine) does
# not match the name "audio" inside the Ubuntu container image (GID 29).
# id -G returns space-separated GIDs; setpriv --groups expects comma-separated.
SUPP_GROUPS=$(id -G | tr ' ' ',')
exec setpriv --reuid=1000 --regid=1000 --groups "$SUPP_GROUPS" /usr/local/bin/init.sh "$@"
