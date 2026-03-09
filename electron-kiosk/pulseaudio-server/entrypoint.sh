#!/bin/sh
set -e

# Ensure PulseAudio runtime directory exists inside the container.
mkdir -p /run/user/1000/pulse
chown 1000:1000 /run/user/1000 /run/user/1000/pulse

# Pass ALL current supplementary groups (set by Docker via group_add) through to
# the PulseAudio process.  Enumerate from the running process rather than looking
# up by name because the host audio GID (1005) differs from the Ubuntu container
# image's "audio" group (GID 29).
SUPP_GROUPS=$(id -G | tr ' ' ',')
exec setpriv --reuid=1000 --regid=1000 --groups "$SUPP_GROUPS" /usr/local/bin/init.sh "$@"
