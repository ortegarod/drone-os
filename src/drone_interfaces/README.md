# Package: `drone_interfaces`

**`drone_interfaces`** is a ROS 2 package within the **DroneOS** workspace that defines custom service and message interfaces used across the workspace.

## 🎯 Purpose

- **Service Definitions**: Provide standardized service interfaces for drone control operations
- **Message Definitions**: Define custom message types for drone-specific data
- **Interface Standardization**: Ensure consistent communication patterns across DroneOS components

## 📦 Contents

### Services (`srv/`)

- **`SetPosition.srv`**: Service for setting target position and yaw in offboard mode
  - Request: `float32 x, float32 y, float32 z, float32 yaw`
  - Response: `bool success, string message`
  - Usage: Used by `drone_core` for position control and `drone_gcs_cli` for command interface

## 🔗 Dependencies

- **ROS 2**: Humble (or newer)
- **Build Dependencies**: 
  - `ament_cmake`
  - `rosidl_default_generators`
- **Runtime Dependencies**:
  - `rosidl_typesupport_cpp`
  - `rosidl_typesupport_c`

## 🚀 Usage

This package is primarily used as a dependency by other packages in the workspace:

- `drone_core`: Implements the service servers
- `drone_gcs_cli`: Implements the service clients

Example service call from `drone_gcs_cli`:
```python
# Create request
request = SetPosition.Request()
request.x = 0.0
request.y = 0.0
request.z = -5.0  # 5 meters up
request.yaw = 0.0

# Send request
response = client.call(request)
```

## 📚 Documentation

- See the service definitions in `srv/` for detailed interface specifications
- Refer to the main workspace `README.md` for overall project context

## 📄 License

Proprietary - All rights reserved 