import rclpy
from rclpy.node import Node
from rclpy.executors import SingleThreadedExecutor
from std_srvs.srv import Trigger
from drone_interfaces.srv import SetPosition  # Assuming this is in the drone_interfaces package
from agents import function_tool # For OpenAI Agents SDK
import time

# Global instance of DroneROS2Commander
# This is a simplification for now. In a more complex app, consider dependency injection.
# It needs to be initialized by the main application script before tools are called.
drone_commander_instance = None

class DroneROS2Commander(Node):
    # Executor is now passed in
    def __init__(self, executor, default_drone_name='drone1', node_name='drone_agent_ros_node'):
        super().__init__(node_name)
        self.target_drone = default_drone_name
        self._service_clients_map = {} # Renamed from self._clients
        self._telemetry_subs = {}
        self.current_telemetry = {} # Placeholder for telemetry data
        
        self.executor = executor # Store the externally created executor
        if self.executor is None:
            # This should ideally not happen if run_basic_agent.py creates it correctly
            self.get_logger().error("CRITICAL: Executor passed to DroneROS2Commander is None.")
            raise ValueError("Executor cannot be None")

        self.get_logger().info(f"DroneROS2Commander Node '{node_name}' initialized. Targeting drone: '{self.target_drone}'. Using provided executor.")
        self._create_clients(self.target_drone)
        # self._setup_telemetry_subscriptions(self.target_drone) # Deferred

    def _create_clients(self, drone_name):
        self.get_logger().info(f"Creating service clients for '{drone_name}'...")
        trigger_service_suffixes = ['arm', 'disarm', 'takeoff', 'land', 'set_offboard', 'set_position_mode']
        
        for srv_suffix in trigger_service_suffixes:
            service_name = f'/{drone_name}/{srv_suffix}'
            # The create_client method is from the Node base class and works with Node's internal _clients list.
            # We store the returned client in our own map.
            self._service_clients_map[srv_suffix] = self.create_client(Trigger, service_name)
            self.get_logger().debug(f"  - Client created for {service_name} and stored in map.")

        set_pos_service_name = f'/{drone_name}/set_position'
        self._service_clients_map['set_position'] = self.create_client(SetPosition, set_pos_service_name)
        self.get_logger().debug(f"  - Client created for {set_pos_service_name} and stored in map.")

    def _destroy_clients(self):
        # We need to iterate through our map to get the client objects to destroy.
        # The actual destruction is handled by the Node's destroy_client method.
        for srv_name, client in self._service_clients_map.items():
            self.destroy_client(client) # This is the Node's method
            self.get_logger().debug(f"Destroyed client for {srv_name} (from map)")
        self._service_clients_map = {} # Clear our map

    def _setup_telemetry_subscriptions(self, drone_name):
        # This method will be implemented in Phase 1 (refined)
        # It will create subscribers for telemetry topics.
        self.get_logger().info(f"Telemetry subscriptions for '{drone_name}' would be set up here (deferred).")
        pass

    def _destroy_telemetry_subscriptions(self):
        for sub_name, sub in self._telemetry_subs.items():
            self.destroy_subscription(sub)
            self.get_logger().debug(f"Destroyed telemetry subscription for {sub_name}")
        self._telemetry_subs = {}

    def change_target_drone(self, new_drone_name: str):
        if new_drone_name == self.target_drone:
            msg = f"Already targeting '{self.target_drone}'."
            self.get_logger().info(msg)
            return True, msg
        
        self.get_logger().info(f"Changing target drone from '{self.target_drone}' to '{new_drone_name}'.")
        
        self._destroy_clients()
        self._destroy_telemetry_subscriptions() # Also destroy old telemetry subs

        self.target_drone = new_drone_name
        self._create_clients(self.target_drone)
        # self._setup_telemetry_subscriptions(self.target_drone) # Deferred
        msg = f"Target drone changed to '{self.target_drone}'. Service clients recreated."
        self.get_logger().info(msg)
        return True, msg

    def _call_trigger_service(self, service_name_suffix: str):
        if service_name_suffix not in self._service_clients_map: # Use renamed map
            msg = f"Error: Client for service suffix '{service_name_suffix}' not found for drone '{self.target_drone}'."
            self.get_logger().error(msg)
            return False, msg
            
        client = self._service_clients_map[service_name_suffix] # Use renamed map
        
        if not client.wait_for_service(timeout_sec=3.0):
            msg = f"Error: Service '{client.srv_name}' not available after 3 seconds."
            self.get_logger().error(msg)
            return False, msg

        request = Trigger.Request()
        self.get_logger().info(f"Calling service '{client.srv_name}'...")
        future = client.call_async(request)
        
        # Spin the executor until the future is complete
        # This blocks here but allows other ROS events if the executor is spun elsewhere too.
        # For a simple CLI/Agent tool, this blocking call is often acceptable.
        self.executor.spin_until_future_complete(future, timeout_sec=10.0)

        if future.done():
            try:
                response = future.result()
                msg = f"Service '{client.srv_name}' response: Success={response.success}, Message='{response.message}'"
                if response.success:
                    self.get_logger().info(msg)
                else:
                    self.get_logger().warning(msg)
                return response.success, response.message
            except Exception as e:
                msg = f"Service call '{client.srv_name}' failed with exception: {e}"
                self.get_logger().error(msg)
                return False, msg
        else:
            msg = f"Service call '{client.srv_name}' timed out after 10 seconds."
            self.get_logger().error(msg)
            return False, msg

    def _call_set_position_service(self, x: float, y: float, z: float, yaw: float):
        service_name_suffix = 'set_position'
        if service_name_suffix not in self._service_clients_map: # Use renamed map
            msg = f"Error: Client for service suffix '{service_name_suffix}' not found for drone '{self.target_drone}'."
            self.get_logger().error(msg)
            return False, msg
            
        client = self._service_clients_map[service_name_suffix] # Use renamed map
        
        if not client.wait_for_service(timeout_sec=3.0):
            msg = f"Error: Service '{client.srv_name}' not available after 3 seconds."
            self.get_logger().error(msg)
            return False, msg

        request = SetPosition.Request()
        request.x = float(x)
        request.y = float(y)
        request.z = float(z)
        request.yaw = float(yaw)

        self.get_logger().info(f"Calling service '{client.srv_name}' with X={x}, Y={y}, Z={z}, Yaw={yaw}...")
        future = client.call_async(request)
        self.executor.spin_until_future_complete(future, timeout_sec=10.0) 

        if future.done():
            try:
                response = future.result()
                msg = f"Service '{client.srv_name}' response: Success={response.success}, Message='{response.message}'"
                if response.success:
                    self.get_logger().info(msg)
                else:
                    self.get_logger().warning(msg)
                return response.success, response.message
            except Exception as e:
                msg = f"Service call '{client.srv_name}' failed with exception: {e}"
                self.get_logger().error(msg)
                return False, msg
        else:
            msg = f"Service call '{client.srv_name}' timed out after 10 seconds."
            self.get_logger().error(msg)
            return False, msg
            
    def get_latest_telemetry(self) -> dict:
        # This method will be fully implemented in Phase 1 (refined)
        self.get_logger().info("Fetching latest telemetry (currently placeholder).")
        # In a real implementation, this would return self.current_telemetry
        # which is updated by ROS subscribers.
        return {"status": "Telemetry not yet implemented", "battery": 0, "position": {"x":0,"y":0,"z":0}}

    def spin_once(self):
        """
        Allows the node's executor (managed externally) to process callbacks.
        This method might be called by the external script that owns the executor.
        """
        # The external script will call executor.spin_once() directly.
        # This node's spin_once is more of a conceptual placeholder if we wanted
        # the node to trigger a spin of its *own* dedicated executor, which it no longer has.
        # For now, we can make it a no-op or log, as the main spin is external.
        # self.get_logger().debug("Node-level spin_once() called, but executor is managed externally.")
        pass # Executor is spun by the main script

    def shutdown(self):
        self.get_logger().info("Shutting down DroneROS2Commander node (executor managed externally).")
        self._destroy_clients()
        self._destroy_telemetry_subscriptions()
        # self.executor.shutdown() # Executor is managed and shut down by the main script
        if self.context.ok(): # Check if context is valid before destroying node
             self.destroy_node()

