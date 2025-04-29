#include "drone_core/utils/state_enums.hpp"

// --- Helper function to convert NavState enum to string --- 
std::string nav_state_enum_to_string(NavState state) {
    switch (state) {
        case NavState::MANUAL: return "MANUAL";
        case NavState::ALTCTL: return "ALTCTL";
        case NavState::POSCTL: return "POSCTL";
        case NavState::AUTO_MISSION: return "AUTO_MISSION";
        case NavState::AUTO_LOITER: return "AUTO_LOITER";
        case NavState::AUTO_RTL: return "AUTO_RTL";
        case NavState::ACRO: return "ACRO";
        case NavState::OFFBOARD: return "OFFBOARD";
        case NavState::STAB: return "STAB";
        case NavState::AUTO_TAKEOFF: return "AUTO_TAKEOFF";
        case NavState::AUTO_LAND: return "AUTO_LAND";
        case NavState::AUTO_FOLLOW_TARGET: return "AUTO_FOLLOW_TARGET";
        case NavState::AUTO_PRECLAND: return "AUTO_PRECLAND";
        case NavState::ORBIT: return "ORBIT";
        case NavState::AUTO_VTOL_TAKEOFF: return "AUTO_VTOL_TAKEOFF";
        case NavState::FREEFALL: return "FREEFALL";
        case NavState::UNKNOWN: // Fall through
        default: return "UNKNOWN";
    }
}

// --- Helper function to convert LandingState enum to string ---
std::string landing_state_enum_to_string(LandingState state) {
    switch (state) {
        case LandingState::AIRBORNE: return "AIRBORNE";
        case LandingState::GROUND_CONTACT: return "GROUND_CONTACT";
        case LandingState::MAYBE_LANDED: return "MAYBE_LANDED";
        case LandingState::LANDED: return "LANDED";
        case LandingState::FREEFALL: return "FREEFALL";
        case LandingState::UNKNOWN: // Fall through
        default: return "UNKNOWN";
    }
}

// --- Helper function to convert PositionFixState enum to string ---
std::string position_fix_state_enum_to_string(PositionFixState state) {
    switch (state) {
        case PositionFixState::NO_FIX: return "NO_FIX";
        case PositionFixState::ALT_VALID: return "ALT_VALID";
        case PositionFixState::LAT_LON_VALID: return "LAT_LON_VALID";
        case PositionFixState::BOTH_VALID: return "BOTH_VALID (3D)";
        case PositionFixState::UNKNOWN: // Fall through
        default: return "UNKNOWN";
    }
}

// --- Helper function to convert ArmingState enum to string ---
std::string arming_state_enum_to_string(ArmingState state) {
    switch (state) {
        case ArmingState::DISARMED: return "DISARMED";
        case ArmingState::ARMED: return "ARMED";
        case ArmingState::UNKNOWN:
        default: return "UNKNOWN";
    }
}

// --- Helper function to convert Px4CustomMode enum to string --- 
std::string px4_custom_mode_to_string(Px4CustomMode mode) {
    switch (mode) {
        case Px4CustomMode::MANUAL: return "MANUAL";       // Value 1
        case Px4CustomMode::ALTCTL: return "ALTCTL";       // Value 2
        case Px4CustomMode::POSCTL: return "POSCTL";       // Value 3
        case Px4CustomMode::AUTO: return "AUTO";           // Value 4
        case Px4CustomMode::ACRO: return "ACRO";           // Value 5
        case Px4CustomMode::OFFBOARD: return "OFFBOARD";     // Value 6
        case Px4CustomMode::STABILIZED: return "STABILIZED"; // Value 7
        // case Px4CustomMode::RATTITUDE: return "RATTITUDE"; // Value 8 (Optional)
        case Px4CustomMode::UNKNOWN: // Value 0
        default: return "UNKNOWN";
    }
} 