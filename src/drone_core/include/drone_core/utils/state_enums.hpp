#pragma once

#include <string>
#include <cstdint> // For uint8_t in Px4CustomMode
#include <cmath>

// Navigation State Enum (mirrors relevant PX4 states)
enum class NavState {
    UNKNOWN,
    MANUAL,
    ALTCTL,
    POSCTL,
    AUTO_MISSION,
    AUTO_LOITER,
    AUTO_RTL,
    ACRO,
    OFFBOARD,
    STAB,
    AUTO_TAKEOFF,
    AUTO_LAND,
    AUTO_FOLLOW_TARGET,
    AUTO_PRECLAND,
    ORBIT,
    AUTO_VTOL_TAKEOFF,
    FREEFALL
};
std::string nav_state_enum_to_string(NavState state);

// Landing State Enum based on VehicleLandDetected flags
enum class LandingState {
    UNKNOWN,
    AIRBORNE,
    GROUND_CONTACT, // Ground contact detected, but not landed
    MAYBE_LANDED,   // Higher confidence landing detection
    LANDED,         // Confirmed landed
    FREEFALL        // Freefall detected
};
std::string landing_state_enum_to_string(LandingState state);

// Position Fix State Enum based on VehicleGlobalPosition validity flags
enum class PositionFixState {
    UNKNOWN,
    NO_FIX,
    ALT_VALID,      // Altitude valid, Lat/Lon invalid
    LAT_LON_VALID,  // Lat/Lon valid, Altitude invalid
    BOTH_VALID      // Both Lat/Lon and Altitude valid (3D Fix)
};
std::string position_fix_state_enum_to_string(PositionFixState state);

// Arming State Enum
enum class ArmingState {
    UNKNOWN,
    DISARMED,
    ARMED
};
std::string arming_state_enum_to_string(ArmingState state);

// PX4 Custom Mode IDs (param2 for VEHICLE_CMD_DO_SET_MODE with param1=1.0)
enum class Px4CustomMode : uint8_t { // Using uint8_t, will cast to float for param2
    UNKNOWN = 0, // Represents an invalid or unhandled mode
    MANUAL = 1,
    ALTCTL = 2,
    POSCTL = 3,
    AUTO = 4,     // Main Auto mode (Mission/Loiter/RTL are sub-modes handled separately)
    ACRO = 5,
    OFFBOARD = 6, // Correct main mode for Offboard
    STABILIZED = 7,
    // RATTITUDE = 8, // Optional: Can add if needed
};
std::string px4_custom_mode_to_string(Px4CustomMode mode);

// Added CommandType enum and Command struct
enum class CommandType {
    ARM,                // Added
    DISARM,             // Added
    TAKEOFF,
    LAND,
    RETURN_TO_LAUNCH,   // Added
    SET_POSITION,       // Added
    SET_VELOCITY,       // Added
    SET_LOITER_MODE,    // Added
    SET_POSITION_MODE,  // Added
    SET_ALTITUDE_MODE,  // Added
    MOVE                // Kept existing, might be unused now?
};

struct Command {
    CommandType type;
    float x{0}, y{0}, z{0}, yaw{0};

    Command(CommandType t, float x_=0, float y_=0, float z_=0, float yaw_=0)
        : type(t), x(x_), y(y_), z(z_), yaw(yaw_) {}
};

/**
 * @brief Simple structure to represent a mission waypoint.
 */
struct Waypoint {
    float x = NAN; ///< Target local X position (m, NED)
    float y = NAN; ///< Target local Y position (m, NED)
    float z = NAN; ///< Target local Z position (m, NED, positive down)
    float yaw = NAN; ///< Target yaw angle (rad)
    float acceptance_radius = NAN; ///< Radius around waypoint to consider it reached (m)

    // Basic check if waypoint has valid position data
    bool has_position() const {
        return !std::isnan(x) && !std::isnan(y) && !std::isnan(z);
    }
};

/**
 * @brief Converts PX4 navigation state enum to internal NavState enum
 * @param px4_state The PX4 navigation state value
 * @return The corresponding NavState enum
 */
NavState px4_state_to_nav_state(uint8_t px4_state); 