# --- Tool Functions ---
# These functions will use the global `drone_commander_instance`

def _get_commander():
    global drone_commander_instance
    if drone_commander_instance is None:
        # This is a fallback, ideally initialized by the main script
        print("Warning: DroneROS2Commander not initialized. Attempting to initialize now.")
        # rclpy.init() # Ensure rclpy is init; might be problematic if called multiple times
        # drone_commander_instance = DroneROS2Commander()
        # This automatic initialization here is risky if rclpy context is managed elsewhere.
        # For now, we'll rely on the main script to initialize it.
        raise RuntimeError("DroneROS2Commander instance is not initialized. Please initialize it in your main application script.")
    return drone_commander_instance

@function_tool
def set_active_drone(drone_name: str) -> str:
    """
    Sets the target drone for subsequent commands.
    Args:
        drone_name (str): The name of the drone to target (e.g., 'drone1').
    Returns:
        str: A message indicating the outcome of the operation.
    """
    try:
        commander = _get_commander()
        success, message = commander.change_target_drone(drone_name)
        return message
    except Exception as e:
        return f"Error in set_active_drone: {e}"

@function_tool
def drone_set_offboard_mode() -> str:
    """Commands the currently targeted drone to enter Offboard mode."""
    try:
        commander = _get_commander()
        success, message = commander._call_trigger_service('set_offboard')
        return message
    except Exception as e:
        return f"Error in drone_set_offboard_mode: {e}"

