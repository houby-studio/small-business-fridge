#!/bin/sh
set -e

# Pass ALL current supplementary groups (as set by Docker via group_add) through
# to the PulseAudio process.  We enumerate them from the running process rather
# than looking up by name, because the host audio GID (1005 on this machine) does
# not match the name "audio" inside the Ubuntu container image (GID 29).
# id -G returns space-separated GIDs; setpriv --groups expects comma-separated.
SUPP_GROUPS=$(id -G | tr ' ' ',')
exec setpriv --reuid=1000 --regid=1000 --groups "$SUPP_GROUPS" /usr/local/bin/init.sh "$@"
