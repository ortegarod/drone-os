import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// @ts-ignore
import ROSLIB from 'roslib';
import { DroneStatus } from '../types/drone';

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
  yaw: number;
  valid: boolean;
  droneName: string;
}

const DroneMap: React.FC<DroneMapProps> = ({ droneAPI, droneStatus, availableDrones }) => {
  console.log('DroneMap: Component created/rendered');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const [dronePositions, setDronePositions] = useState<Map<string, DronePosition>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [targetAltitude, setTargetAltitude] = useState(15); // Default 15m altitude
  const [targetPin, setTargetPin] = useState<L.Marker | null>(null);
  const [userInteracted, setUserInteracted] = useState(false);
  const topicSubscriptionsRef = useRef<Map<string, any>>(new Map());

  // Get drone's GPS position for map centering
  const getDroneGPSPosition = async () => {
    if (!droneAPI.ros) {
      return null;
    }

    try {
      const state = await droneAPI.getState();
      
      if (state.success && state.state && state.state.global_position_valid) {
        const lat = state.state.latitude;
        const lng = state.state.longitude;
        return [lat, lng] as [number, number];
      } else {
        return null;
      }
    } catch (error) {
      console.error('DroneMap: Failed to get drone position:', error);
      return null;
    }
  };

  // Initialize map
  useEffect(() => {
    console.log('DroneMap: Initializing map...');
    if (!mapRef.current) {
      console.error('DroneMap: mapRef.current is null');
      return;
    }
    if (mapInstanceRef.current) {
      console.log('DroneMap: Map already initialized, skipping');
      return;
    }
    
    const container = mapRef.current;
    
    // Clear any existing Leaflet state on the container
    if ('_leaflet_id' in container) {
      delete (container as any)._leaflet_id;
    }

    const initializeMap = async () => {
      try {
        console.log('DroneMap: Creating Leaflet map...');
        // Try to get drone's actual position first
        const dronePos = await getDroneGPSPosition();
        const center = dronePos || [37.7749, -122.4194]; // Default to SF
        
        // Create map centered on drone or default location
        const map = L.map(mapRef.current!).setView(center, 15);
        
        // Set crosshair cursor for the map
        map.getContainer().style.cursor = 'crosshair';
        console.log('DroneMap: Map created successfully');

        // Add OpenStreetMap tile layer
        console.log('DroneMap: Adding tile layer...');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        console.log('DroneMap: Tile layer added');

        // Store map click handler
        const clickHandler = (e: L.LeafletMouseEvent) => {
          console.log('DroneMap: Map clicked at', e.latlng);
          if (e.latlng) {
            handleMapClick(e.latlng);
          }
        };
        
        // Track user interaction to prevent auto-centering
        const userInteractionHandler = () => {
          setUserInteracted(true);
          // Reset after 15 seconds of no interaction (longer for main map)
          setTimeout(() => setUserInteracted(false), 15000);
        };
        
        map.on('click', clickHandler);
        map.on('drag', userInteractionHandler);
        map.on('zoom', userInteractionHandler);
        map.on('mousedown', userInteractionHandler);

        mapInstanceRef.current = map;
        console.log('DroneMap: Map initialization complete');
      } catch (error) {
        console.error('DroneMap: Failed to initialize map:', error);
      }
    };

    initializeMap();

    return () => {
      console.log('DroneMap: Cleaning up map...');
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Subscribe to real-time drone state topics via rosbridge
  useEffect(() => {
    if (!droneAPI.ros) return;

    console.log('DroneMap: Setting up real-time subscriptions for drones:', availableDrones);

    // Clean up existing subscriptions
    topicSubscriptionsRef.current.forEach((topic, droneName) => {
      console.log(`DroneMap: Unsubscribing from ${droneName}`);
      topic.unsubscribe();
    });
    topicSubscriptionsRef.current.clear();

    // Subscribe to each drone's state topic
    availableDrones.forEach(droneName => {
      const namespace = droneName === 'drone1' ? 'px4_1' : `px4_${droneName.replace('drone', '')}`;
      const topicName = `/${namespace}/drone_state`;
      
      console.log(`DroneMap: Subscribing to ${topicName} for ${droneName}`);
      
      const topic = new ROSLIB.Topic({
        ros: droneAPI.ros,
        name: topicName,
        messageType: 'drone_interfaces/DroneState',
        throttle_rate: 100, // Max 10Hz updates
        queue_length: 1     // Only keep latest message
      });

      topic.subscribe((message: any) => {
        console.log(`DroneMap: Real-time update for ${droneName}:`, message);
        console.log(`DroneMap: GPS fields - lat: ${message.latitude}, lng: ${message.longitude}, alt: ${message.altitude}, global_valid: ${message.global_position_valid}`);
        
        // Check if we have reasonable GPS coordinates
        const hasReasonableCoords = message.latitude !== 0 && message.longitude !== 0 &&
                                  Math.abs(message.latitude) <= 90 && Math.abs(message.longitude) <= 180;
        
        console.log(`DroneMap: GPS check - hasReasonableCoords: ${hasReasonableCoords}, global_valid: ${message.global_position_valid}`);
        
        if (message.global_position_valid || hasReasonableCoords) {
          setDronePositions(prev => {
            const updated = new Map(prev);
            updated.set(droneName, {
              lat: message.latitude,
              lng: message.longitude,
              alt: message.altitude,
              yaw: message.compass_heading || 0,
              valid: true,
              droneName: droneName
            });
            return updated;
          });
          console.log(`DroneMap: Real-time position update for ${droneName}: lat=${message.latitude}, lng=${message.longitude}, yaw=${message.local_yaw}`);
        } else {
          console.log(`DroneMap: Skipping invalid GPS data for ${droneName}`);
        }
      });

      topicSubscriptionsRef.current.set(droneName, topic);
    });

    // Cleanup function
    return () => {
      topicSubscriptionsRef.current.forEach((topic) => {
        topic.unsubscribe();
      });
      topicSubscriptionsRef.current.clear();
    };
  }, [droneAPI.ros, availableDrones]);

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
        // Create triangular drone icon pointing in yaw direction
        const isCurrentTarget = droneName === droneStatus.drone_name;
        const size = 24;
        const fontSize = '10px';
        // Triangle with border-bottom points UP (North) by default
        // Compass: 0°=North, 90°=East, 180°=South, 270°=West
        // So CSS rotation should match compass heading directly
        const yawDegrees = position.yaw;
        
        const icon = L.divIcon({
          html: `<div style="
            width: ${size}px;
            height: ${size}px;
            position: relative;
            transform: rotate(${yawDegrees}deg);
          ">
            <div style="
              width: 0;
              height: 0;
              border-left: ${size/2}px solid transparent;
              border-right: ${size/2}px solid transparent;
              border-bottom: ${size}px solid ${isCurrentTarget ? '#FF0000' : '#0088FF'};
              position: absolute;
              top: 0;
              left: 0;
              filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
            "></div>
            <div style="
              width: 0;
              height: 0;
              border-left: ${size/2 - 2}px solid transparent;
              border-right: ${size/2 - 2}px solid transparent;
              border-bottom: ${size - 4}px solid ${isCurrentTarget ? '#FFFF00' : '#FFFFFF'};
              position: absolute;
              top: 2px;
              left: 2px;
            "></div>
            <div style="
              position: absolute;
              top: ${size - 14}px;
              left: 50%;
              transform: translateX(-50%) rotate(${-yawDegrees}deg);
              font-size: ${fontSize};
              color: #000000;
              font-weight: bold;
              font-family: monospace;
              text-shadow: 0 1px 2px rgba(255,255,255,0.8);
              pointer-events: none;
            ">
              ${droneName.replace('drone', '')}
            </div>
            ${isCurrentTarget ? `
            <div style="
              position: absolute;
              top: -3px;
              right: -3px;
              width: 8px;
              height: 8px;
              background: #FFFF00;
              border-radius: 50%;
              border: 1px solid #FF0000;
              animation: pulse 1.5s infinite;
              transform: rotate(${-yawDegrees}deg);
            "></div>
            ` : ''}
          </div>
          <style>
            @keyframes pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.6; transform: scale(1.2); }
            }
          </style>`,
          className: 'tactical-drone-triangle-large',
          iconSize: [size, size],
          iconAnchor: [size/2, size/2]
        });

        const marker = L.marker([position.lat, position.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div>
              <strong>${droneName}</strong><br/>
              Lat: ${position.lat.toFixed(6)}<br/>
              Lng: ${position.lng.toFixed(6)}<br/>
              Alt: ${position.alt.toFixed(1)}m<br/>
              Heading: ${position.yaw.toFixed(1)}°<br/>
              ${isCurrentTarget ? '<em>Current Target</em>' : ''}
            </div>
          `);

        droneMarkersRef.current.set(droneName, marker);
      }
    });

    // Center map on current target drone if available and user hasn't interacted recently
    const currentDronePos = dronePositions.get(droneStatus.drone_name);
    if (currentDronePos && currentDronePos.valid && !userInteracted) {
      const currentCenter = map.getCenter();
      const distance = currentCenter.distanceTo([currentDronePos.lat, currentDronePos.lng]);
      
      // Only recenter if drone moved more than 1000 meters (1km threshold for main map)
      if (distance > 1000) {
        // Preserve current zoom level, but ensure minimum zoom for visibility
        const currentZoom = map.getZoom();
        map.setView([currentDronePos.lat, currentDronePos.lng], Math.max(currentZoom, 15));
      }
    }
  }, [dronePositions, droneStatus.drone_name, userInteracted]);

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
  const handleMapClick = React.useCallback(async (latlng: L.LatLng) => {
    const currentDronePos = dronePositions.get(droneStatus.drone_name);
    
    if (!currentDronePos || !currentDronePos.valid) {
      setMessage('Cannot move: Current drone position unknown');
      return;
    }

    // Remove previous target pin if exists
    if (targetPin && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(targetPin);
    }

    // Create and add new target pin
    if (mapInstanceRef.current) {
      const pinIcon = L.divIcon({
        html: `<div style="
          width: 16px;
          height: 16px;
          background: #FF4444;
          border: 2px solid #FFFFFF;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          position: relative;
        ">
          <div style="
            position: absolute;
            top: -8px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 12px solid #FF4444;
            filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3));
          "></div>
        </div>`,
        className: 'target-pin',
        iconSize: [16, 16],
        iconAnchor: [8, 16]
      });
      
      const pin = L.marker([latlng.lat, latlng.lng], { icon: pinIcon })
        .addTo(mapInstanceRef.current);
      
      setTargetPin(pin);
    }

    setIsLoading(true);
    setMessage(`Moving ${droneStatus.drone_name || 'drone'} to clicked location...`);

    try {
      const state = await droneAPI.getState();
      if (!state.success || !state.state) {
        setMessage('Cannot move: Failed to get current drone state');
        return;
      }

      const localOffset = gpsToLocal(latlng.lat, latlng.lng, currentDronePos.lat, currentDronePos.lng);
      
      const targetX = state.state.local_x + localOffset.x;
      const targetY = state.state.local_y + localOffset.y;
      const targetZ = -targetAltitude; // Use selected altitude (negative for NED up)
      const targetYaw = state.state.local_yaw;

      console.log('DroneMap: Moving to local coordinates:', { x: targetX, y: targetY, z: targetZ, yaw: targetYaw });

      const result = await droneAPI.setPositionAutoYaw(targetX, targetY, targetZ);
      
      if (result.success) {
        setMessage(`✓ Move command sent to ${droneStatus.drone_name || 'drone'}`);
        setTimeout(() => {
          setMessage('');
          // Remove target pin after successful move
          if (targetPin && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(targetPin);
            setTargetPin(null);
          }
        }, 3000);
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
  }, [dronePositions, droneStatus.drone_name, droneAPI]);

  // Update click handler when dependencies change
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    const map = mapInstanceRef.current;
    
    // Remove existing click handlers
    map.off('click');
    
    // Add updated click handler
    const clickHandler = (e: L.LeafletMouseEvent) => {
      console.log('DroneMap: Map clicked at', e.latlng);
      if (e.latlng) {
        handleMapClick(e.latlng);
      }
    };
    
    map.on('click', clickHandler);
  }, [handleMapClick]);


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
          {/* Altitude Control */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'rgba(15, 25, 35, 0.95)',
            color: '#e1e8ed',
            padding: '6px 12px',
            borderRadius: '2px',
            fontSize: '12px',
            fontFamily: '"Segoe UI", "Roboto", sans-serif',
            fontWeight: '500',
            border: '1px solid #4a90a4'
          }}>
            <span style={{ color: '#a8b8c8' }}>Click Altitude:</span>
            <input
              type="number"
              value={targetAltitude}
              onChange={(e) => setTargetAltitude(Math.max(1, parseInt(e.target.value) || 15))}
              style={{
                width: '60px',
                backgroundColor: 'rgba(10, 20, 30, 0.8)',
                color: '#e1e8ed',
                border: '1px solid #4a90a4',
                borderRadius: '2px',
                fontSize: '12px',
                fontFamily: '"Segoe UI", "Roboto", sans-serif',
                padding: '4px 6px',
                textAlign: 'center'
              }}
              min="1"
              max="100"
            />
            <span style={{ color: '#a8b8c8' }}>meters</span>
          </div>
          <span style={{ fontSize: '0.875rem', color: '#888' }}>
            Real-time tracking: {dronePositions.size} drone(s)
          </span>
          <span style={{ fontSize: '0.75rem', color: '#666' }}>
            Real-time via rosbridge • {dronePositions.has(droneStatus.drone_name) ? 'GPS live' : 'No GPS'}
          </span>
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
        Click on map to drop a waypoint pin and move {droneStatus.drone_name || 'selected drone'} • Red marker = current target • Blue markers = other drones • Real-time position updates at 10Hz
      </div>
    </div>
  );
};

export default DroneMap;