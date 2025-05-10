# === camera.dev.Dockerfile ===
#
# Base Image: ubuntu:22.04
# - Builds libcamera and rpicam-apps from source
#

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install libcamera dependencies
RUN apt-get update && apt-get install -y \
    libboost-dev \
    libgnutls28-dev openssl libtiff-dev pybind11-dev \
    qtbase5-dev libqt5core5a libqt5widgets5 \
    cmake \
    python3-yaml python3-ply \
    libglib2.0-dev libgstreamer-plugins-base1.0-dev \
    git ninja-build build-essential python3-pip

# Install latest Meson (>=0.63) via pip and remove apt version if present
RUN apt-get remove -y meson || true && \
    pip3 install --upgrade pip && \
    pip3 install 'meson>=0.63' jinja2 PyYAML

# Build and install libcamera from Raspberry Pi's fork
WORKDIR /root
RUN git clone https://github.com/raspberrypi/libcamera.git
WORKDIR /root/libcamera
RUN meson setup build --buildtype=release -Dpipelines=rpi/vc4,rpi/pisp -Dipas=rpi/vc4,rpi/pisp -Dv4l2=true -Dgstreamer=enabled -Dtest=false -Dlc-compliance=disabled -Dcam=disabled -Dqcam=disabled -Ddocumentation=disabled -Dpycamera=enabled && \
    ninja -C build install

# Install rpicam-apps dependencies
RUN apt-get update && apt-get install -y \
    cmake libboost-program-options-dev libdrm-dev libexif-dev \
    meson ninja-build libpng-dev

# Build and install rpicam-apps from source
WORKDIR /root
RUN git clone https://github.com/raspberrypi/rpicam-apps.git && \
    cd rpicam-apps && \
    meson setup build -Denable_libav=disabled -Denable_drm=enabled -Denable_egl=disabled -Denable_qt=disabled -Denable_opencv=disabled -Denable_tflite=disabled -Denable_hailo=disabled && \
    meson compile -C build && \
    meson install -C build && \
    ldconfig

# Load necessary kernel modules for camera support
RUN apt-get update && apt-get install -y udev kmod && \
    modprobe vchiq && \
    modprobe bcm2835-v4l2 || true

# Set default workdir
WORKDIR /root

CMD ["bash"]
