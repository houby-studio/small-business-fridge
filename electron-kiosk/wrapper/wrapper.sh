#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

export KIOSK_URL=$(snapctl get url)
export LANG=$(snapctl get lang)
export PULSE_SERVER=$(snapctl get pulse-server)

echo "Launching Kiosk App with config:
- KIOSK_URL    = $KIOSK_URL
- LANG         = $LANG
- PULSE_SERVER = $PULSE_SERVER"

# Optional language override from snap config: snap set sbf-kiosk lang=cs-CZ
if [ -n "$LANG" ]; then
  EXTRAOPTS="$EXTRAOPTS --lang=$LANG"
fi

# Wait for PulseAudio before starting Electron.
# If it starts before PA is ready there will be no sound on the first page load.
#
# For Unix sockets (unix:/path): wait for the socket file to appear.
# For TCP (tcp:host:port): wait for the port to be open.
# Socket existence is a reliable signal — PA creates the socket only once it is
# fully initialised and ready to accept connections.
if echo "$PULSE_SERVER" | grep -qE '^unix:'; then
  SOCKET_PATH=$(echo "$PULSE_SERVER" | sed 's|^unix:||')
  echo "Waiting for PulseAudio socket at $SOCKET_PATH..."
  TRIES=0
  while ! [ -S "$SOCKET_PATH" ]; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge 60 ]; then
      echo "WARNING: PulseAudio socket not found after 60s. Continuing without audio."
      break
    fi
    sleep 1
  done
  if [ -S "$SOCKET_PATH" ]; then
    echo "PulseAudio ready."
  fi
elif echo "$PULSE_SERVER" | grep -qE '^tcp:[^:]+:[0-9]+$'; then
  PULSE_HOST=$(echo "$PULSE_SERVER" | cut -d: -f2)
  PULSE_PORT=$(echo "$PULSE_SERVER" | cut -d: -f3)
  echo "Waiting for PulseAudio server at $PULSE_HOST:$PULSE_PORT..."
  TRIES=0
  while ! nc -z "$PULSE_HOST" "$PULSE_PORT" 2>/dev/null; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge 60 ]; then
      echo "WARNING: PulseAudio server not reachable after 60s. Continuing without audio."
      break
    fi
    sleep 1
  done
  if nc -z "$PULSE_HOST" "$PULSE_PORT" 2>/dev/null; then
    echo "PulseAudio ready."
  fi
fi

exec "$SNAP/sbf-kiosk" \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --disable-dev-shm-usage \
  --enable-wayland-ime \
  --no-sandbox \
  $EXTRAOPTS
