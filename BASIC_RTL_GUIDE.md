# 🏠 Basic RTL Failsafe Guide

## What You Get
- **Signal Loss → Automatic Return Home**
- **No coding required** - uses PX4's built-in RTL
- **Simple configuration** - just set a few parameters

## Quick Setup (QGroundControl)

### 1. **Set Home Position**
```
1. Arm drone at desired home location
2. PX4 automatically sets home position
3. Or use QGC: Vehicle Setup → Safety → "Set Home to current location"
```

### 2. **Configure RTL Parameters**
In QGroundControl → Parameters:

```
COM_RCL_EXCEPT = 0        # No exceptions for RC loss
NAV_RCL_ACT = 2           # Return mode on RC loss
NAV_DLL_ACT = 2           # Return mode on data link loss
RTL_RETURN_ALT = 30       # Return altitude (30m)  
RTL_DESCEND_ALT = 10      # Descend altitude (10m)
RTL_LAND_DELAY = 5        # Hover time before landing (5s)
```

### 3. **Test It**
```
1. Takeoff normally
2. Turn off RC transmitter OR disconnect GCS
3. Watch drone automatically return home
```

## Command Line Setup (Alternative)

### Using PX4 Console:
```bash
# In PX4 console:
param set COM_RCL_EXCEPT 0
param set NAV_RCL_ACT 2  
param set NAV_DLL_ACT 2
param set RTL_RETURN_ALT 30
param set RTL_DESCEND_ALT 10
param set RTL_LAND_DELAY 5
param save
```

### Using MAVLink Commands:
```bash
# Set home position
mavlink set_home_position

# Configure RTL behavior  
mavlink set_parameter COM_RCL_EXCEPT 0
mavlink set_parameter NAV_RCL_ACT 2
```

## How It Works

### **Signal Loss Detection:**
- **RC Loss**: No signal from remote control for 1 second
- **GCS Loss**: No connection to ground control for 5 seconds  
- **Manual**: RTL switch on RC or GCS command

### **RTL Behavior:**
```
1. 🚁 Climb to RTL_RETURN_ALT (30m)
2. 🏠 Fly straight to home position
3. 📍 Descend to RTL_DESCEND_ALT (10m)  
4. ⏰ Hover for RTL_LAND_DELAY (5s)
5. 🛬 Land at home position
```

## Testing RTL

### **Safe Testing:**
```bash
# 1. Takeoff in safe area
ros2 service call /drone1/arm std_srvs/srv/Trigger
ros2 service call /drone1/takeoff std_srvs/srv/Trigger

# 2. Manually trigger RTL
ros2 service call /drone1/rtl std_srvs/srv/Trigger

# 3. Watch it return home automatically
```

### **Signal Loss Test:**
```bash
# With RC: Turn off transmitter
# With GCS: Disconnect from drone
# Result: Drone automatically returns home
```

## Configuration for DroneOS

### **In drone_core, add RTL service:**
```cpp
// Add to DroneController
void rtl_callback() {
    // Send RTL command to PX4
    sendVehicleCommand(VehicleCommand::VEHICLE_CMD_NAV_RETURN_TO_LAUNCH);
}
```

### **Frontend Integration:**
```javascript
// Add RTL button to UI
<button onClick={() => droneAPI.rtl()}>
  🏠 Return Home
</button>
```

## Safety Notes

### **⚠️ Important:**
- **Set home position** before first flight
- **Test RTL** in safe area first
- **Check return altitude** clears all obstacles
- **Monitor battery** - RTL uses power
- **Have manual override** ready

### **RTL Conditions:**
- ✅ **Works when**: GPS lock, battery sufficient, no geofence violation
- ❌ **Doesn't work when**: GPS failed, battery critical, major system failure

## That's It! 

**Your drone will now automatically return home when it loses signal.** No complex coding needed - just configure PX4's built-in RTL system.

### **Next Steps:**
1. Set the parameters above
2. Test RTL manually  
3. Test with actual signal loss
4. Add RTL button to your UI
5. Monitor RTL behavior in logs

**Simple, reliable, and built into PX4!** 🏠✨