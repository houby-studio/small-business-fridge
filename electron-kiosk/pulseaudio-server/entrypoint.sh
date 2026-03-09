#!/bin/sh
set -e

# Ensure the bind-mounted socket directory exists and is writable by uid 1000.
mkdir -p /run/user/1000/pulse
chown 1000:1000 /run/user/1000 /run/user/1000/pulse 2>/dev/null || true
chmod 700 /run/user/1000/pulse

# Preserve the audio group that Docker adds via group_add — it is required for
# /dev/snd access.  setpriv --clear-groups would drop it, so we pass the GID
# explicitly.  Fall back to clear-groups only if the group can't be resolved.
AUDIO_GID=$(getent group audio 2>/dev/null | cut -d: -f3)
if [ -n "$AUDIO_GID" ]; then
  exec setpriv --reuid=1000 --regid=1000 --groups "$AUDIO_GID" /usr/local/bin/init.sh "$@"
else
  exec setpriv --reuid=1000 --regid=1000 --clear-groups /usr/local/bin/init.sh "$@"
fi
