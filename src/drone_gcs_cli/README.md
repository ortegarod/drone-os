# Package: `drone_gcs_cli`

**`drone_gcs_cli`** is a Python-based ROS 2 package within the **DroneOS** workspace providing an interactive command-line interface (CLI) for interacting with drones managed by `drone_core`.

## 🎯 Purpose

- **Interactive Control**: Offer a terminal-based tool to send basic commands to a specific drone.
- **Monitoring**: Display drone status information (currently placeholder).
- **Target Selection**: Allow switching focus between multiple drones if present.
- **Development/Debugging**: Facilitate direct interaction for testing and debugging `drone_core` functionalities.

## 🏗️ Architecture

- **`cli.py`**: The main executable script (`ros2 run drone_gcs_cli cli`). It handles command parsing from user input and interacts with `GCSNode`.
- **`gcs_node.py`**: Defines the `GCSNode` class:
    - Initializes as a ROS 2 node (`gcs_cli_node`).
    - Creates ROS 2 **service clients** dynamically based on a `target_drone` name (e.g., `/drone1/arm`, `/drone2/takeoff`).
    - Currently uses `std_srvs.srv.Trigger` for most commands.
    - Includes placeholders (`TODO`) for status subscription and custom service types.
    - Manages asynchronous service calls.
- **Dependencies**: `rclpy`, `std_srvs`.

## ✨ Features & Commands

- **Targeting**: `target <drone_name>` - Switch the CLI's focus to a different drone.
- **Mode Control**: `set_offboard`, `set_posctl` - Request PX4 mode changes.
- **Basic Flight**: `arm`, `disarm`, `takeoff`, `land` - Send fundamental flight commands.
- **Status**: `status` - Display current drone status (Implementation TBD).
- **Advanced (Placeholders)**: `rtl` (Return To Launch), `behavior <name>` - Placeholders for future command implementation.
- **Help**: `help` - Display available commands.
- **Exit**: `exit` - Quit the CLI.

## 🚀 Getting Started

1.  **Build**: Ensure `drone_core` (providing the services) is built. Then build this package:
    ```bash
    colcon build --packages-select drone_gcs_cli
    ```
2.  **Source**: Source the workspace:
    ```bash
    source install/setup.bash
    ```
3.  **Run**: Launch the `drone_core` node(s) for the target drone(s) first. Then run the CLI:
    ```bash
    # Example: Target drone1 by default
    ros2 run drone_gcs_cli cli 

    # Example: Specify a different default drone
    ros2 run drone_gcs_cli cli --default-drone drone2
    ```
4.  **Interact**: Use the commands listed above (e.g., `target drone1`, `arm`, `takeoff`).

## 📚 Documentation

- Refer to the source code (`cli.py`, `gcs_node.py`) for implementation details.
- See the main workspace `README.md` for overall project context.

## 📄 License

Proprietary - All rights reserved. 