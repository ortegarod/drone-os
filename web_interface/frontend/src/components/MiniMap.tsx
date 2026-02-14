import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// @ts-ignore
import ROSLIB from 'roslib';
import { DroneStatus } from '../types/drone';
import { logger } from '../utils/logger';

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
  targetAltitude: number;
  onExpand?: () => void;
}

interface DronePosition {
  lat: number;
  lng: number;
  alt: number;
  yaw: number;
  valid: boolean;
  droneName: string;
}

const MiniMap: React.FC<MiniMapProps> = ({ droneAPI, droneStatus, availableDrones, targetAltitude, onExpand }) => {
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

    // Don't try if not connected yet - this is normal on initial load
    const { isConnected } = await import('../ros');
    if (!isConnected()) {
      logger.debug('MiniMap: Waiting for rosbridge connection...');
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
      logger.error('MiniMap: Failed to get drone position:', error);
      return null;
    }
  };

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) return;
    
    const container = mapRef.current;
    
    // Only initialize if not already initialized
    if (mapInstanceRef.current) {
      logger.debug('MiniMap: Map already initialized, skipping');
      return;
    }
    
    // Clear any existing Leaflet state on the container
    if ('_leaflet_id' in container) {
      logger.debug('MiniMap: Cleaning existing Leaflet state');
      delete (container as any)._leaflet_id;
    }
    
    // Additional check: ensure container doesn't have a map instance
    if (container.innerHTML && container.innerHTML.includes('leaflet-')) {
      logger.debug('MiniMap: Container already has Leaflet content, clearing');
      container.innerHTML = '';
    }
    
    const initializeMap = async () => {
      try {
        // Try to get drone's actual position first
        const dronePos = await getDroneGPSPosition();
        const center = dronePos || mapCenter;
        
        logger.debug('MiniMap: Creating Leaflet map');
        
        let map;
        try {
          map = L.map(container, {
            zoomControl: false,
            attributionControl: false,
            dragging: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            boxZoom: false,
            keyboard: false
          }).setView(center, 13);
        } catch (leafletError: any) {
          if (leafletError.message && leafletError.message.includes('already initialized')) {
            // Container already has a map, skip initialization but don't error
            logger.debug('MiniMap: Container already initialized, skipping');
            return;
          }
          throw leafletError;
        }
        
        // Set crosshair cursor for the map
        map.getContainer().style.cursor = 'crosshair';

        logger.debug('MiniMap: Map created successfully');

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Store map click handler
        const clickHandler = (e: L.LeafletMouseEvent) => {
          logger.debug('MiniMap: Map clicked at:', e.latlng);
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
        logger.error('MiniMap: Failed to initialize map:', error);
      }
    };

    initializeMap();

    return () => {
      logger.debug('MiniMap: Cleaning up map...');
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.off(); // Remove all event listeners
          mapInstanceRef.current.remove();
        } catch (error) {
          logger.warn('MiniMap: Error during map cleanup:', error);
        }
        mapInstanceRef.current = null;
      }
      // Clear Leaflet state from container
      if ('_leaflet_id' in container) {
        delete (container as any)._leaflet_id;
      }
      // Clear container content to ensure clean state
      if (container) {
        container.innerHTML = '';
      }
    };
  }, []); // Only initialize once

  // Subscribe to real-time drone state topics via rosbridge (same as DroneMap but for minimap)
  useEffect(() => {
    if (!droneAPI.ros) return;

    logger.debug('MiniMap: Setting up real-time subscriptions for drones:', availableDrones);

    // Clean up existing subscriptions
    topicSubscriptionsRef.current.forEach((topic, droneName) => {
      logger.debug(`MiniMap: Unsubscribing from ${droneName}`);
      topic.unsubscribe();
    });
    topicSubscriptionsRef.current.clear();

    // Subscribe to each drone's state topic
    availableDrones.forEach(droneName => {
      const namespace = droneName;
      const topicName = `/${namespace}/drone_state`;
      
      logger.debug(`MiniMap: Subscribing to ${topicName} for ${droneName}`);
      
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
          logger.debug(`[MiniMap] ${droneName} received data:`, {
            lat: message.latitude,
            lng: message.longitude,
            alt: message.altitude,
            compass_heading: message.compass_heading,
            local_yaw: message.local_yaw
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
        
        logger.debug(`[MiniMap] Triangle rotation for ${droneName}:`, {
          compass_heading: position.yaw,
          css_rotation: yawDegrees
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
    logger.debug('MiniMap: handleMapClick called with:', latlng);

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
    setMessage(`Moving ${droneStatus.drone_name || 'drone'} to clicked location...`);

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
        
      logger.debug('MiniMap: Moving to local coordinates:', { x: targetX, y: targetY, z: targetZ, yaw: targetYaw });
        
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
      logger.error('MiniMap: Move command failed:', error);
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
      logger.debug('MiniMap: Map clicked at:', e.latlng);
      if (e.latlng) {
        handleMapClick(e.latlng);
      }
    };
    
    map.on('click', clickHandler);
  }, [handleMapClick]);


  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: '#0d1117' }}>
      <div ref={mapRef} style={{ height: '100%', width: '100%' }} />
      
      {/* Status bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '2px 8px',
        background: 'rgba(13,17,23,0.85)',
        borderTop: '1px solid #21262d',
        font: '10px/1.4 monospace',
        color: '#8b949e',
        display: 'flex', justifyContent: 'space-between',
        pointerEvents: 'none',
      }}>
        <span>{dronePositions.size} asset{dronePositions.size !== 1 ? 's' : ''}</span>
        <span style={{ color: '#3fb950' }}>● live</span>
      </div>

      {/* Compass */}
      <div style={{
        position: 'absolute', top: 4, right: 4,
        padding: '2px 6px',
        background: 'rgba(13,17,23,0.85)',
        border: '1px solid #30363d',
        borderRadius: 3,
        font: '10px/1.4 monospace',
        color: '#c9d1d9',
        pointerEvents: 'none',
        zIndex: 1000,
      }}>
        {(() => {
          const p = dronePositions.get(droneStatus.drone_name);
          return p?.valid ? `${Math.round(p.yaw)}° N` : '---';
        })()}
      </div>

      {/* Expand button */}
      {onExpand && (
        <button
          onClick={onExpand}
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            padding: '4px 8px',
            background: 'rgba(13,17,23,0.85)',
            border: '1px solid #30363d',
            borderRadius: 3,
            font: '10px/1.4 monospace',
            color: '#58a6ff',
            cursor: 'pointer',
            transition: 'all 0.15s',
            zIndex: 1000,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(21,27,33,0.95)';
            e.currentTarget.style.borderColor = '#58a6ff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(13,17,23,0.85)';
            e.currentTarget.style.borderColor = '#30363d';
          }}
        >
          ⛶ EXPAND
        </button>
      )}

      {/* Command feedback */}
      {message && (
        <div style={{
          position: 'absolute', bottom: 20, left: 4, right: 4,
          padding: '2px 6px',
          background: 'rgba(13,17,23,0.9)',
          border: `1px solid ${message.includes('Failed') ? '#f85149' : '#238636'}`,
          borderRadius: 3,
          font: '9px/1.4 monospace',
          color: message.includes('Failed') ? '#f85149' : '#3fb950',
          textAlign: 'center',
          pointerEvents: 'none',
        }}>
          {message.length > 40 ? message.substring(0, 40) + '…' : message}
        </div>
      )}
    </div>
  );
};

export default MiniMap;