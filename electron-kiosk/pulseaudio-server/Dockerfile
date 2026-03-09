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

# Add init script and privilege-dropping entrypoint
COPY init.sh /usr/local/bin/init.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/init.sh /usr/local/bin/entrypoint.sh

# Entrypoint runs as root to fix socket directory ownership, then drops to uid 1000
USER root
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
