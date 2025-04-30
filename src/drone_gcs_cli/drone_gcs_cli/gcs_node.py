import rclpy
from rclpy.node import Node
from rclpy.executors import SingleThreadedExecutor
from std_srvs.srv import Trigger
import time
from drone_interfaces.srv import SetPosition # Import custom service
# TODO: Import custom service/message types (e.g., from drone_interfaces) when defined

class GCSNode(Node):
    def __init__(self, default_drone_name='drone1'):
        super().__init__('gcs_cli_node')
        self.target_drone = default_drone_name
        self._gcs_clients = {} # Renamed from self.clients
        self.status_sub = None
        self.latest_status = None # Store latest received status message

        # Executor for handling service calls within the node
        self._executor = SingleThreadedExecutor()
        self._executor.add_node(self)

        self.get_logger().info(f"GCS Node initialized. Targeting drone: '{self.target_drone}'")
        self._create_clients_for_target()
        self._create_status_subscriber()

    def _create_clients_for_target(self):
        '''Create/reuse service clients for the current target drone.'''
        self.get_logger().info(f"Creating service clients for '{self.target_drone}'...")
        
        # Define services to create (using Trigger for now)
        trigger_services = ['takeoff', 'land', 'disarm', 'arm', 'set_offboard', 'set_position_mode'] # Added mode setters
        
        for srv_name in trigger_services:
            full_service_name = f'/{self.target_drone}/{srv_name}'
            self._gcs_clients[srv_name] = self.create_client(Trigger, full_service_name)
            self.get_logger().debug(f"  - Client created for {full_service_name}")
            
        # Add client for SetPosition service
        set_position_service_name = f'/{self.target_drone}/set_position'
        self._gcs_clients['set_position'] = self.create_client(SetPosition, set_position_service_name)
        self.get_logger().debug(f"  - Client created for {set_position_service_name}")
        
        # TODO: Add client creation for custom services like SetBehavior later
        
        # Allow some time for discovery (optional, but can help in noisy networks)
        # time.sleep(0.5)

    def _create_status_subscriber(self):
        '''Create/reuse status subscriber for the current target drone.'''
        self.get_logger().info(f"Creating status subscriber for '{self.target_drone}'...")
        # TODO: Implement status subscription when message is defined
        pass # Placeholder

    def status_callback(self, msg):
        '''Callback function for drone status messages.'''
        # TODO: Implement status processing when message is defined
        self.latest_status = msg
        pass # Placeholder

    def change_target(self, new_drone_name):
        '''Change the target drone and recreate clients/subscriptions.'''
        if new_drone_name == self.target_drone:
            self.get_logger().info(f"Already targeting '{self.target_drone}'.")
            return
        
        self.get_logger().info(f"Changing target drone from '{self.target_drone}' to '{new_drone_name}'.")
        
        # Destroy existing clients and subscriber
        # Note: This simple approach assumes we don't need to maintain connections to multiple drones simultaneously.
        for srv_name, client in self._gcs_clients.items():
            self.destroy_client(client)
            self.get_logger().debug(f"Destroyed client for {srv_name}")
        self._gcs_clients = {}
        
        if self.status_sub:
            self.destroy_subscription(self.status_sub)
            self.status_sub = None
            self.get_logger().debug(f"Destroyed status subscriber for {self.target_drone}")

        # Update target and recreate
        self.target_drone = new_drone_name
        self.latest_status = None # Reset status for new target
        self._create_clients_for_target()
        self._create_status_subscriber()

    def call_service_trigger(self, service_name):
        '''Helper to call a simple Trigger service and wait for the result.'''
        
        if service_name not in self._gcs_clients:
            msg = f"Error: Client for service '{service_name}' not found. Available: {list(self._gcs_clients.keys())}"
            self.get_logger().error(msg)
            return False, msg
            
        client = self._gcs_clients[service_name]
        full_service_name = client.srv_name
        
        # Check if service is available
        if not client.wait_for_service(timeout_sec=3.0):
            msg = f"Error: Service '{full_service_name}' not available after 3 seconds."
            self.get_logger().error(msg)
            return False, msg

        # Create request and call asynchronously
        request = Trigger.Request()
        self.get_logger().info(f"Calling service '{full_service_name}'...")
        future = client.call_async(request)
        
        # Wait for the result using spin_until_future_complete
        # This will block execution in this method until the service responds or times out.
        # Note: This uses the node's internal executor setup in __init__.
        #       It's important that spin_once() is still called in the main cli.py loop
        #       to handle other callbacks like potential status updates.
        self._executor.spin_until_future_complete(future, timeout_sec=10.0) # Increased timeout for potentially slow actions

        if future.done():
            try:
                response = future.result()
                msg = f"Service '{full_service_name}' response: Success={response.success}, Message='{response.message}'"
                if response.success:
                    self.get_logger().info(msg)
                else:
                     self.get_logger().warning(msg) # Log failure as warning
                return response.success, msg
            except Exception as e:
                msg = f"Service call '{full_service_name}' failed with exception: {e}"
                self.get_logger().error(msg)
                return False, msg
        else:
            msg = f"Service call '{full_service_name}' timed out after 10 seconds."
            self.get_logger().error(msg)
            return False, msg

    # --- Service Call Methods --- 

    def call_set_position(self, x, y, z, yaw):
        '''Calls the SetPosition service for the target drone.'''
        service_name = 'set_position'
        if service_name not in self._gcs_clients:
            msg = f"Error: Client for service '{service_name}' not found. Available: {list(self._gcs_clients.keys())}"
            self.get_logger().error(msg)
            return False, msg
            
        client = self._gcs_clients[service_name]
        full_service_name = client.srv_name
        
        if not client.wait_for_service(timeout_sec=3.0):
            msg = f"Error: Service '{full_service_name}' not available after 3 seconds."
            self.get_logger().error(msg)
            return False, msg

        request = SetPosition.Request()
        request.x = float(x) # Ensure type is float
        request.y = float(y)
        request.z = float(z)
        request.yaw = float(yaw)

        self.get_logger().info(f"Calling service '{full_service_name}' with X={x}, Y={y}, Z={z}, Yaw={yaw}...")
        future = client.call_async(request)
        
        self._executor.spin_until_future_complete(future, timeout_sec=10.0) 

        if future.done():
            try:
                response = future.result()
                msg = f"Service '{full_service_name}' response: Success={response.success}, Message='{response.message}'"
                if response.success:
                    self.get_logger().info(msg)
                else:
                     self.get_logger().warning(msg)
                return response.success, msg
            except Exception as e:
                msg = f"Service call '{full_service_name}' failed with exception: {e}"
                self.get_logger().error(msg)
                return False, msg
        else:
            msg = f"Service call '{full_service_name}' timed out after 10 seconds."
            self.get_logger().error(msg)
            return False, msg

    # --- Placeholder methods for specific commands --- 
    def call_arm(self):
        return self.call_service_trigger('arm')

    def call_set_offboard(self):
        return self.call_service_trigger('set_offboard')

    def call_set_position_mode(self):
        return self.call_service_trigger('set_position_mode')

    def call_takeoff(self):
        return self.call_service_trigger('takeoff')

    def call_land(self):
        return self.call_service_trigger('land')

    def call_disarm(self):
        return self.call_service_trigger('disarm')
    
    def call_return_home(self):
        # TODO: Assuming RTL uses Trigger for now. Change if needed.
        # return self.call_service_trigger('rtl') 
        print(f"[TODO] Call Return Home on {self.target_drone}")
        return True, "TODO: RTL service call not implemented yet."
        
    def call_set_behavior(self, behavior):
         # TODO: Define custom service type SetBehavior(string behavior_name) and implement call
        print(f"[TODO] Call Set Behavior '{behavior}' on {self.target_drone}")
        return True, f"TODO: Set Behavior '{behavior}' not implemented."

    def get_formatted_status(self):
        '''Return the latest status in a printable format.'''
        # TODO: Implement status formatting when message is defined
        if self.latest_status:
            return f"[TODO] Status received (needs formatting): {self.latest_status}"
        else:
            return "Status implementation pending."
            
    def spin_once(self):
        ''' Spin the node once to process callbacks. '''
        # We manually spin the executor here instead of rclpy.spin_once
        # because spin_until_future_complete uses it.
        # Pass a very small timeout to avoid blocking if there's nothing to do.
        self._executor.spin_once(timeout_sec=0.01) 

    def destroy_node(self):
        # Clean up the executor when the node is destroyed
        self._executor.shutdown()
        super().destroy_node() 