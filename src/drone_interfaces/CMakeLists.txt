cmake_minimum_required(VERSION 3.8)
project(drone_interfaces)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(std_msgs REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/Waypoint.msg"
  "msg/DroneState.msg"
  "srv/SetPosition.srv"
  "srv/GetState.srv"
  "srv/UploadMission.srv"
  "srv/MissionControl.srv"
  "srv/GetMissionStatus.srv"
  "srv/ExecuteAIAgent.srv"
  DEPENDENCIES std_msgs
  # Add other .msg/.srv files here if needed
)

ament_package() 