# Rosbridge Client Module

Professional ROS WebSocket client implementation for DroneOS web interface.

## Overview

This module provides a clean, modular TypeScript interface for communicating with ROS via [rosbridge_suite](https://github.com/RobotWebTools/rosbridge_suite). It uses [roslibjs](https://github.com/RobotWebTools/roslibjs) internally for WebSocket communication.

## Architecture

The module is split into three specialized managers coordinated by a facade:

```
rosbridgeClient (facade)
├── RosbridgeClient (core)  → WebSocket connection management
├── TopicManager            → ROS topic subscriptions
└── ServiceManager          → ROS service calls
```

### Design Benefits

- **Separation of Concerns**: Each manager has a single responsibility
- **Testability**: Managers can be tested independently
- **Maintainability**: Changes to services don't affect topics
- **Simplified API**: Facade hides complexity from React components

## Modules

### `types.ts`
Type definitions for drone state, connection options, and callbacks.

**Key Types:**
- `DroneState` - Complete drone telemetry data
- `ConnectionOptions` - Configuration for rosbridge connection
- `ServiceResponse` - Standard service call response format

### `RosbridgeClient.ts` (Core)
Manages WebSocket connection lifecycle.

**Features:**
- Automatic reconnection with exponential backoff
- Connection status callbacks
- Shared ROSLIB.Ros instance for managers
- Configurable retry behavior

**Example:**
```typescript
const client = new RosbridgeClient({
  url: 'ws://localhost:9090',
  reconnectInterval: 3000,
  maxReconnectAttempts: 10
});

client.onConnectionStatusChanged((connected, error) => {
  console.log('Connected:', connected);
});

client.connect();
```

### `TopicManager.ts`
Handles ROS topic subscriptions.

**Features:**
- Subscribe to drone state topics
- Throttled updates (10Hz)
- Automatic message parsing
- Bulk unsubscribe operations

**Example:**
```typescript
const topics = new TopicManager(client);

const subId = topics.subscribeToDroneState('drone1', (state) => {
  console.log(`Battery: ${state.battery_remaining * 100}%`);
  console.log(`Altitude: ${-state.local_z}m`);
});

// Later...
topics.unsubscribeFromDroneState(subId);
```

### `ServiceManager.ts`
Handles ROS service calls for drone control.

**Services:**
- `callGetStateService()` - Query drone state
- `callArmService()` - Arm motors ⚠️
- `callDisarmService()` - Disarm motors
- `callSetOffboardService()` - Enable offboard mode

**Example:**
```typescript
const services = new ServiceManager(client);

try {
  const result = await services.callArmService('drone1');
  if (result.success) {
    console.log('Armed successfully');
  }
} catch (error) {
  console.error('Arm failed:', error);
}
```

## Facade Usage

Most code should use the facade in `../rosbridgeClient.ts`:

```typescript
import { rosbridgeClient } from '../services/rosbridgeClient';

// Connect
rosbridgeClient.connect();

// Subscribe to telemetry
const subId = rosbridgeClient.subscribeToDroneState('drone1', (state) => {
  console.log('Position:', state.local_x, state.local_y, state.local_z);
});

// Call service
const result = await rosbridgeClient.callArmService('drone1');
console.log(result.message);

// Clean up
rosbridgeClient.disconnect();
```

## React Integration

### Connection Hook
```typescript
import { useRosbridgeConnection } from '../hooks/useRosbridgeConnection';

function MyComponent() {
  const { isConnected } = useRosbridgeConnection();

  return <div>Status: {isConnected ? 'Connected' : 'Disconnected'}</div>;
}
```

### Telemetry Hook
```typescript
import { useDroneState } from '../hooks/useDroneState';

function DroneInfo() {
  const { droneStatus } = useDroneState(isConnected);

  return <div>Battery: {droneStatus.battery}%</div>;
}
```

## Configuration

WebSocket URL is configured in `../config/rosbridge.ts`:

```typescript
export const ROSBRIDGE_URL = 'ws://localhost:9090';
```

## ROS Topics & Services

### Topics
- `/{namespace}/drone_state` - `drone_interfaces/msg/DroneState`
  - 10Hz throttled updates
  - Complete drone telemetry

### Services
- `/{namespace}/get_state` - `drone_interfaces/srv/GetState`
- `/{namespace}/arm` - `std_srvs/srv/Trigger`
- `/{namespace}/disarm` - `std_srvs/srv/Trigger`
- `/{namespace}/set_offboard` - `std_srvs/srv/Trigger`

## Error Handling

All service calls return `Promise<ServiceResponse>`:

```typescript
interface ServiceResponse {
  success: boolean;
  message: string;
}
```

Handle errors with try/catch:

```typescript
try {
  const result = await rosbridgeClient.callArmService('drone1');
  if (!result.success) {
    console.error('Service rejected:', result.message);
  }
} catch (error) {
  console.error('Service call failed:', error);
}
```

## Safety Notes

⚠️ **Arming**: Always ensure:
- Propellers clear of obstructions
- Safe takeoff location
- Pre-flight checks complete

⚠️ **Offboard Mode**: Requires:
- Armed motors
- Valid position estimate
- Active setpoint stream

## Testing

Each manager can be tested independently:

```typescript
import { RosbridgeClient } from './RosbridgeClient';

describe('RosbridgeClient', () => {
  it('should connect successfully', () => {
    const client = new RosbridgeClient();
    client.connect();
    expect(client.getConnectionStatus()).toBe(true);
  });
});
```

## Contributing

When adding new functionality:

1. Add service methods to `ServiceManager`
2. Add topic subscriptions to `TopicManager`
3. Add types to `types.ts`
4. Expose via facade in `../rosbridgeClient.ts`
5. Document with JSDoc comments
6. Add usage examples

## Dependencies

- `roslib` (^1.4.1) - ROS JavaScript library
- `@types/roslib` (^1.3.5) - TypeScript definitions

## See Also

- [rosbridge_suite](https://github.com/RobotWebTools/rosbridge_suite)
- [roslibjs](https://github.com/RobotWebTools/roslibjs)
- [PX4 Offboard Control](https://docs.px4.io/main/en/flight_modes/offboard.html)
