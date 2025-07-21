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
  targetAltitude: number;
}

interface DronePosition {
  lat: number;
  lng: number;
  alt: number;
  yaw: number;
  valid: boolean;
  droneName: string;
}

const MiniMap: React.FC<MiniMapProps> = ({ droneAPI, droneStatus, availableDrones, unitSystem, targetAltitude }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const [dronePositions, setDronePositions] = useState<Map<string, DronePosition>>(new Map());
  const [message, setMessage] = useState('');
  const [targetPin, setTargetPin] = useState<L.Marker | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([37.7749, -122.4194]); // Default to SF
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
        
        // Set crosshair cursor for the map
        map.getContainer().style.cursor = 'crosshair';

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
        
        // Track user interaction to prevent auto-centering
        const userInteractionHandler = () => {
          setUserInteracted(true);
          // Reset after 10 seconds of no interaction
          setTimeout(() => setUserInteracted(false), 10000);
        };
        
        map.on('click', clickHandler);
        map.on('drag', userInteractionHandler);
        map.on('zoom', userInteractionHandler);
        map.on('mousedown', userInteractionHandler);

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
          console.log(`[MiniMap DEBUG] ${droneName} received data:`, {
            lat: message.latitude,
            lng: message.longitude,
            alt: message.altitude,
            compass_heading: message.compass_heading,
            local_yaw: message.local_yaw,
            has_compass_heading: 'compass_heading' in message,
            compass_heading_type: typeof message.compass_heading
          });
          
          setDronePositions(prev => {
            const updated = new Map(prev);
            updated.set(droneName, {
              lat: message.latitude,
              lng: message.longitude,
              alt: message.altitude,
              yaw: message.compass_heading || message.local_yaw || 0,
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
        // Create triangular drone icon pointing in yaw direction
        const isCurrentTarget = droneName === droneStatus.drone_name;
        const size = 20;
        const fontSize = '9px';
        // Triangle with border-bottom points UP (North) by default
        // Compass: 0°=North, 90°=East, 180°=South, 270°=West
        // So CSS rotation should match compass heading directly
        const yawDegrees = position.yaw;
        
        console.log(`[MiniMap DEBUG] Triangle rotation for ${droneName}:`, {
          compass_heading: position.yaw,
          css_rotation: yawDegrees,
          should_point: position.yaw === 0 ? 'North' : 
                       position.yaw === 90 ? 'East' : 
                       position.yaw === 180 ? 'South' : 
                       position.yaw === 270 ? 'West' : `${position.yaw}°`
        });
        
        // Triangular drone marker that points in yaw direction
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
              border-bottom: ${size}px solid ${isCurrentTarget ? '#4a90a4' : '#5ba0b4'};
              position: absolute;
              top: 0;
              left: 0;
              filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
            "></div>
            <div style="
              width: 0;
              height: 0;
              border-left: ${size/2 - 2}px solid transparent;
              border-right: ${size/2 - 2}px solid transparent;
              border-bottom: ${size - 4}px solid ${isCurrentTarget ? '#ffffff' : '#ffffff'};
              position: absolute;
              top: 2px;
              left: 2px;
            "></div>
            <div style="
              position: absolute;
              top: ${size - 12}px;
              left: 50%;
              transform: translateX(-50%) rotate(${-yawDegrees}deg);
              font-size: ${fontSize};
              color: #000000;
              font-weight: 600;
              font-family: 'Segoe UI', system-ui, sans-serif;
              text-shadow: 0 1px 2px rgba(255,255,255,0.8);
              pointer-events: none;
            ">
              ${droneName.replace('drone', '')}
            </div>
            ${isCurrentTarget ? `
            <div style="
              position: absolute;
              top: -2px;
              right: -2px;
              width: 6px;
              height: 6px;
              background: #4a90a4;
              border-radius: 50%;
              border: 1px solid #ffffff;
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
          className: 'tactical-drone-triangle',
          iconSize: [size, size],
          iconAnchor: [size/2, size/2]
        });

        const marker = L.marker([position.lat, position.lng], { icon })
          .addTo(map);

        droneMarkersRef.current.set(droneName, marker);
      }
    });

    // Only center map if user hasn't interacted recently and drone position has changed significantly
    const currentDronePos = dronePositions.get(droneStatus.drone_name);
    if (currentDronePos && currentDronePos.valid && !userInteracted) {
      const currentCenter = map.getCenter();
      const distance = currentCenter.distanceTo([currentDronePos.lat, currentDronePos.lng]);
      
      // Only recenter if drone moved more than 500 meters (increased threshold)
      if (distance > 500) {
        // Preserve current zoom level instead of forcing zoom 13
        const currentZoom = map.getZoom();
        map.setView([currentDronePos.lat, currentDronePos.lng], currentZoom);
        setMapCenter([currentDronePos.lat, currentDronePos.lng]);
      }
    }
  }, [dronePositions, droneStatus.drone_name, userInteracted]);

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

    // Remove previous target pin if exists
    if (targetPin && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(targetPin);
    }

    // Create and add new target pin (smaller for mini-map)
    if (mapInstanceRef.current) {
      const pinIcon = L.divIcon({
        html: `<div style="
          width: 10px;
          height: 10px;
          background: #FF4444;
          border: 1px solid #FFFFFF;
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0,0,0,0.4);
          position: relative;
        ">
          <div style="
            position: absolute;
            top: -5px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 4px solid transparent;
            border-right: 4px solid transparent;
            border-bottom: 8px solid #FF4444;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
          "></div>
        </div>`,
        className: 'mini-target-pin',
        iconSize: [10, 10],
        iconAnchor: [5, 10]
      });
      
      const pin = L.marker([latlng.lat, latlng.lng], { icon: pinIcon })
        .addTo(mapInstanceRef.current);
      
      setTargetPin(pin);
    }

    setIsLoading(true);
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
      const targetZ = -targetAltitude; // Use selected altitude (negative for NED up)
      const targetYaw = state.state.local_yaw; // Keep current yaw
        
      console.log('MiniMap: Moving to local coordinates:', { x: targetX, y: targetY, z: targetZ, yaw: targetYaw });
        
      // Use auto-yaw to point towards destination
      const result = await droneAPI.setPositionAutoYaw(targetX, targetY, targetZ);
      setMessage(`Moving with auto-yaw: ${result.message}`);
      
      // Clear message after 2 seconds like ManualControls
      setTimeout(() => {
        setMessage('');
        // Remove target pin after command
        if (targetPin && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(targetPin);
          setTargetPin(null);
        }
      }, 2000);
    } catch (error) {
      console.error('MiniMap: Move command failed:', error);
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
      console.log('MiniMap: Map clicked at:', e.latlng);
      if (e.latlng) {
        handleMapClick(e.latlng);
      }
    };
    
    map.on('click', clickHandler);
  }, [handleMapClick]);


  const miniMapStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    border: '2px solid #2c3e50',
    borderRadius: '4px',
    backgroundColor: '#1a1a1a',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.1)',
    cursor: 'default'
  };

  return (
    <div style={miniMapStyle}>
        {/* Professional tactical frame */}
      <div style={{
        position: 'absolute',
        top: '-3px',
        left: '-3px',
        right: '-3px',
        bottom: '-3px',
        border: '1px solid #34495e',
        borderRadius: '2px',
        pointerEvents: 'none',
        background: 'linear-gradient(135deg, #2c3e50 0%, #34495e 50%, #2c3e50 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)'
      }} />

      
      <div 
        ref={mapRef} 
        style={{ 
          height: '100%', 
          width: '100%',
          borderRadius: '5px'
        }} 
      />
      
      {/* Professional status display */}
      <div style={{
        position: 'absolute',
        bottom: '4px',
        left: '4px',
        right: '4px',
        textAlign: 'center',
        color: '#e1e8ed',
        fontSize: '10px',
        fontWeight: '600',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        textShadow: '0 1px 2px rgba(0,0,0,0.8)',
        pointerEvents: 'none',
        background: 'linear-gradient(135deg, rgba(0,0,0,0.8), rgba(20,20,20,0.9))',
        padding: '2px 4px',
        borderRadius: '2px',
        border: '1px solid rgba(0,255,65,0.3)'
      }}>
        {dronePositions.size} ASSET{dronePositions.size !== 1 ? 'S' : ''} • LIVE
      </div>
      
      {/* Simple compass overlay */}
      <div style={{
        position: 'absolute',
        top: '6px',
        right: '6px',
        width: '40px',
        height: '40px',
        backgroundColor: 'rgba(15, 25, 35, 0.9)',
        borderRadius: '50%',
        border: '1px solid #4a90a4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        zIndex: 1000
      }}>
        {/* North indicator */}
        <div style={{
          position: 'absolute',
          top: '2px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '8px',
          fontWeight: 'bold',
          color: '#4a90a4',
          fontFamily: 'monospace'
        }}>N</div>
        
        {/* Drone heading display */}
        {(() => {
          const currentDronePos = dronePositions.get(droneStatus.drone_name);
          if (currentDronePos && currentDronePos.valid) {
            return (
              <div style={{
                fontSize: '10px',
                fontWeight: 'bold',
                color: '#e1e8ed',
                fontFamily: 'monospace',
                textAlign: 'center'
              }}>
                {Math.round(currentDronePos.yaw)}°
              </div>
            );
          }
          return (
            <div style={{
              fontSize: '8px',
              color: '#6c7a89',
              fontFamily: 'monospace'
            }}>
              ---
            </div>
          );
        })()}
      </div>

      {/* Command status indicator */}
      {message && (
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '6px',
          right: '6px',
          background: message.includes('Failed') ? 'linear-gradient(135deg, #e74c3c, #c0392b)' : 'linear-gradient(135deg, #27ae60, #229954)',
          color: '#ffffff',
          padding: '3px 6px',
          borderRadius: '2px',
          fontSize: '9px',
          fontWeight: '500',
          textAlign: 'center',
          pointerEvents: 'none',
          border: '1px solid rgba(255,255,255,0.2)',
          textShadow: '0 1px 1px rgba(0,0,0,0.5)'
        }}>
          {message.length > 35 ? message.substring(0, 35) + '...' : message}
        </div>
      )}
    </div>
  );
};

export default MiniMap;