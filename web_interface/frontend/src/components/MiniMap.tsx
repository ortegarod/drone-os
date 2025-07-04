import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// @ts-ignore
import ROSLIB from 'roslib';
import { DroneStatus, UnitSystem } from '../App';

// Fix for default markers in webpack
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface MiniMapProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  availableDrones: string[];
  unitSystem: UnitSystem;
}

interface DronePosition {
  lat: number;
  lng: number;
  alt: number;
  valid: boolean;
  droneName: string;
}

const MiniMap: React.FC<MiniMapProps> = ({ droneAPI, droneStatus, availableDrones, unitSystem }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const [dronePositions, setDronePositions] = useState<Map<string, DronePosition>>(new Map());
  const [message, setMessage] = useState('');
  const [mapCenter, setMapCenter] = useState<[number, number]>([37.7749, -122.4194]); // Default to SF
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
      console.error('MiniMap: Failed to get drone position:', error);
      return null;
    }
  };

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) return;
    
    const container = mapRef.current;
    
    // Only initialize if not already initialized
    if (mapInstanceRef.current) {
      console.log('MiniMap: Map already initialized, skipping');
      return;
    }
    
    // Clear any existing Leaflet state on the container
    if ('_leaflet_id' in container) {
      delete (container as any)._leaflet_id;
    }
    
    const initializeMap = async () => {
      try {
        // Try to get drone's actual position first
        const dronePos = await getDroneGPSPosition();
        const center = dronePos || mapCenter;
        
        console.log('MiniMap: Creating Leaflet map');
        const map = L.map(container, {
          zoomControl: false,
          attributionControl: false,
          dragging: true,
          scrollWheelZoom: true,
          doubleClickZoom: true,
          boxZoom: false,
          keyboard: false
        }).setView(center, 13);

        console.log('MiniMap: Map created successfully');

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Store map click handler
        const clickHandler = (e: L.LeafletMouseEvent) => {
          console.log('MiniMap: Map clicked at:', e.latlng);
          if (e.latlng) {
            handleMapClick(e.latlng);
          }
        };
        
        map.on('click', clickHandler);

        mapInstanceRef.current = map;
        setMapCenter(center);
      } catch (error) {
        console.error('MiniMap: Failed to initialize map:', error);
      }
    };

    initializeMap();

    return () => {
      console.log('MiniMap: Cleaning up map...');
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (error) {
          console.warn('MiniMap: Error during map cleanup:', error);
        }
        mapInstanceRef.current = null;
      }
      // Clear Leaflet state from container
      if ('_leaflet_id' in container) {
        delete (container as any)._leaflet_id;
      }
    };
  }, []); // Only initialize once

  // Subscribe to real-time drone state topics via rosbridge (same as DroneMap but for minimap)
  useEffect(() => {
    if (!droneAPI.ros) return;

    console.log('MiniMap: Setting up real-time subscriptions for drones:', availableDrones);

    // Clean up existing subscriptions
    topicSubscriptionsRef.current.forEach((topic, droneName) => {
      console.log(`MiniMap: Unsubscribing from ${droneName}`);
      topic.unsubscribe();
    });
    topicSubscriptionsRef.current.clear();

    // Subscribe to each drone's state topic
    availableDrones.forEach(droneName => {
      const namespace = droneName === 'drone1' ? 'px4_1' : `px4_${droneName.replace('drone', '')}`;
      const topicName = `/${namespace}/drone_state`;
      
      console.log(`MiniMap: Subscribing to ${topicName} for ${droneName}`);
      
      const topic = new ROSLIB.Topic({
        ros: droneAPI.ros,
        name: topicName,
        messageType: 'drone_interfaces/DroneState',
        throttle_rate: 200, // 5Hz updates for minimap (less frequent)
        queue_length: 1     // Only keep latest message
      });

      topic.subscribe((message: any) => {
        // Check if we have reasonable GPS coordinates
        const hasReasonableCoords = message.latitude !== 0 && message.longitude !== 0 &&
                                  Math.abs(message.latitude) <= 90 && Math.abs(message.longitude) <= 180;
        
        if (message.global_position_valid || hasReasonableCoords) {
          setDronePositions(prev => {
            const updated = new Map(prev);
            updated.set(droneName, {
              lat: message.latitude,
              lng: message.longitude,
              alt: message.altitude,
              valid: true,
              droneName: droneName
            });
            return updated;
          });
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
        // Create custom icon for drone (smaller for minimap)
        const isCurrentTarget = droneName === droneStatus.drone_name;
        const size = 12;
        const fontSize = '8px';
        
        // OSRS-style drone marker
        const icon = L.divIcon({
          html: `<div style="
            background: ${isCurrentTarget ? 'linear-gradient(145deg, #FF0000, #CC0000)' : 'linear-gradient(145deg, #0088FF, #0066CC)'};
            width: ${size}px;
            height: ${size}px;
            border-radius: 0px;
            border: 1px solid ${isCurrentTarget ? '#FFFF00' : '#FFFFFF'};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: ${fontSize};
            color: #FFFF00;
            font-weight: bold;
            font-family: monospace;
            text-shadow: 1px 1px 0 #000000;
            box-shadow: 0 0 3px rgba(0,0,0,0.8);
            image-rendering: pixelated;
          ">${droneName.replace('drone', '')}</div>`,
          className: 'osrs-drone-marker',
          iconSize: [size + 2, size + 2],
          iconAnchor: [size/2 + 1, size/2 + 1]
        });

        const marker = L.marker([position.lat, position.lng], { icon })
          .addTo(map);

        droneMarkersRef.current.set(droneName, marker);
      }
    });

    // Center map on current target drone if available
    const currentDronePos = dronePositions.get(droneStatus.drone_name);
    if (currentDronePos && currentDronePos.valid) {
      map.setView([currentDronePos.lat, currentDronePos.lng], 13);
      setMapCenter([currentDronePos.lat, currentDronePos.lng]);
    }
  }, [dronePositions, droneStatus.drone_name]);

  // Simple GPS to local coordinate conversion (approximate)
  const gpsToLocal = (targetLat: number, targetLng: number, currentLat: number, currentLng: number) => {
    // Convert degrees to radians
    const R = 6371000; // Earth's radius in meters
    const dLat = (targetLat - currentLat) * (Math.PI / 180);
    const dLng = (targetLng - currentLng) * (Math.PI / 180);
    
    // Approximate local coordinates (works for small distances)
    const deltaX = R * dLat; // North (positive = north)
    const deltaY = R * dLng * Math.cos(currentLat * (Math.PI / 180)); // East (positive = east)
    
    return { x: deltaX, y: deltaY };
  };

  // Handle map clicks for navigation - simplified like ManualControls
  const handleMapClick = React.useCallback(async (latlng: L.LatLng) => {
    console.log('MiniMap: handleMapClick called with:', latlng);

    // Get current drone position for reference
    const currentDronePos = dronePositions.get(droneStatus.drone_name);
    
    if (!currentDronePos || !currentDronePos.valid) {
      setMessage('Cannot move: Current drone position unknown');
      return;
    }

    setMessage(`Moving ${droneStatus.drone_name} to clicked location...`);

    try {
      // Get current drone state for local coordinates
      const state = await droneAPI.getState();
      if (!state.success || !state.state) {
        setMessage('Cannot move: Failed to get current drone state');
        return;
      }

      // Convert GPS coordinates to local NED coordinates
      const localOffset = gpsToLocal(latlng.lat, latlng.lng, currentDronePos.lat, currentDronePos.lng);
      
      // Calculate target local position
      const targetX = state.state.local_x + localOffset.x;
      const targetY = state.state.local_y + localOffset.y;
      const targetZ = -10; // 10 meters altitude
      const targetYaw = state.state.local_yaw; // Keep current yaw
        
      console.log('MiniMap: Moving to local coordinates:', { x: targetX, y: targetY, z: targetZ, yaw: targetYaw });
        
      // Use the same pattern as ManualControls
      const result = await droneAPI.setPosition(targetX, targetY, targetZ, targetYaw);
      setMessage(`Move command: ${result.message}`);
      
      // Clear message after 2 seconds like ManualControls
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      console.error('MiniMap: Move command failed:', error);
      setMessage(`Failed to move drone: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setTimeout(() => setMessage(''), 3000);
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
      console.log('MiniMap: Map clicked at:', e.latlng);
      if (e.latlng) {
        handleMapClick(e.latlng);
      }
    };
    
    map.on('click', clickHandler);
  }, [handleMapClick]);

  // Get current drone position from drone positions map
  const getCurrentDronePosition = () => {
    const currentPos = dronePositions.get(droneStatus.drone_name);
    if (currentPos && currentPos.valid) {
      return [currentPos.lat, currentPos.lng] as [number, number];
    }
    return null;
  };

  const miniMapStyle: React.CSSProperties = {
    position: 'absolute',
    top: '10px',
    right: '10px',
    width: '200px',
    height: '200px',
    zIndex: 1000,
    border: '3px solid #8B4513',
    borderRadius: '8px',
    backgroundColor: '#2F1B14',
    boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
    cursor: 'default'
  };

  return (
    <div style={miniMapStyle}>
      {/* OSRS-style minimap frame */}
      <div style={{
        position: 'absolute',
        top: '-6px',
        left: '-6px',
        right: '-6px',
        bottom: '-6px',
        border: '2px solid #A0956B',
        borderRadius: '3px',
        pointerEvents: 'none',
        background: 'linear-gradient(135deg, #8B7355 0%, #6B5A43 50%, #4A3729 100%)',
        boxShadow: 'inset 0 0 0 1px #D4C4A0, inset 0 0 0 2px #8B7355'
      }} />
      
      <div 
        ref={mapRef} 
        style={{ 
          height: '100%', 
          width: '100%',
          borderRadius: '5px'
        }} 
      />
      
      {/* OSRS-style minimap text */}
      <div style={{
        position: 'absolute',
        bottom: '2px',
        left: '2px',
        right: '2px',
        textAlign: 'center',
        color: '#FFFF00', // Classic OSRS yellow text
        fontSize: '8px',
        fontWeight: 'bold',
        fontFamily: 'monospace',
        textShadow: '1px 1px 0 #000000',
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.7)',
        padding: '1px',
        borderRadius: '0px'
      }}>
{dronePositions.size} DRONE{dronePositions.size !== 1 ? 'S' : ''} • REAL-TIME
      </div>
      
      {/* Status indicator for minimap */}
      {message && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '5px',
          right: '5px',
          background: message.includes('Failed') ? 'rgba(255, 68, 68, 0.9)' : 'rgba(34, 68, 34, 0.9)',
          color: 'white',
          padding: '2px 4px',
          borderRadius: '3px',
          fontSize: '8px',
          textAlign: 'center',
          pointerEvents: 'none'
        }}>
          {message.length > 40 ? message.substring(0, 40) + '...' : message}
        </div>
      )}
    </div>
  );
};

export default MiniMap;