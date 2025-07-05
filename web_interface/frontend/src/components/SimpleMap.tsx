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

interface SimpleMapProps {
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

const SimpleMap: React.FC<SimpleMapProps> = ({ droneAPI, droneStatus, availableDrones }) => {
  console.log('SimpleMap: Component created/rendered');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const droneMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const [dronePositions, setDronePositions] = useState<Map<string, DronePosition>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [targetPin, setTargetPin] = useState<L.Marker | null>(null);

  // Get drone's GPS position for map centering
  const getDroneGPSPosition = async () => {
    console.log('SimpleMap: Getting drone GPS position for centering...');
    if (!droneAPI.ros) {
      console.warn('SimpleMap: No ROS connection');
      return null;
    }

    try {
      const state = await droneAPI.getState();
      console.log('SimpleMap: Drone state received:', state);
      
      if (state.success && state.state && state.state.global_position_valid) {
        const lat = state.state.latitude;
        const lng = state.state.longitude;
        console.log('SimpleMap: Valid GPS position found:', lat, lng);
        return [lat, lng] as [number, number];
      } else {
        console.warn('SimpleMap: No valid GPS position available');
        return null;
      }
    } catch (error) {
      console.error('SimpleMap: Failed to get drone position:', error);
      return null;
    }
  };

  // Initialize map
  useEffect(() => {
    console.log('SimpleMap: Initializing map...');
    if (!mapRef.current || mapInstanceRef.current) return;

    const initializeMap = async () => {
      try {
        // Try to get drone's actual position first, fallback to SF
        const dronePos = await getDroneGPSPosition();
        const center = dronePos || [37.7749, -122.4194];
        
        console.log('SimpleMap: Creating Leaflet map at center:', center);
        const map = L.map(mapRef.current!, {
          zoomControl: true,
          attributionControl: true,
          dragging: true,
          scrollWheelZoom: true, // Enable mouse wheel zoom
          doubleClickZoom: true,
          boxZoom: true,
          keyboard: true
        }).setView(center, 15);
        
        // Set crosshair cursor for the map
        map.getContainer().style.cursor = 'crosshair';

        console.log('SimpleMap: Map created successfully');

        // Add tile layer
        console.log('SimpleMap: Adding tile layer...');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        console.log('SimpleMap: Tile layer added');

        // Handle map clicks for move commands
        map.on('click', (e) => {
          console.log('SimpleMap: Map clicked at', e.latlng);
          handleMapClick(e.latlng);
        });

        mapInstanceRef.current = map;
        console.log('SimpleMap: Map initialization complete');
      } catch (error) {
        console.error('SimpleMap: Failed to initialize map:', error);
      }
    };

    initializeMap();

    return () => {
      console.log('SimpleMap: Cleaning up map...');
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Fetch drone positions
  const fetchDronePositions = async () => {
    console.log('SimpleMap: Fetching drone positions...');
    if (!droneAPI.ros) {
      console.warn('SimpleMap: No ROS connection, skipping position fetch');
      return;
    }

    console.log('SimpleMap: Available drones:', availableDrones);
    const newPositions = new Map<string, DronePosition>();

    for (const droneName of availableDrones) {
      try {
        // Temporarily switch to this drone to get its state
        const originalTarget = droneStatus.drone_name;
        await droneAPI.setTargetDrone(droneName);
        
        const state = await droneAPI.getState();
        
        if (state.success && state.state && state.state.global_position_valid) {
          newPositions.set(droneName, {
            lat: state.state.latitude,
            lng: state.state.longitude,
            alt: state.state.altitude,
            valid: true
          });
        }
        
        // Switch back to original target
        if (originalTarget !== droneName) {
          await droneAPI.setTargetDrone(originalTarget);
        }
      } catch (error) {
        console.warn(`SimpleMap: Failed to get position for ${droneName}:`, error);
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

  // Handle map clicks for navigation
  const handleMapClick = async (latlng: L.LatLng) => {
    if (!droneAPI.ros) {
      setMessage('Not connected to rosbridge');
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
    setMessage(`Moving ${droneStatus.drone_name} to ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`);

    try {
      // For now, we'll use local coordinates (this would need GPS->local conversion)
      // This is a simplified approach - in reality you'd need to convert GPS to local NED coordinates
      const result = await droneAPI.setPosition(0, 0, -10, 0); // Placeholder - needs GPS conversion
      setMessage(`Click-to-move: ${result.message} (GPS conversion needed)`);
      
      // Remove target pin after command is sent
      setTimeout(() => {
        if (targetPin && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(targetPin);
          setTargetPin(null);
        }
      }, 3000);
    } catch (error) {
      setMessage(`Failed to move drone: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh drone positions periodically
  useEffect(() => {
    fetchDronePositions();
    const interval = setInterval(fetchDronePositions, 3000); // Every 3 seconds
    return () => clearInterval(interval);
  }, [availableDrones, droneAPI.ros]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '0.5rem', 
        borderBottom: '1px solid #444',
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#2d2d2d'
      }}>
        <h3 style={{ margin: 0 }}>Map View</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: '#888' }}>
            {dronePositions.size} drone(s) • Click to drop waypoint pin • Mouse wheel to zoom
          </span>
          <button 
            className="btn secondary"
            onClick={fetchDronePositions}
            disabled={isLoading}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
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
            fontSize: '0.75rem'
          }}>
            Processing...
          </div>
        )}
      </div>

      {message && (
        <div style={{
          padding: '0.5rem',
          backgroundColor: message.includes('Failed') ? '#442222' : '#224422',
          color: message.includes('Failed') ? '#ff8888' : '#88ff88',
          fontSize: '0.75rem',
          borderTop: '1px solid #444'
        }}>
          {message}
        </div>
      )}
    </div>
  );
};

export default SimpleMap;