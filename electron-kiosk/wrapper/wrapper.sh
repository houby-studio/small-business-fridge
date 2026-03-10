#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

# Keep ALSA pointed at the snap-staged config and plugins. Without these,
# Chromium/aplay may fail with "Unknown PCM default" under strict confinement.
export ALSA_CONFIG_PATH="${ALSA_CONFIG_PATH:-$SNAP/usr/share/alsa/alsa.conf}"
export ALSA_CONFIG_DIR="${ALSA_CONFIG_DIR:-$SNAP/usr/share/alsa}"
export ALSA_PLUGIN_DIR="${ALSA_PLUGIN_DIR:-$SNAP/usr/lib/$SNAPCRAFT_ARCH_TRIPLET/alsa-lib}"

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
- allowed-origins = $ALLOWED_ORIGINS
- alsa-config     = $ALSA_CONFIG_PATH
- alsa-plugins    = $ALSA_PLUGIN_DIR"

if command -v aplay >/dev/null 2>&1; then
  AUDIO_DEVICE_LIST="$(aplay -l 2>/dev/null || true)"
  if [ -n "$AUDIO_DEVICE_LIST" ]; then
    echo "Audio: available ALSA playback devices:"
    printf '%s\n' "$AUDIO_DEVICE_LIST"
  else
    echo "Audio: no ALSA playback devices reported by aplay -l"
  fi
else
  echo "Audio: aplay not available inside snap runtime"
fi

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
  MIXER_CONTROLS="$(amixer scontrols 2>/dev/null || true)"
  PRIMARY_CONTROLS=""

  has_control() {
    printf '%s\n' "$MIXER_CONTROLS" | grep -Fq "Simple mixer control '$1',"
  }

  append_control() {
    if [ -z "$PRIMARY_CONTROLS" ]; then
      PRIMARY_CONTROLS="$1"
    else
      PRIMARY_CONTROLS="$PRIMARY_CONTROLS $1"
    fi
  }

  # Prefer real output-volume controls. On some devices PCM is a coarse or
  # internal gain stage where any percentage below 100 can collapse to silence.
  for CTL in Master Speaker Headphone Front; do
    has_control "$CTL" && append_control "$CTL"
  done

  # Fall back to PCM only when there is no other playback volume control.
  if [ -z "$PRIMARY_CONTROLS" ] && has_control "PCM"; then
    PRIMARY_CONTROLS="PCM"
  fi

  # The 'unmute' keyword is required — without it amixer only changes the level.
  for CTL in $PRIMARY_CONTROLS; do
    amixer -M -q sset "$CTL" "${VOL}%" unmute 2>/dev/null || true
  done

  # Keep PCM alive at full scale unless it is the only available playback
  # control. This avoids cards where reducing PCM effectively mutes output.
  if has_control "PCM" && [ "$PRIMARY_CONTROLS" != "PCM" ]; then
    amixer -M -q sset "PCM" "100%" unmute 2>/dev/null || true
  fi

  # Also unmute digital/HDMI controls (no volume knob, just switch)
  for CTL in "IEC958" "IEC958 Default PCM" "S/PDIF"; do
    amixer -q sset "$CTL" unmute 2>/dev/null || true
  done

  echo "Audio: volume → ${VOL}% (primary controls: ${PRIMARY_CONTROLS:-none}, PCM preserved when present)"
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
