#!/usr/bin/env python3

"""
Launch file for rosbridge WebSocket server with custom configuration for drone telemetry.
This configures rosbridge for optimal real-time telemetry streaming to web interfaces.
"""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, LogInfo
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    """Generate launch description for rosbridge with drone-specific configuration."""
    
    # Declare launch arguments
    port_arg = DeclareLaunchArgument(
        'port',
        default_value='9090',
        description='WebSocket port for rosbridge server'
    )
    
    address_arg = DeclareLaunchArgument(
        'address',
        default_value='',
        description='WebSocket address for rosbridge server (empty = all interfaces)'
    )
    
    # Security: Allow only drone-related topics and services
    topics_glob_arg = DeclareLaunchArgument(
        'topics_glob',
        default_value="['/px4_*/drone_state', '/px4_*/fmu/out/*', '/rosout']",
        description='Glob patterns for allowed topics'
    )
    
    services_glob_arg = DeclareLaunchArgument(
        'services_glob', 
        default_value="['/px4_*/get_state', '/rosapi/*']",
        description='Glob patterns for allowed services'
    )
    
    # Create rosbridge websocket node
    rosbridge_websocket = Node(
        package='rosbridge_server',
        executable='rosbridge_websocket',
        name='rosbridge_websocket',
        parameters=[
            {'port': LaunchConfiguration('port')},
            {'address': LaunchConfiguration('address')},
            {'topics_glob': LaunchConfiguration('topics_glob')},
            {'services_glob': LaunchConfiguration('services_glob')},
            {'use_compression': True},
            {'fragment_timeout': 600},
            {'delay_between_messages': 0},
            {'max_message_size': 10000000},
            {'unregister_timeout': 10.0},
            {'websocket_ping_interval': 10.0},
            {'websocket_ping_timeout': 30.0},
        ],
        output='screen',
        emulate_tty=True,
    )
    
    # Create rosapi node for ROS introspection services
    rosapi_node = Node(
        package='rosapi',
        executable='rosapi_node',
        name='rosapi',
        parameters=[
            {'topics_glob': LaunchConfiguration('topics_glob')},
            {'services_glob': LaunchConfiguration('services_glob')},
        ],
        output='screen',
        emulate_tty=True,
    )
    
    return LaunchDescription([
        port_arg,
        address_arg,
        topics_glob_arg,
        services_glob_arg,
        LogInfo(msg=['Starting rosbridge WebSocket server on port ', LaunchConfiguration('port')]),
        rosbridge_websocket,
        rosapi_node,
    ])