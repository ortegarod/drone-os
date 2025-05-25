# AI Drone Commander: Implementation Plan

**Overall Goal:** Create an autonomous AI-driven drone commander system that can receive high-level missions, execute them, and react to real-time environmental events (like object detection). This system will use an LLM for high-level strategic decision-making (acting as a "field general") and ROS 2 for drone interaction, ensuring the LLM is kept away from hard real-time piloting logic.

---

**Phase 1: Core Drone Control Tools & Basic Agent**

1.  **File: `drone_agent_tools.py`**
    *   **Class: `DroneROS2Commander`**
        *   **`__init__(self, default_drone_name='drone1')`**:
            *   Initializes `rclpy` and creates a ROS 2 Node (e.g., `drone_agent_ros_node`).
            *   Stores `target_drone` (initially `default_drone_name`).
            *   Sets up an `rclpy.executors.SingleThreadedExecutor`.
            *   Calls `_create_clients(self.target_drone)`.
            *   **NEW (for telemetry):** Initializes internal storage for telemetry data (e.g., `self.current_telemetry = {}`).
            *   **NEW (for telemetry):** Calls `_setup_telemetry_subscriptions(self.target_drone)`. This class handles direct ROS 2 subscriptions, providing latest data to the LLM agent only upon request via a tool.
        *   **`_create_clients(self, drone_name)`**:
            *   Creates and stores ROS 2 service clients for:
                *   `arm`, `disarm`, `takeoff`, `land`, `set_offboard`, `set_position_mode` (all `std_srvs.srv.Trigger`).
                *   `set_position` (`drone_interfaces.srv.SetPosition`).
            *   Service names: `f'/{drone_name}/<service_suffix>'`.
        *   **`_setup_telemetry_subscriptions(self, drone_name)` (NEW):**
            *   Creates ROS 2 subscribers for essential telemetry topics (e.g., odometry, battery, flight mode).
                *   *Requires user to provide topic names and message types.*
            *   Assigns callback functions to update `self.current_telemetry`.
        *   **`change_target_drone(self, new_drone_name: str)`**:
            *   Updates `self.target_drone`.
            *   Destroys old clients and subscriptions.
            *   Calls `_create_clients(new_drone_name)` and `_setup_telemetry_subscriptions(new_drone_name)`.
            *   Returns a status message.
        *   **`_call_trigger_service(self, service_name_suffix: str) -> (bool, str)`**: Helper to call `Trigger` services.
        *   **`_call_set_position_service(self, x: float, y: float, z: float, yaw: float) -> (bool, str)`**: Helper to call `SetPosition` service.
        *   **`get_latest_telemetry(self) -> dict` (NEW):**
            *   Returns a copy of `self.current_telemetry`.
        *   **`shutdown(self)`**: Cleans up executor, destroys node.
    *   **Global Instance (or passed to tools):**
        *   `drone_commander = DroneROS2Commander()`
    *   **Tool Functions (decorated with `@function_tool`):**
        *   `set_active_drone(drone_name: str) -> str`: Calls `drone_commander.change_target_drone()`.
        *   `drone_set_offboard_mode() -> str`: Calls `drone_commander._call_trigger_service('set_offboard')`.
        *   `drone_set_position_control_mode() -> str`: Calls `drone_commander._call_trigger_service('set_position_mode')`.
        *   `drone_arm() -> str`: Calls `drone_commander._call_trigger_service('arm')`.
        *   `drone_takeoff() -> str`: Calls `drone_commander._call_trigger_service('takeoff')`.
        *   `drone_land() -> str`: Calls `drone_commander._call_trigger_service('land')`.
        *   `drone_disarm() -> str`: Calls `drone_commander._call_trigger_service('disarm')`.
        *   `drone_set_position(x: float, y: float, z: float, yaw: float) -> str`: Calls `drone_commander._call_set_position_service()`.
        *   `get_drone_telemetry() -> str` **(NEW)**:
            *   Calls `drone_commander.get_latest_telemetry()`.
            *   Formats the dictionary as a string for the LLM.
            *   Docstring: "Retrieves a snapshot of the latest real-time telemetry data from the drone, including its current 3D position, velocity, orientation, battery percentage, and flight mode. Use this to understand the drone's current state or to get information needed for planning actions. The LLM does not subscribe directly; this tool provides data collected by the underlying system."

