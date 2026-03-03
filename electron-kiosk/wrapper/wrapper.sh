#!/bin/sh

# Raspberry Pi 4 has GPU quirks with Electron — disable GPU acceleration there
if grep -q "Pi 4" /proc/cpuinfo; then
  EXTRAOPTS="--disable-gpu"
fi

export KIOSK_URL=$(snapctl get kiosk-url)
export LOCALE=$(snapctl get locale)
export SYSTEM_SOUND_PULSESERVER=$(snapctl get pulseserver)

echo "Launching Kiosk App with config:
- KIOSK_URL                             = $KIOSK_URL
- LOCALE                                = $LOCALE
- SYSTEM_SOUND_PULSESERVER              = $SYSTEM_SOUND_PULSESERVER"

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
