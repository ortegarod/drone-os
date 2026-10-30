# DroneOS object detector: ROS 2 Humble, Python 3.10, tflite-runtime + Coral Edge TPU runtime.
# Edge TPU via the libedgetpu delegate when a Coral is plugged in, CPU otherwise (same image).
# PyCoral is not used: its last release (2.0.0) ships Linux wheels for Python <= 3.9 only, Humble needs 3.10.
#
# libedgetpu: the official Coral apt repo (packages.cloud.google.com/apt coral-edgetpu-stable) returned
# 403 Forbidden on 2026-10-29. We use feranick's maintained builds of google-coral/libedgetpu instead
# (https://github.com/feranick/libedgetpu/releases), paired with tflite_runtime from the SAME TensorFlow
# version (https://github.com/feranick/TFlite-builds/releases): libedgetpu is built against one TF version.
FROM ros:humble

ARG TF_VER=2.17.1
ARG EDGETPU_TAG=16.0TF2.17.1-1
ARG EDGETPU_DEB=libedgetpu1-std_16.0tf2.17.1-1.ubuntu22.04_amd64.deb

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3-pip curl ca-certificates usbutils libusb-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Coral runtime (std clock). Installs /usr/lib/x86_64-linux-gnu/libedgetpu.so.1 (+ a udev rule that only matters on the host).
RUN curl -fsSL -o /tmp/edgetpu.deb "https://github.com/feranick/libedgetpu/releases/download/${EDGETPU_TAG}/${EDGETPU_DEB}" \
    && apt-get update && (apt-get install -y --no-install-recommends /tmp/edgetpu.deb || dpkg -i --force-depends /tmp/edgetpu.deb) \
    && rm -rf /tmp/edgetpu.deb /var/lib/apt/lists/* \
    && ls -l /usr/lib/x86_64-linux-gnu/libedgetpu.so.1

# numpy < 2: Humble's rclpy/sensor_msgs_py are built against numpy 1.x
RUN python3 -m pip install --no-cache-dir "numpy<2" \
        "https://github.com/feranick/TFlite-builds/releases/download/v${TF_VER}/tflite_runtime-${TF_VER}-cp310-cp310-linux_x86_64.whl"

WORKDIR /workspace
CMD ["bash"]
