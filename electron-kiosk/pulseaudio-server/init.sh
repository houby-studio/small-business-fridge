#!/bin/bash

# Default values
DEFAULT_SINK="${PULSE_SINK:-hdmi}"
VOLUME="${PULSE_VOLUME:-100}"
UNMUTE="${PULSE_UNMUTE:-true}"
STARTUP_DELAY="${PULSE_STARTUP_DELAY:-2}"
ALSA_CARD="${PULSE_ALSA_CARD:-0}"

echo "==================================="
echo "PulseAudio Container Configuration"
echo "==================================="
echo "Sink Type: ${DEFAULT_SINK}"
echo "Volume: ${VOLUME}%"
echo "Unmute: ${UNMUTE}"
echo "Startup Delay: ${STARTUP_DELAY}s"
echo "ALSA Card: ${ALSA_CARD}"
echo "==================================="

configure_alsa_mixer() {
    if ! command -v amixer >/dev/null 2>&1; then
        echo "amixer not available; skipping ALSA mixer configuration."
        return
    fi

    if [ "${UNMUTE}" = "true" ]; then
        echo "Applying ALSA mixer unmute/volume on card ${ALSA_CARD}..."

        # Common playback controls across desktop/laptop HDA codecs.
        for ctl in "Master" "Speaker" "Line Out" "Speaker+LO" "Headphone" "PCM" "Front"; do
            amixer -c "${ALSA_CARD}" sset "${ctl}" unmute >/dev/null 2>&1 || true
            amixer -c "${ALSA_CARD}" sset "${ctl}" "${VOLUME}%" >/dev/null 2>&1 || true
            amixer -c "${ALSA_CARD}" sset "${ctl}" "${VOLUME}%" unmute >/dev/null 2>&1 || true
        done

        # Keep digital outputs enabled where applicable.
        for iec in "IEC958" "IEC958,1" "IEC958,2"; do
            amixer -c "${ALSA_CARD}" sset "${iec}" on >/dev/null 2>&1 || true
            amixer -c "${ALSA_CARD}" sset "${iec}" unmute >/dev/null 2>&1 || true
        done
    fi
}

# Point pactl at the Unix socket PulseAudio will create.
export PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"

# Start PulseAudio in background
echo "Starting PulseAudio..."
pulseaudio --exit-idle-time=-1 --log-target=stderr --daemonize=no &
PULSE_PID=$!

# Wait for PulseAudio to fully initialize
echo "Waiting for PulseAudio to initialize..."
sleep ${STARTUP_DELAY}

# Wait for PulseAudio to be ready (up to 10 attempts)
for i in {1..10}; do
    if pactl info >/dev/null 2>&1; then
        echo "PulseAudio is ready!"
        break
    fi
    echo "Waiting for PulseAudio... ($i/10)"
    if [ "$i" -eq 10 ]; then
      echo "ERROR: PulseAudio did not become ready after 10 attempts. Exiting."
      exit 1
    fi
    sleep 1
done

# List available sinks
echo ""
echo "Available audio outputs:"
pactl list sinks short

# Some devices boot with ALSA master muted; fix hardware mixer before sink routing.
configure_alsa_mixer

