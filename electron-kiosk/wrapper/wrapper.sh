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
# Run a snap-private PA instance so no external audio server is needed.
# PULSE_RUNTIME_PATH controls where PA places its Unix socket and PID file.
# A fresh directory each start avoids stale sockets from previous runs.
export PULSE_RUNTIME_PATH="${SNAP_USER_COMMON}/pulse/runtime"
rm -rf "$PULSE_RUNTIME_PATH"
mkdir -p "$PULSE_RUNTIME_PATH"

# PA's private shared library (libpulsecore, libpulsecommon) lives in an
# arch-specific subdirectory. The override-prime step in snapcraft.yaml copies
# it to usr/lib/pulseaudio/ so we can add it to LD_LIBRARY_PATH here.
PA_LIB_DIR="$SNAP/usr/lib/pulseaudio"
[ -d "$PA_LIB_DIR" ] && export LD_LIBRARY_PATH="${PA_LIB_DIR}:${LD_LIBRARY_PATH:-}"

# Modules live in a versioned directory (e.g. pulse-16.1+dfsg1/modules).
# Glob at runtime so this works across any PA version staged in the snap.
PA_MOD_DIR=$(ls -d "$SNAP"/usr/lib/pulse-*/modules 2>/dev/null | head -1)

if [ -n "$PA_MOD_DIR" ]; then
  echo "Starting PulseAudio (modules: $PA_MOD_DIR)..."
  "$SNAP/usr/bin/pulseaudio" \
    --dl-search-path="$PA_MOD_DIR" \
    --daemonize=no \
    --exit-idle-time=-1 \
    --file="$SNAP/etc/sbf-kiosk/pulse.pa" \
    2>/dev/null &

  # Tell Electron/Chromium where to find our PA socket.
  export PULSE_SERVER="unix:${PULSE_RUNTIME_PATH}/native"

  # Wait for module-native-protocol-unix to create the socket (up to 30 s).
  TRIES=0
  while ! [ -S "${PULSE_RUNTIME_PATH}/native" ]; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge 30 ]; then
      echo "WARNING: PulseAudio not ready after 30s. Continuing without audio."
      unset PULSE_SERVER
      break
    fi
    sleep 1
  done
  [ -S "${PULSE_RUNTIME_PATH}/native" ] && echo "PulseAudio ready."
else
  echo "WARNING: PulseAudio modules not found in snap. Audio disabled."
fi

# Configure output sink and volume via pactl.
# Runs after PA is up; silently skipped if PA is unavailable.
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
