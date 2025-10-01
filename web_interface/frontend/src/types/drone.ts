export interface DroneStatus {
  drone_name: string;
  connected: boolean;
  armed: boolean;
  flight_mode: string;
  position: {
    x: number;
    y: number;
    z: number;
    yaw: number;
  };
  battery: number;
  timestamp: number;
}
