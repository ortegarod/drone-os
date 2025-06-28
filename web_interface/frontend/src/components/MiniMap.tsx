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

interface MiniMapProps {
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

const MiniMap: React.FC<MiniMapProps> = ({ droneAPI, droneStatus, availableDrones }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const [dronePositions, setDronePositions] = useState<Map<string, DronePosition>>(new Map());
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [mapCenter, setMapCenter] = useState<[number, number]>([37.7749, -122.4194]); // Default to SF

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
    
    // Clean up any existing map first
    if (mapInstanceRef.current) {
      try {
        mapInstanceRef.current.remove();
      } catch (error) {
        console.warn('MiniMap: Error removing existing map:', error);
      }
      mapInstanceRef.current = null;
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
          boxZoom: isExpanded,
          keyboard: isExpanded
        }).setView(center, isExpanded ? 15 : 13);

        console.log('MiniMap: Map created successfully');

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Handle map clicks for move commands
        map.on('click', (e) => {
          console.log('MiniMap: Map clicked at:', e.latlng);
          if (e.latlng) {
            handleMapClick(e.latlng);
          }
        });

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
  }, [isExpanded]); // Re-initialize when expand state changes

  // Handle expand/collapse state changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    const map = mapInstanceRef.current;
    
    // Invalidate size after state change
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
    
  }, [isExpanded]);

  // Fetch drone positions
  const fetchDronePositions = React.useCallback(async () => {
    if (!droneAPI.ros || availableDrones.length === 0) {
      return;
    }

    const newPositions = new Map<string, DronePosition>();
    
    for (const droneName of availableDrones) {
      try {
        // Temporarily switch to this drone to get its state
        const originalTarget = droneStatus.drone_name;
        await droneAPI.setTargetDrone(droneName);
        
        const state = await droneAPI.getState();
        
        if (state.success && state.state) {
          // Check if we have reasonable GPS coordinates (even if marked invalid)
          const hasReasonableCoords = state.state.latitude !== 0 && state.state.longitude !== 0 &&
                                    Math.abs(state.state.latitude) <= 90 && Math.abs(state.state.longitude) <= 180;
          
          if (state.state.global_position_valid || hasReasonableCoords) {
            newPositions.set(droneName, {
              lat: state.state.latitude,
              lng: state.state.longitude,
              alt: state.state.altitude,
              valid: true
            });
          }
        }
        
        // Switch back to original target
        if (originalTarget !== droneName) {
          await droneAPI.setTargetDrone(originalTarget);
        }
      } catch (error) {
        console.warn(`MiniMap: Failed to get position for ${droneName}:`, error);
      }
    }

    setDronePositions(newPositions);
  }, [droneAPI, availableDrones, droneStatus.drone_name]);

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
        const size = isExpanded ? 20 : 12;
        const fontSize = isExpanded ? '10px' : '8px';
        
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

        if (isExpanded) {
          marker.bindPopup(`
            <div>
              <strong>${droneName}</strong><br/>
              Lat: ${position.lat.toFixed(6)}<br/>
              Lng: ${position.lng.toFixed(6)}<br/>
              Alt: ${position.alt.toFixed(1)}m<br/>
              ${isCurrentTarget ? '<em>Current Target</em>' : ''}
            </div>
          `);
        }

        droneMarkersRef.current.set(droneName, marker);
      }
    });

    // Center map on current target drone if available
    const currentDronePos = dronePositions.get(droneStatus.drone_name);
    if (currentDronePos && currentDronePos.valid) {
      const zoom = isExpanded ? Math.max(map.getZoom(), 15) : 13;
      map.setView([currentDronePos.lat, currentDronePos.lng], zoom);
      setMapCenter([currentDronePos.lat, currentDronePos.lng]);
    }
  }, [dronePositions, droneStatus.drone_name, isExpanded]);

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
    } finally {
      setIsLoading(false);
    }
  }, [dronePositions, droneStatus.drone_name, droneAPI]);

  // Refresh drone positions periodically
  useEffect(() => {
    if (availableDrones.length > 0 && droneAPI.ros) {
      fetchDronePositions();
      const interval = setInterval(fetchDronePositions, 3000); // Every 3 seconds
      return () => clearInterval(interval);
    }
  }, [availableDrones.length, droneAPI.ros, fetchDronePositions]);

  const miniMapStyle: React.CSSProperties = {
    position: 'absolute',
    top: '10px',
    right: '10px',
    width: isExpanded ? '90vw' : '200px',
    height: isExpanded ? '80vh' : '200px',
    zIndex: 1000,
    border: '3px solid #8B4513',
    borderRadius: '8px',
    backgroundColor: '#2F1B14',
    boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
    transition: 'all 0.3s ease-in-out',
    cursor: 'default'
  };

  const overlayStyle: React.CSSProperties = isExpanded ? {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  } : {};

  return (
    <>
      {isExpanded && (
        <div style={overlayStyle} onClick={() => setIsExpanded(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div style={miniMapStyle}>
              {/* Header for expanded view */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '50px',
                backgroundColor: '#8B4513',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 1rem',
                borderRadius: '5px 5px 0 0',
                zIndex: 1001
              }}>
                <span style={{ color: 'white', fontWeight: 'bold' }}>
                  🗺️ Drone Map - {dronePositions.size} drone(s) • Click to move • Scroll to zoom
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    onClick={fetchDronePositions}
                    disabled={isLoading}
                    style={{
                      background: '#654321',
                      border: 'none',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem'
                    }}
                  >
                    🔄 Refresh
                  </button>
                  <button 
                    onClick={() => setIsExpanded(false)}
                    style={{
                      background: '#654321',
                      border: 'none',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem'
                    }}
                  >
                    ✕ Close
                  </button>
                </div>
              </div>
              
              <div 
                ref={mapRef} 
                style={{ 
                  height: '100%', 
                  width: '100%',
                  borderRadius: '5px',
                  paddingTop: isExpanded ? '50px' : '0'
                }} 
              />
              
              {isLoading && (
                <div style={{
                  position: 'absolute',
                  bottom: '10px',
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
              
              {message && (
                <div style={{
                  position: 'absolute',
                  bottom: '10px',
                  right: '10px',
                  background: message.includes('Failed') ? '#442222' : '#224422',
                  color: message.includes('Failed') ? '#ff8888' : '#88ff88',
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  maxWidth: '300px'
                }}>
                  {message}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {!isExpanded && (
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
          
          {/* OSRS-style expand button */}
          <button
            onClick={() => setIsExpanded(true)}
            style={{
              position: 'absolute',
              top: '3px',
              right: '3px',
              background: 'linear-gradient(145deg, #8B7355, #6B5A43)',
              border: '1px outset #A0956B',
              color: '#E6D7B8',
              padding: '2px 6px',
              borderRadius: '0px',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 'bold',
              zIndex: 1001,
              fontFamily: 'monospace',
              textShadow: '1px 1px 0 #2C1810',
              boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.2)'
            }}
          >
            ◯
          </button>
          
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
            {dronePositions.size} DRONE{dronePositions.size !== 1 ? 'S' : ''}
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
      )}
    </>
  );
};

export default MiniMap;