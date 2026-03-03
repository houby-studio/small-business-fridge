#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

export KIOSK_URL=$(snapctl get kiosk-url)
export LANG=$(snapctl get lang)
export PULSESERVER=$(snapctl get pulseserver)

echo "Launching Kiosk App with config:
- KIOSK_URL                             = $KIOSK_URL
- LANG                                  = $LANG
- PULSESERVER                           = $PULSESERVER"

# Optional runtime LANG override from snap config:
#   snap set sbf-kiosk LANG=cs-CZ
LANG=$(snapctl get lang 2>/dev/null || true)
if [ -n "$LANG" ]; then
  EXTRAOPTS="$EXTRAOPTS --lang=$LANG"
fi

exec "$SNAP/sbf-kiosk" \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --disable-dev-shm-usage \
  --enable-wayland-ime \
  --no-sandbox \
  $EXTRAOPTS
