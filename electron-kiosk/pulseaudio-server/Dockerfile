ARG UBUNTU_VERSION
FROM ubuntu:${UBUNTU_VERSION}

RUN apt-get update && \
  apt-get install -y pulseaudio pulseaudio-utils alsa-utils && \
  rm -rf /var/lib/apt/lists/*

# Create a dedicated kiosk user (uid 1000) to match the host kiosk user.
# PulseAudio will run as this user and own the Unix socket.
RUN useradd -u 1000 -ms /bin/bash kiosk

ENV HOME=/home/kiosk \
    XDG_RUNTIME_DIR=/run/user/1000

# Add init script and privilege-dropping entrypoint
COPY init.sh /usr/local/bin/init.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/init.sh /usr/local/bin/entrypoint.sh

# Entrypoint runs as root to fix socket directory ownership, then drops to kiosk (uid 1000)
USER root
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
