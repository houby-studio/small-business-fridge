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

# --- ALSA audio initialisation ---
# The sound card boots with Master muted at 0%. We must unmute and set volume
# before Electron starts, otherwise there is no sound even though the hardware works.
# Requires the 'alsa' snap plug to be connected (auto on store installs;
# manual on sideloads: sudo snap connect sbf-kiosk:alsa).
{
  VOL="${PULSE_VOLUME:-100}"

  # Unmute and set volume on every relevant analog control.
  # The 'unmute' keyword is required — without it amixer only changes the level.
  for CTL in Master PCM Speaker Headphone; do
    amixer -q sset "$CTL" "${VOL}%" unmute 2>/dev/null || true
  done

  # Also unmute digital/HDMI controls (no volume knob, just switch)
  for CTL in "IEC958" "IEC958 Default PCM" "S/PDIF"; do
    amixer -q sset "$CTL" unmute 2>/dev/null || true
  done

  echo "Audio: volume → ${VOL}% (controls unmuted)"
} 2>/dev/null || echo "Audio: amixer not available — is the 'alsa' plug connected?"

# Select ALSA output device if explicitly configured.
# 'auto' uses the ALSA default (hw:0,0 = analog on most Intel HDA systems).
# Available devices: run  aplay -l  from inside the snap:
#   sudo snap run --shell sbf-kiosk.daemon -c "aplay -l"
#
# Examples:
#   snap set sbf-kiosk pulse-sink=hw:0,0   # ALC3228 Analog
#   snap set sbf-kiosk pulse-sink=hw:0,3   # HDMI 0
#   snap set sbf-kiosk pulse-sink=hw:0,7   # HDMI 1
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
