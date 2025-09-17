#!/bin/bash

echo "=== Nodes ==="
ros2 node list

echo -e "\n=== Topics ==="
ros2 topic list

echo -e "\n=== Services ==="
ros2 service list