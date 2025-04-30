import rclpy
import argparse
import sys
import time
from drone_gcs_cli.gcs_node import GCSNode

def main(args=None):
    rclpy.init(args=args)
    
    parser = argparse.ArgumentParser(description='Drone GCS Interactive Command Line Interface')
    parser.add_argument('-d', '--default-drone', default='drone1', help='Default drone name to target initially')
    # TODO: Add arguments for non-interactive mode (e.g., --command takeoff --drone drone1)

    cli_args = parser.parse_args()

    gcs_node = None
    try:
        gcs_node = GCSNode(default_drone_name=cli_args.default_drone)
        
        print("Drone GCS CLI. Type 'help' for commands, 'exit' to quit.")
        
        while True:
            # Allow ROS callbacks to be processed
            gcs_node.spin_once()
            
            prompt = f"GCS ({gcs_node.target_drone})> "
            try:
                user_input = input(prompt).strip().lower()
            except EOFError:
                # Handle Ctrl+D
                print("\nExiting.")
                break
            except KeyboardInterrupt:
                # Handle Ctrl+C
                print("\nExiting.")
                break

            if not user_input:
                continue

            parts = user_input.split()
            command = parts[0]
            cmd_args = parts[1:]

            if command == "exit":
                print("Exiting.")
                break
            elif command == "help":
                # TODO: Implement help command
                print("Available commands (TODO: Implement fully):")
                print("  set_offboard     - Command PX4 to enter Offboard mode")
                print("  set_posctl       - Command PX4 to enter Position Control mode")
                print("  arm              - Arm the drone")
                print("  takeoff          - Command the drone to takeoff (Requires Offboard+Armed)")
                print("  land             - Command the drone to land")
                print("  disarm           - Disarm the drone")
                print("  pos <x> <y> <z> <yaw> - Set target position/yaw in Offboard mode (NED frame)")
                print("  status           - Show current drone status")
                print("  target <name>    - Change the target drone")
                print("  rtl              - Command Return To Launch")
                print("  behavior <name>  - Set drone behavior (e.g., patrol)")
                print("  help             - Show this help message")
                print("  exit             - Exit the CLI")
            elif command == "set_offboard":
                success, message = gcs_node.call_set_offboard()
                print(message)
            elif command == "set_posctl":
                success, message = gcs_node.call_set_position_mode()
                print(message)
            elif command == "arm":
                success, message = gcs_node.call_arm()
                print(message)
            elif command == "takeoff":
                success, message = gcs_node.call_takeoff()
                print(message)
            elif command == "land":
                success, message = gcs_node.call_land()
                print(message)
            elif command == "disarm":
                success, message = gcs_node.call_disarm()
                print(message)
            elif command == "pos":
                if len(cmd_args) == 4:
                    try:
                        x = float(cmd_args[0])
                        y = float(cmd_args[1])
                        z = float(cmd_args[2])
                        yaw = float(cmd_args[3])
                        success, message = gcs_node.call_set_position(x, y, z, yaw)
                        print(message)
                    except ValueError:
                        print("Error: x, y, z, and yaw must be numbers.")
                    except Exception as e:
                        print(f"Error calling set_position: {e}")
                else:
                    print("Usage: pos <x> <y> <z> <yaw>")
            elif command == "status":
                status_str = gcs_node.get_formatted_status()
                print(status_str)
            elif command == "target":
                if len(cmd_args) == 1:
                    gcs_node.change_target(cmd_args[0])
                else:
                    print("Usage: target <drone_name>")
            elif command == "rtl":
                 success, message = gcs_node.call_return_home()
                 print(message)
            elif command == "behavior":
                if len(cmd_args) == 1:
                    success, message = gcs_node.call_set_behavior(cmd_args[0])
                    print(message)
                else:
                    print("Usage: behavior <behavior_name>")
            else:
                print(f"Unknown command: '{command}'. Type 'help' for options.")
            
            # Small delay to prevent busy-waiting in the input loop
            time.sleep(0.1)

    finally:
        if gcs_node:
            gcs_node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()

if __name__ == '__main__':
    main() 