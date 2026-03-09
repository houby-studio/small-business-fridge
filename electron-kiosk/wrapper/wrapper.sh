#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

export KIOSK_URL=$(snapctl get url)
export LANG=$(snapctl get lang)
PULSE_SINK=$(snapctl get pulse-sink)
PULSE_VOLUME=$(snapctl get pulse-volume)
PULSE_UID=$(snapctl get pulse-uid)

echo "Launching Kiosk App with config:
- KIOSK_URL    = $KIOSK_URL
- LANG         = $LANG
- PULSE_SINK   = $PULSE_SINK
- PULSE_VOLUME = $PULSE_VOLUME
- PULSE_UID    = $PULSE_UID"

# Optional language override from snap config: snap set sbf-kiosk lang=cs-CZ
if [ -n "$LANG" ]; then
  EXTRAOPTS="$EXTRAOPTS --lang=$LANG"
fi

# --- Audio setup ---
# The snap bundles libpulse0 (PA client library) so Electron can speak the
# PulseAudio protocol. We connect to the system's PipeWire-PulseAudio compat
# socket — no daemon is started inside the snap.
#
# PipeWire creates the socket at /run/user/<uid>/pulse/native where <uid> is
# the UID of the logged-in desktop user. Set pulse-uid if that user is not 1000:
#   snap set sbf-kiosk pulse-uid=1001
PULSE_SOCKET="/run/user/${PULSE_UID}/pulse/native"

if [ -S "$PULSE_SOCKET" ]; then
  export PULSE_SERVER="unix:${PULSE_SOCKET}"
  echo "Audio: using PA server at $PULSE_SERVER"
else
  echo "Audio: socket not found at $PULSE_SOCKET — is PipeWire running? check pulse-uid setting"
fi

# Configure output sink and volume via pactl once the socket is reachable.
# snap set sbf-kiosk pulse-sink=hdmi   (or 'analog', or an exact sink name)
# snap set sbf-kiosk pulse-volume=80
{
  if [ -n "$PULSE_SINK" ] && [ "$PULSE_SINK" != "auto" ]; then
    MATCHED=$(pactl list sinks short 2>/dev/null \
      | awk -v pat="$PULSE_SINK" 'tolower($2) ~ tolower(pat) {print $2; exit}')
    if [ -n "$MATCHED" ]; then
      pactl set-default-sink "$MATCHED"
      echo "Audio: default sink → $MATCHED"
    else
      echo "Audio: no sink matching '$PULSE_SINK', keeping system default"
    fi
  fi

  if [ -n "$PULSE_VOLUME" ]; then
    pactl set-sink-volume @DEFAULT_SINK@ "${PULSE_VOLUME}%"
    echo "Audio: volume → ${PULSE_VOLUME}%"
  fi
} 2>/dev/null || true

exec "$SNAP/sbf-kiosk" \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --disable-dev-shm-usage \
  --enable-wayland-ime \
  --no-sandbox \
  $EXTRAOPTS
