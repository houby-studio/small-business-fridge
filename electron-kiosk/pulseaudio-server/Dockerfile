ARG UBUNTU_VERSION=24.04
FROM ubuntu:${UBUNTU_VERSION}

# Use BuildKit cache mounts to speed up repeated builds (especially arm64 via QEMU).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends pulseaudio pulseaudio-utils alsa-utils

# Ensure a home directory exists for uid 1000.
# Ubuntu base images already ship a user at uid 1000 ("ubuntu"); we do not
# create a new one — setpriv accepts numeric uids directly.
RUN mkdir -p /home/kiosk && chown 1000:1000 /home/kiosk

ENV HOME=/home/kiosk \
    XDG_RUNTIME_DIR=/run/user/1000

# Configure PulseAudio for network access.
#
# TCP  (primary): the snap connects via tcp:localhost:4713; the port is bound to
#   127.0.0.1 in compose.yaml so it is not reachable from the network.
# Unix socket (secondary): kept for local tooling (pactl in the healthcheck).
#
# auth-anonymous=1 is required for both because the snap daemon runs as root
# while PulseAudio runs as uid 1000 — their cookie files never match.
#
# The sed replaces the default unix socket line in-place; the echo adds TCP.
RUN sed -i \
      's|^load-module module-native-protocol-unix.*|load-module module-native-protocol-unix auth-anonymous=1|' \
      /etc/pulse/default.pa && \
    grep -q 'module-native-protocol-unix' /etc/pulse/default.pa || \
      echo 'load-module module-native-protocol-unix auth-anonymous=1' >> /etc/pulse/default.pa && \
    echo 'load-module module-native-protocol-tcp auth-ip-acl=127.0.0.1;172.16.0.0/12;192.168.0.0/16;10.0.0.0/8 auth-anonymous=1' \
      >> /etc/pulse/default.pa

# Add init script and privilege-dropping entrypoint
COPY init.sh /usr/local/bin/init.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/init.sh /usr/local/bin/entrypoint.sh

# Entrypoint runs as root to fix socket directory ownership, then drops to uid 1000
USER root
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
