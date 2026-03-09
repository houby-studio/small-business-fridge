#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

# Read all snap configuration for use in this script.
# The Electron app reads these directly via snapctl — no env exports needed.
KIOSK_URL=$(snapctl get url)
KIOSK_LANG=$(snapctl get lang)
AUDIO_SINK=$(snapctl get audio-sink)
AUDIO_VOLUME=$(snapctl get audio-volume)
DAEMON=$(snapctl get daemon)
ALLOWED_ORIGINS=$(snapctl get allowed-origins)

echo "Launching Kiosk App with config:
- url             = $KIOSK_URL
- lang            = $KIOSK_LANG
- audio-sink      = $AUDIO_SINK
- audio-volume    = $AUDIO_VOLUME
- daemon          = $DAEMON
- allowed-origins = $ALLOWED_ORIGINS"

# Optional language override from snap config: snap set sbf-kiosk lang=cs-CZ
if [ -n "$KIOSK_LANG" ]; then
  EXTRAOPTS="$EXTRAOPTS --lang=$KIOSK_LANG"
fi

# --- ALSA audio initialisation ---
# The sound card boots with Master muted at 0%. We must unmute and set volume
# before Electron starts, otherwise there is no sound even though the hardware works.
# Requires the 'alsa' snap plug to be connected (auto on store installs;
# manual on sideloads: sudo snap connect sbf-kiosk:alsa).
{
  VOL="${AUDIO_VOLUME:-100}"

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
#   snap set sbf-kiosk audio-sink=hw:0,0   # ALC3228 Analog
#   snap set sbf-kiosk audio-sink=hw:0,3   # HDMI 0
#   snap set sbf-kiosk audio-sink=hw:0,7   # HDMI 1
if [ -n "$AUDIO_SINK" ] && [ "$AUDIO_SINK" != "auto" ]; then
  EXTRAOPTS="$EXTRAOPTS --alsa-output-device=${AUDIO_SINK}"
  echo "Audio: ALSA device → ${AUDIO_SINK}"
fi

exec "$SNAP/sbf-kiosk" \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --disable-dev-shm-usage \
  --enable-wayland-ime \
  --no-sandbox \
  $EXTRAOPTS
