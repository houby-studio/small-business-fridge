#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

export KIOSK_URL=$(snapctl get url)
export LANG=$(snapctl get lang)
PULSE_SINK=$(snapctl get pulse-sink)
PULSE_VOLUME=$(snapctl get pulse-volume)

echo "Launching Kiosk App with config:
- KIOSK_URL    = $KIOSK_URL
- LANG         = $LANG
- PULSE_SINK   = $PULSE_SINK
- PULSE_VOLUME = $PULSE_VOLUME"

# Optional language override from snap config: snap set sbf-kiosk lang=cs-CZ
if [ -n "$LANG" ]; then
  EXTRAOPTS="$EXTRAOPTS --lang=$LANG"
fi

# --- Audio setup (ALSA direct via the 'alsa' snap plug) ---
# This kiosk runs on a headless machine with no PulseAudio/PipeWire daemon.
# We use ALSA directly. libpulse0 is still staged so Electron can use PA
# automatically if a PA-compatible server becomes available in future.
#
# Volume: snap set sbf-kiosk pulse-volume=80   (0-100%, applied via amixer)
# Output: snap set sbf-kiosk pulse-sink=auto   ('auto' = ALSA default device)
#         For a specific output pass the ALSA device: hw:0,3 (HDMI), hw:0,0 (analog)
#         Check available devices: aplay -l
{
  if [ -n "$PULSE_VOLUME" ]; then
    # Try common ALSA mixer controls in order of preference
    amixer -q sset Master "${PULSE_VOLUME}%" 2>/dev/null \
      || amixer -q sset PCM "${PULSE_VOLUME}%" 2>/dev/null \
      || true
    echo "Audio: volume → ${PULSE_VOLUME}%"
  fi
} 2>/dev/null || true

# Select ALSA output device if explicitly configured.
# 'auto' uses the ALSA default (defined by alsa.conf).
# Any other value is passed directly as the --alsa-output-device Chromium flag.
if [ -n "$PULSE_SINK" ] && [ "$PULSE_SINK" != "auto" ]; then
  EXTRAOPTS="$EXTRAOPTS --alsa-output-device=${PULSE_SINK}"
  echo "Audio: ALSA device → ${PULSE_SINK}"
fi

exec "$SNAP/sbf-kiosk" \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --disable-dev-shm-usage \
  --enable-wayland-ime \
  --no-sandbox \
  $EXTRAOPTS