@function_tool
def drone_set_position_control_mode() -> str:
    """Commands the currently targeted drone to enter Position Control mode."""
    try:
        commander = _get_commander()
        success, message = commander._call_trigger_service('set_position_mode')
        return message
    except Exception as e:
        return f"Error in drone_set_position_control_mode: {e}"

@function_tool
def drone_arm() -> str:
    """Arms the currently targeted drone."""
    try:
        commander = _get_commander()
        success, message = commander._call_trigger_service('arm')
        return message
    except Exception as e:
        return f"Error in drone_arm: {e}"

@function_tool
def drone_takeoff() -> str:
    """Commands the currently targeted drone to takeoff. Requires Offboard mode and armed status."""
    try:
        commander = _get_commander()
        success, message = commander._call_trigger_service('takeoff')
        return message
    except Exception as e:
        return f"Error in drone_takeoff: {e}"

@function_tool
def drone_land() -> str:
    """Commands the currently targeted drone to land."""
    try:
        commander = _get_commander()
        success, message = commander._call_trigger_service('land')
        return message
    except Exception as e:
        return f"Error in drone_land: {e}"

@function_tool
def drone_disarm() -> str:
    """Disarms the currently targeted drone."""
    try:
        commander = _get_commander()
        success, message = commander._call_trigger_service('disarm')
        return message
    except Exception as e:
        return f"Error in drone_disarm: {e}"

@function_tool
def drone_set_position(x: float, y: float, z: float, yaw: float) -> str:
    """
    Sets the target position and yaw for the currently targeted drone in Offboard mode.
    Args:
        x (float): Target X position (meters, NED frame).
        y (float): Target Y position (meters, NED frame).
        z (float): Target Z position (meters, NED frame, positive down).
        yaw (float): Target yaw angle (radians).
    Returns:
        str: A message indicating the outcome of the service call.
    """
    try:
        commander = _get_commander()
        success, message = commander._call_set_position_service(x, y, z, yaw)
        return message
    except Exception as e:
        return f"Error in drone_set_position: {e}"

@function_tool
def get_drone_telemetry() -> str:
    """
    Retrieves real-time telemetry data from the currently targeted drone.
    (Placeholder: Full implementation deferred until telemetry topics/types are provided)
    Returns:
        str: A string representation of the drone's telemetry data.
    """
    try:
        commander = _get_commander()
        telemetry_data = commander.get_latest_telemetry()
        # Format the dictionary as a string for the LLM
        return f"Current telemetry: {telemetry_data}"
    except Exception as e:
        return f"Error in get_drone_telemetry: {e}"

# Example of how to initialize and use (intended for the main agent script)
if __name__ == '__main__':
    # This block is for testing this module directly, not for the agent.
    # The main agent script (e.g., run_basic_agent.py) will handle rclpy init/shutdown.
    print("Running drone_agent_tools.py directly for testing (not recommended for agent use).")
    
    rclpy.init()
    try:
        # Initialize the global commander instance for direct testing
        drone_commander_instance = DroneROS2Commander(default_drone_name='drone_sim') # Use a test drone name
        
        print("DroneROS2Commander initialized for testing.")
        print("Available tools (if this were run by the agent SDK):")
        print("- set_active_drone(drone_name: str)")
        print("- drone_set_offboard_mode()")
        print("- drone_set_position_control_mode()")
        print("- drone_arm()")
        print("- drone_takeoff()")
        print("- drone_land()")
        print("- drone_disarm()")
        print("- drone_set_position(x: float, y: float, z: float, yaw: float)")
        print("- get_drone_telemetry()")
        
        # Example direct calls (for testing this module, requires a ROS environment and services)
        # print("\nAttempting to change target (for testing):")
        # print(set_active_drone(drone_name='another_drone'))
        
        # print("\nAttempting to get telemetry (placeholder):")
        # print(get_drone_telemetry())

        # Keep alive for a bit to allow service discovery if testing against live services
        # for _ in range(5):
        #    rclpy.spin_once(drone_commander_instance, timeout_sec=0.1)
        #    time.sleep(0.1)

    except KeyboardInterrupt:
        print("Test interrupted.")
    except Exception as e:
        print(f"An error occurred during testing: {e}")
    finally:
        if drone_commander_instance:
            drone_commander_instance.shutdown()
        if rclpy.ok():
            rclpy.shutdown()
        print("Test finished and rclpy shut down.")
