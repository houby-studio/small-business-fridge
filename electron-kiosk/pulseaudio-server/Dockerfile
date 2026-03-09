ARG UBUNTU_VERSION
FROM ubuntu:${UBUNTU_VERSION}

RUN apt-get update && \
  apt-get install -y pulseaudio pulseaudio-utils alsa-utils && \
  rm -rf /var/lib/apt/lists/*

# Configure for non-system mode with network access
RUN echo "load-module module-native-protocol-tcp auth-ip-acl=127.0.0.1;172.16.0.0/12;192.168.0.0/16;10.0.0.0/8 auth-anonymous=1"

# Create a dummy home for root's PulseAudio
RUN mkdir -p /root/.config/pulse

# Add init script
COPY init.sh /usr/local/bin/init.sh
RUN chmod +x /usr/local/bin/init.sh

EXPOSE 4713

USER root
ENTRYPOINT ["/usr/local/bin/init.sh"]
