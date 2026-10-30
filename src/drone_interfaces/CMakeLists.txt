cmake_minimum_required(VERSION 3.8)
project(drone_interfaces)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(std_msgs REQUIRED)
find_package(builtin_interfaces REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/Waypoint.msg"
  "msg/DroneState.msg"
  "msg/ModeCompleted.msg"
  "msg/PatrolPoint.msg"
  "msg/PatrolPlan.msg"
  "msg/PatrolStatus.msg"
  "srv/SetPosition.srv"
  "srv/GetState.srv"
  "srv/UploadMission.srv"
  "srv/MissionControl.srv"
  "srv/GetMissionStatus.srv"
  "srv/ExecuteAIAgent.srv"
  "srv/Takeoff.srv"
  "srv/GotoLocation.srv"
  "srv/Orbit.srv"
  DEPENDENCIES std_msgs builtin_interfaces
  # Add other .msg/.srv files here if needed
)

ament_package() 