# Determine which sink to use based on DEFAULT_SINK variable
case "${DEFAULT_SINK}" in
    "hdmi"|"HDMI")
        # Try to find and load HDMI sink
        echo "Configuring HDMI output..."
        SINK_NAME=$(pactl list sinks short | grep -i hdmi | head -1 | awk '{print $2}')
        if [ -z "$SINK_NAME" ]; then
            echo "No HDMI sink found, trying to load it..."
            HDMI_DEV=$(aplay -l | grep -i hdmi | head -1 | sed -n 's/card \([0-9]\+\):.*device \([0-9]\+\):.*/plughw:\1,\2/p')
            if [ -n "$HDMI_DEV" ]; then
                pactl load-module module-alsa-sink device=$HDMI_DEV sink_name=hdmi_output || true
                SINK_NAME="hdmi_output"
            fi
        fi
    ;;
    "analog"|"speakers"|"headphones")
        # Try to find and load analog sink
        echo "Configuring Analog output..."
        SINK_NAME=$(pactl list sinks short | grep -E "analog|ALC|stereo" | head -1 | awk '{print $2}')
        if [ -z "$SINK_NAME" ]; then
            echo "No analog sink found, trying to load it..."
            ANALOG_DEV=$(aplay -l | grep -i analog | head -1 | sed -n 's/card \([0-9]\+\):.*device \([0-9]\+\):.*/plughw:\1,\2/p')
            if [ -n "$ANALOG_DEV" ]; then
                pactl load-module module-alsa-sink device=$ANALOG_DEV sink_name=analog_output || true
                SINK_NAME="analog_output"
            fi
        fi
    ;;
    "auto"|"")
        # Load all available devices first, then use first available
        echo "Auto mode: Loading all available audio devices..."
        for dev in $(aplay -l | grep "^card" | sed -n 's/card \([0-9]\+\):.*device \([0-9]\+\):.*/\1,\2/p'); do
            echo "Trying to load device: plughw:$dev"
            pactl load-module module-alsa-sink device=plughw:$dev 2>/dev/null || true
        done
        SINK_NAME=$(pactl list sinks short | grep -v "auto_null" | head -1 | awk '{print $2}')
    ;;
    *)
        # Use the exact sink name provided - but check if it exists first!
        echo "Looking for specific sink: ${DEFAULT_SINK}"
        SINK_NAME=$(pactl list sinks short | grep "^[0-9]*[[:space:]]${DEFAULT_SINK}" | awk '{print $2}')

        if [ -z "$SINK_NAME" ]; then
            echo "Sink '${DEFAULT_SINK}' not found. Trying to parse as ALSA device..."

            # Check if it looks like an ALSA device name (contains "alsa_output" or "hw:" or "plughw:")
            if [[ "${DEFAULT_SINK}" == *"alsa_output"* ]] || [[ "${DEFAULT_SINK}" == *"hw:"* ]] || [[ "${DEFAULT_SINK}" == *"plughw:"* ]]; then
                # Extract device spec if it's in the name
                if [[ "${DEFAULT_SINK}" == *"hw:"* ]] || [[ "${DEFAULT_SINK}" == *"plughw:"* ]]; then
                    # It's already a device spec, use it directly
                    DEVICE_SPEC="${DEFAULT_SINK}"
                else
                    # Try to extract from alsa_output name (this is a guess based on common patterns)
                    echo "Attempting to load all devices and find match..."
                    for dev in $(aplay -l | grep "^card" | sed -n 's/card \([0-9]\+\):.*device \([0-9]\+\):.*/\1,\2/p'); do
                        pactl load-module module-alsa-sink device=plughw:$dev 2>/dev/null || true
                    done
                fi

                # If we have a device spec, try to load it
                if [ -n "$DEVICE_SPEC" ]; then
                    echo "Loading ALSA device: ${DEVICE_SPEC}"
                    pactl load-module module-alsa-sink device="${DEVICE_SPEC}" sink_name="${DEFAULT_SINK}" || true
                fi
            else
                # Not an ALSA device name, try to load all and see if it appears
                echo "Loading all available devices to find '${DEFAULT_SINK}'..."
                for dev in $(aplay -l | grep "^card" | sed -n 's/card \([0-9]\+\):.*device \([0-9]\+\):.*/\1,\2/p'); do
                    pactl load-module module-alsa-sink device=plughw:$dev 2>/dev/null || true
                done
            fi

            # Check again if sink exists now
            SINK_NAME=$(pactl list sinks short | grep "${DEFAULT_SINK}" | head -1 | awk '{print $2}')
            if [ -z "$SINK_NAME" ]; then
                echo "WARNING: Could not find or load sink '${DEFAULT_SINK}'"
                echo "Falling back to first available sink..."
                SINK_NAME=$(pactl list sinks short | grep -v "auto_null" | head -1 | awk '{print $2}')
            fi
        else
            SINK_NAME="${DEFAULT_SINK}"
        fi
    ;;
esac

# Set default sink
if [ -n "$SINK_NAME" ]; then
    echo "Setting default sink to: ${SINK_NAME}"
    pactl set-default-sink "${SINK_NAME}"

    # Unmute if requested
    if [ "${UNMUTE}" = "true" ]; then
        echo "Unmuting ${SINK_NAME}..."
        pactl set-sink-mute "${SINK_NAME}" 0
    fi

    # Set volume
    echo "Setting volume to ${VOLUME}%..."
    pactl set-sink-volume "${SINK_NAME}" "${VOLUME}%"

    echo ""
    echo "==================================="
    echo "Configuration complete!"
    echo "Default sink: ${SINK_NAME}"
    echo "Volume: ${VOLUME}%"
    echo "Muted: $([ "${UNMUTE}" = "true" ] && echo "No" || echo "Yes")"
    echo "==================================="
else
    echo "WARNING: No suitable audio sink found!"
fi

# Show final status
echo ""
echo "Current audio outputs:"
pactl list sinks short

# Keep PulseAudio running
echo ""
echo "PulseAudio is running. Container ready!"
wait $PULSE_PID
