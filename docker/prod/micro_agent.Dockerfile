FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    git cmake g++ libasio-dev libtinyxml2-dev libssl-dev libboost-system-dev \
    libeigen3-dev pkg-config && \
    rm -rf /var/lib/apt/lists/*

# Copy local working agent
COPY Micro-XRCE-DDS-Agent /root/Micro-XRCE-DDS-Agent

# Build agent from source
WORKDIR /root/Micro-XRCE-DDS-Agent
RUN rm -rf build && mkdir build && cd build && \
    cmake .. && \
    make -j$(nproc) && \
    make install

# Tell the runtime where to find the shared libs
ENV LD_LIBRARY_PATH=/usr/local/lib

# Expose UDP port
EXPOSE 8888

# Run Micro XRCE Agent
CMD ["MicroXRCEAgent", "udp4", "-p", "8888"]