2.  **File: `run_basic_agent.py` (for initial testing)**
    *   Imports `Agent`, `Runner` from `openai-agents`.
    *   Imports tool functions and `drone_commander` from `drone_agent_tools.py`.
    *   Initializes `rclpy` (if not done in `DroneROS2Commander`'s module scope). This script is for basic testing of the agent's ability to call tools.
    *   Defines `ai_drone_agent = Agent(...)` with instructions for manual command execution and using telemetry for checks.
    *   Simple `input()` loop to send commands to `Runner.run_sync()`.
    *   Handles `KeyboardInterrupt` for graceful shutdown of `drone_commander` and `rclpy`.

---

**Phase 2: Autonomous Mission Orchestration**

1.  **ROS 2 Interface for External Events:**
    *   Define `drone_interfaces/msg/DetectionEvent.msg` (e.g., `string object_class, float32 confidence, geometry_msgs/Point position_estimate, string sensor_id`).
    *   Ensure your object detection node publishes these messages. The `MissionManager` will subscribe to these, not the LLM agent directly.

2.  **File: `mission_manager.py`**
    *   **Class: `AutonomousMissionManager`**
        *   **`__init__(self)`**:
            *   Initializes `rclpy` and creates a ROS 2 Node (e.g., `mission_manager_node`).
            *   Instantiates `drone_commander = DroneROS2Commander()` (from `drone_agent_tools.py`).
            *   Instantiates the `DroneControllerAgent = Agent(...)` (from `openai-agents`, configured with tools from `drone_agent_tools.py`). Instructions should be geared towards autonomous mission execution and event response, acting as a high-level decision maker.
            *   Sets up ROS 2 subscriber for `DetectionEvent` messages. Callback: `_handle_detection_event()`.
            *   Manages current mission (e.g., patrol route, objectives).
            *   Manages overall drone state.
        *   **`start_mission(self, mission_description: str)`**:
            *   Takes a high-level mission (e.g., "Patrol waypoints A, B, C and report intruders").
            *   Potentially uses the `DroneControllerAgent` to break down the mission or plan initial steps.
            *   Initiates the main mission loop/logic.
        *   **`_execute_mission_step(self)`**:
            *   Determines the next action based on the current mission plan and drone state.
            *   Formulates a prompt/input for the `DroneControllerAgent`.
            *   `result = Runner.run_sync(self.DroneControllerAgent, prompt)`
            *   Parses `result.final_output` (could be a command to execute via `drone_commander` tools, or a status update).
            *   Executes the command if applicable.
        *   **`_handle_detection_event(self, detection_msg: DetectionEvent)`**:
            *   Callback for intruder/object detections.
            *   Formulates a detailed prompt for the `DroneControllerAgent` including the event, current mission, drone state, and potential response options/objectives.
            *   `result = Runner.run_sync(self.DroneControllerAgent, prompt)`
            *   Parses and acts on the agent's decision.
        *   **`run(self)`**: Main loop that calls `_execute_mission_step()` periodically and allows ROS 2 callbacks to be processed.
        *   **`shutdown(self)`**: Cleans up `drone_commander`, `rclpy`.
    *   **Main Block (`if __name__ == '__main__':`)**:
        *   Creates an instance of `AutonomousMissionManager`.
        *   Calls `manager.start_mission("User-defined initial mission")`.
        *   Calls `manager.run()`.
        *   Handles graceful shutdown.

---

**Phase 3: Advanced Features & Refinements**

1.  **Sophisticated Planning:**
    *   Use a dedicated "Planning Agent" if mission breakdown becomes complex. This agent could generate a sequence of tasks or waypoints for the `DroneControllerAgent` and `MissionManager`.
2.  **Dynamic Re-planning:**
    *   Enable the `DroneControllerAgent` to request a re-plan from the `MissionManager` or Planning Agent if it encounters unexpected situations or blockages.
3.  **Enhanced Guardrails:**
    *   Implement safety guardrails using the Agents SDK for geofencing, battery level checks, command validation, etc.
4.  **Human-in-the-Loop Escalations:**
    *   Define conditions under which the autonomous system should pause and request human intervention or confirmation.
5.  **Learning/Adaptation (Long-term):**
    *   Explore fine-tuning models based on successful and unsuccessful mission logs/traces (OpenAI Agents SDK supports tracing which can feed into this).

---

**Implementation Steps (To be done in Act Mode):**

1.  **Create `drone_agent_tools.py` (Phase 1):**
    *   Implement `DroneROS2Commander` class with service calling logic.
    *   Implement basic tool functions (arm, takeoff, land, disarm, set_position, set_modes, set_active_drone).
    *   *Defer telemetry subscriptions and `get_drone_telemetry` tool until user provides topic/type details.*
2.  **Create `run_basic_agent.py` (Phase 1):**
    *   Set up the agent and basic input loop for testing Phase 1 tools.
3.  **Refine `drone_agent_tools.py` for Telemetry (Phase 1 - requires user input):**
    *   Add telemetry subscription logic to `DroneROS2Commander`.
    *   Add the `get_drone_telemetry` tool.
4.  **Define `DetectionEvent.msg` (Phase 2 - can be done anytime):**
    *   Create the `.msg` file in `drone_interfaces/msg/`.
5.  **Create `mission_manager.py` (Phase 2):**
    *   Implement the `AutonomousMissionManager` class structure.
    *   Start with basic mission execution (e.g., following a predefined list of waypoints by prompting the `DroneControllerAgent`).
    *   Add the `DetectionEvent` subscriber and the `_handle_detection_event` logic.
