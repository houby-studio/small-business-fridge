#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

export KIOSK_URL=$(snapctl get kiosk-url)
export LANG=$(snapctl get lang)
export PULSE_SERVER=$(snapctl get pulse-server)

echo "Launching Kiosk App with config:
- KIOSK_URL                             = $KIOSK_URL
- LANG                                  = $LANG
- PULSE_SERVER                          = $PULSE_SERVER"

# Optional runtime LANG override from snap config:
#   snap set sbf-kiosk LANG=cs-CZ
LANG=$(snapctl get lang 2>/dev/null || true)
if [ -n "$LANG" ]; then
  EXTRAOPTS="$EXTRAOPTS --lang=$LANG"
fi

if [ "$KIOSK_SYSTEM_SOUND_WAITFORPULSESERVER" = "true" ]; then
  # Check if pulseserver is in format tcp:host:port
  if echo "$KIOSK_SYSTEM_SOUND_PULSESERVER" | grep -qE '^tcp:[^:]+:[0-9]+$'; then
    PULSE_HOST=$(echo "$KIOSK_SYSTEM_SOUND_PULSESERVER" | cut -d: -f2)
    PULSE_PORT=$(echo "$KIOSK_SYSTEM_SOUND_PULSESERVER" | cut -d: -f3)
    echo "Waiting for PulseAudio server at $PULSE_HOST:$PULSE_PORT..."
    while ! nc -z "$PULSE_HOST" "$PULSE_PORT"; do
      echo "PulseAudio server not ready, waiting..."
      sleep 1
    done
    echo "PulseAudio server is ready."
  fi
fi

exec "$SNAP/sbf-kiosk" \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --disable-dev-shm-usage \
  --enable-wayland-ime \
  --no-sandbox \
  $EXTRAOPTS
