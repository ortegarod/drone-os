import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DroneStatus } from '../App';

// Fix for default markers in webpack
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface DroneMapProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  availableDrones: string[];
}

interface DronePosition {
  lat: number;
  lng: number;
  alt: number;
  valid: boolean;
}

const DroneMap: React.FC<DroneMapProps> = ({ droneAPI, droneStatus, availableDrones }) => {
  console.log('DroneMap: Component created/rendered');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const [dronePositions, setDronePositions] = useState<Map<string, DronePosition>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Initialize map
  useEffect(() => {
    console.log('DroneMap: Initializing map...');
    if (!mapRef.current) {
      console.error('DroneMap: mapRef.current is null');
      return;
    }
    if (mapInstanceRef.current) {
      console.log('DroneMap: Map already initialized');
      return;
    }

    try {
      console.log('DroneMap: Creating Leaflet map...');
      // Create map centered on a default location (San Francisco)
      const map = L.map(mapRef.current).setView([37.7749, -122.4194], 13);
      console.log('DroneMap: Map created successfully');

      // Add OpenStreetMap tile layer
      console.log('DroneMap: Adding tile layer...');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);
      console.log('DroneMap: Tile layer added');

      // Handle map clicks for move commands
      map.on('click', (e) => {
        console.log('DroneMap: Map clicked at', e.latlng);
        handleMapClick(e.latlng);
      });

      mapInstanceRef.current = map;
      console.log('DroneMap: Map initialization complete');
    } catch (error) {
      console.error('DroneMap: Failed to initialize map:', error);
    }

    return () => {
      console.log('DroneMap: Cleaning up map...');
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Fetch drone positions
  const fetchDronePositions = async () => {
    console.log('DroneMap: Fetching drone positions...');
    if (!droneAPI.ros) {
      console.warn('DroneMap: No ROS connection, skipping position fetch');
      return;
    }

    console.log('DroneMap: Available drones:', availableDrones);
    const newPositions = new Map<string, DronePosition>();

    for (const droneName of availableDrones) {
      try {
        // Temporarily switch to this drone to get its state
        const originalTarget = droneStatus.drone_name;
        await droneAPI.setTargetDrone(droneName);
        
        const state = await droneAPI.getState();
        
        if (state.success && state.state) {
          const hasValidCoords = 
            typeof state.state.latitude === 'number' && 
            typeof state.state.longitude === 'number' &&
            Math.abs(state.state.latitude) <= 90 && 
            Math.abs(state.state.longitude) <= 180 &&
            !(state.state.latitude === 0 && state.state.longitude === 0);

          if (hasValidCoords) {
            newPositions.set(droneName, {
              lat: state.state.latitude,
              lng: state.state.longitude,
              alt: state.state.altitude || 0,
              valid: true
            });
          }
        }
        
        // Switch back to original target
        if (originalTarget !== droneName) {
          await droneAPI.setTargetDrone(originalTarget);
        }
      } catch (error) {
        console.warn(`Failed to get position for ${droneName}:`, error);
      }
    }

    setDronePositions(newPositions);
  };

  // Update drone markers on map
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const map = mapInstanceRef.current;

    // Clear existing markers
    droneMarkersRef.current.forEach(marker => {
      map.removeLayer(marker);
    });
    droneMarkersRef.current.clear();

    // Add markers for each drone
    dronePositions.forEach((position, droneName) => {
      if (position.valid) {
        // Create custom icon for drone
        const isCurrentTarget = droneName === droneStatus.drone_name;
        const icon = L.divIcon({
          html: `<div style="
            background: ${isCurrentTarget ? '#ff4444' : '#0088ff'};
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            color: white;
            font-weight: bold;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          ">${droneName.replace('drone', '')}</div>`,
          className: 'custom-drone-marker',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        const marker = L.marker([position.lat, position.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div>
              <strong>${droneName}</strong><br/>
              Lat: ${position.lat.toFixed(6)}<br/>
              Lng: ${position.lng.toFixed(6)}<br/>
              Alt: ${position.alt.toFixed(1)}m<br/>
              ${isCurrentTarget ? '<em>Current Target</em>' : ''}
            </div>
          `);

        droneMarkersRef.current.set(droneName, marker);
      }
    });

    // Center map on current target drone if available
    const currentDronePos = dronePositions.get(droneStatus.drone_name);
    if (currentDronePos && currentDronePos.valid) {
      map.setView([currentDronePos.lat, currentDronePos.lng], Math.max(map.getZoom(), 15));
    }
  }, [dronePositions, droneStatus.drone_name]);

  // GPS to local coordinate conversion
  const gpsToLocal = (targetLat: number, targetLng: number, currentLat: number, currentLng: number) => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (targetLat - currentLat) * (Math.PI / 180);
    const dLng = (targetLng - currentLng) * (Math.PI / 180);
    
    const deltaX = R * dLat; // North
    const deltaY = R * dLng * Math.cos(currentLat * (Math.PI / 180)); // East
    
    return { x: deltaX, y: deltaY };
  };

  // Handle map clicks for navigation
  const handleMapClick = async (latlng: L.LatLng) => {
    const currentDronePos = dronePositions.get(droneStatus.drone_name);
    
    if (!currentDronePos || !currentDronePos.valid) {
      setMessage('Cannot move: Current drone position unknown');
      return;
    }

    setIsLoading(true);
    setMessage(`Moving ${droneStatus.drone_name} to clicked location...`);

    try {
      const state = await droneAPI.getState();
      if (!state.success || !state.state) {
        setMessage('Cannot move: Failed to get current drone state');
        return;
      }

      const localOffset = gpsToLocal(latlng.lat, latlng.lng, currentDronePos.lat, currentDronePos.lng);
      
      const targetX = state.state.local_x + localOffset.x;
      const targetY = state.state.local_y + localOffset.y;
      const targetZ = -10; // 10 meters altitude
      const targetYaw = state.state.local_yaw;

      console.log('DroneMap: Moving to local coordinates:', { x: targetX, y: targetY, z: targetZ, yaw: targetYaw });

      const result = await droneAPI.setPosition(targetX, targetY, targetZ, targetYaw);
      
      if (result.success) {
        setMessage(`✓ Move command sent to ${droneStatus.drone_name}`);
        setTimeout(() => setMessage(''), 2000);
      } else {
        setMessage(`✗ Move failed: ${result.message}`);
        setTimeout(() => setMessage(''), 3000);
      }
    } catch (error) {
      setMessage(`Failed to move drone: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh drone positions periodically
  useEffect(() => {
    if (availableDrones.length > 0 && droneAPI.ros) {
      fetchDronePositions();
      const interval = setInterval(fetchDronePositions, 3000); // Every 3 seconds
      return () => clearInterval(interval);
    }
  }, [availableDrones.length, droneAPI.ros]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '1rem', 
        borderBottom: '1px solid #444',
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h2>Drone Map</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.875rem', color: '#888' }}>
            Tracking {dronePositions.size} drone(s)
          </span>
          <button 
            className="btn secondary"
            onClick={fetchDronePositions}
            disabled={isLoading}
            style={{ padding: '0.5rem 1rem' }}
          >
            Refresh
          </button>
        </div>
      </div>
      
      <div style={{ flex: 1, position: 'relative' }}>
        <div 
          ref={mapRef} 
          style={{ 
            height: '100%', 
            width: '100%' 
          }} 
        />
        
        {isLoading && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            fontSize: '0.875rem'
          }}>
            Processing...
          </div>
        )}
      </div>

      {message && (
        <div style={{
          padding: '0.75rem',
          backgroundColor: message.includes('Failed') ? '#442222' : '#224422',
          color: message.includes('Failed') ? '#ff8888' : '#88ff88',
          fontSize: '0.875rem',
          borderTop: '1px solid #444'
        }}>
          {message}
        </div>
      )}

      <div style={{
        padding: '0.5rem 1rem',
        backgroundColor: '#2d2d2d',
        fontSize: '0.75rem',
        color: '#888',
        borderTop: '1px solid #444'
      }}>
        Click on map to move {droneStatus.drone_name} • Red marker = current target • Blue markers = other drones • {dronePositions.size} drone(s) visible
      </div>
    </div>
  );
};

export default DroneMap;