# Simple Edge TPU Test Dockerfile
# Based on Ubuntu 20.04 which has Python 3.8 by default (compatible with PyCoral)
FROM ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive

# Install basic dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    python3 \
    python3-pip \
    git \
    wget \
    usbutils \
    libusb-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Add Google Cloud package repository
RUN echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | tee /etc/apt/sources.list.d/coral-edgetpu.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add -

# Install Edge TPU runtime and PyCoral
RUN apt-get update && apt-get install -y \
    libedgetpu1-std \
    python3-pycoral \
    && rm -rf /var/lib/apt/lists/*

# Create workspace and clone PyCoral examples
WORKDIR /workspace
RUN git clone https://github.com/google-coral/pycoral.git

# Download test data
WORKDIR /workspace/pycoral
RUN bash examples/install_requirements.sh classify_image.py

# Copy our test script
COPY src/object_detector/test_edge_tpu.py /workspace/

# Copy the model you already have
COPY models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite /workspace/models/
COPY models/coco_labels.txt /workspace/models/

WORKDIR /workspace

CMD ["bash"]