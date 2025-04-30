cmake_minimum_required(VERSION 3.5)
project(drone_os)

# Default to C++14
if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 14)
endif()

# Dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(px4_msgs REQUIRED)
find_package(yaml-cpp REQUIRED)
find_package(std_srvs REQUIRED)
find_package(drone_interfaces REQUIRED)

include_directories(include)

# Core library (drone_core)
add_library(drone_core_lib
  src/drone_core/drone_controller.cpp
  src/drone_core/drone_agent.cpp
  src/drone_core/offboard_control.cpp
  src/drone_core/drone_state.cpp
  src/utils/state_enums.cpp
)
target_include_directories(drone_core_lib PUBLIC include)
ament_target_dependencies(drone_core_lib rclcpp px4_msgs yaml-cpp std_srvs drone_interfaces)

# --- New Executable: Drone Core Node (Decentralized Single Drone Runtime) ---
add_executable(drone_core
    src/main.cpp
    src/drone_core/drone_node.cpp
)
target_include_directories(drone_core PUBLIC include)
ament_target_dependencies(drone_core
    rclcpp
    std_srvs # For Trigger service
    drone_interfaces # Added dependency
    # Add dependencies for custom services/messages later if needed
)
target_link_libraries(drone_core
    drone_core_lib # Links against DroneController implementation
)



# Install targets
install(TARGETS
  drone_core_lib
  ARCHIVE DESTINATION lib
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION lib/${PROJECT_NAME}
)
install(TARGETS
  drone_core
  DESTINATION lib/${PROJECT_NAME}
)

# Install headers
install(DIRECTORY include/
  DESTINATION include
)

ament_package()
