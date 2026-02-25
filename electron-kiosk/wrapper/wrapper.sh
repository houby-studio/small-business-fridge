#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

# Optional runtime locale override from snap config:
#   snap set sbf-kiosk locale=cs-CZ
LOCALE=$(snapctl get locale 2>/dev/null || true)
if [ -n "$LOCALE" ]; then
  EXTRAOPTS="$EXTRAOPTS --lang=$LOCALE"
fi

exec "$SNAP/sbf-kiosk" \
  --enable-features=UseOzonePlatform \
  --ozone-platform=wayland \
  --disable-dev-shm-usage \
  --enable-wayland-ime \
  --no-sandbox \
  $EXTRAOPTS
