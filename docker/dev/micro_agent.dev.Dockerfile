# === micro_agent.Dockerfile ===
#
# Base Image: ubuntu:22.04
# - We use plain Ubuntu because the Micro XRCE-DDS Agent only needs basic build tools
# - No ROS 2 required since this agent just bridges between ROS 2 DDS and PX4 uORB

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    git cmake g++ libasio-dev libtinyxml2-dev libssl-dev libboost-system-dev \
    libeigen3-dev pkg-config

WORKDIR /root/ws_droneOS

CMD ["bash"]
