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

# --- Bundled PulseAudio ---

# Add PA's private shared library (libpulsecore, libpulsecommon) to the library path.
# The override-prime step in snapcraft.yaml normalises it to usr/lib/pulseaudio/.
PA_LIB_DIR="$SNAP/usr/lib/pulseaudio"
[ -d "$PA_LIB_DIR" ] && export LD_LIBRARY_PATH="${PA_LIB_DIR}:${LD_LIBRARY_PATH:-}"

# Locate versioned module directory (e.g. pulse-16.1+dfsg1/modules).
# Glob so this works across any PA version staged in the snap.
PA_MOD_DIR=$(ls -d "$SNAP"/usr/lib/pulse-*/modules 2>/dev/null | head -1)

if [ -n "$PA_MOD_DIR" ]; then
  # PulseAudio refuses to start as root in normal user mode.
  # Snap daemons run as root, so we use --system which:
  #   - allows root execution
  #   - places the socket at /run/pulse/native
  # The audio-playback plug grants /run/pulse/** rw so this path is accessible.
  if [ "$(id -u)" = "0" ]; then
    mkdir -p /run/pulse
    PA_MODE="--system"
    export PULSE_SERVER="unix:/run/pulse/native"
    PA_SOCKET="/run/pulse/native"
  else
    export PULSE_RUNTIME_PATH="${SNAP_USER_COMMON}/pulse/runtime"
    rm -rf "$PULSE_RUNTIME_PATH"
    mkdir -p "$PULSE_RUNTIME_PATH"
    PA_MODE=""
    export PULSE_SERVER="unix:${PULSE_RUNTIME_PATH}/native"
    PA_SOCKET="${PULSE_RUNTIME_PATH}/native"
  fi

  echo "Starting PulseAudio (modules: $PA_MOD_DIR, mode: ${PA_MODE:-(user)})..."
  # --no-realtime: skip mlockall/SCHED_RR which AppArmor may block in strict confinement.
  # stderr intentionally not suppressed so failures appear in snap logs.
  "$SNAP/usr/bin/pulseaudio" \
    $PA_MODE \
    --no-realtime \
    --dl-search-path="$PA_MOD_DIR" \
    --daemonize=no \
    --exit-idle-time=-1 \
    --file="$SNAP/etc/sbf-kiosk/pulse.pa" &

  # Wait for module-native-protocol-unix to create the socket (up to 30s).
  TRIES=0
  while ! [ -S "$PA_SOCKET" ]; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge 30 ]; then
      echo "WARNING: PulseAudio not ready after 30s. Continuing without audio."
      unset PULSE_SERVER
      break
    fi
    sleep 1
  done
  [ -S "$PA_SOCKET" ] && echo "PulseAudio ready at $PULSE_SERVER"
else
  echo "WARNING: PulseAudio modules not found in snap. Audio disabled."
fi

# Configure output sink and volume via pactl.
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
