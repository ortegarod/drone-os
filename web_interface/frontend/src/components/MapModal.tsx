import React from 'react';
import MiniMap from './MiniMap';
import './MapModal.css';

interface MapModalProps {
  isOpen: boolean;
  onClose: () => void;
  droneAPI: any;
  droneStatus: any;
  availableDrones: string[];
  targetAltitude: number;
}

const MapModal: React.FC<MapModalProps> = ({
  isOpen,
  onClose,
  droneAPI,
  droneStatus,
  availableDrones,
  targetAltitude,
}) => {
  if (!isOpen) return null;

  return (
    <div className="map-modal-overlay" onClick={onClose}>
      <div className="map-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="map-modal-header">
          <span className="map-modal-title">TACTICAL MAP</span>
          <button className="map-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="map-modal-body">
          <MiniMap
            droneAPI={droneAPI}
            droneStatus={droneStatus}
            availableDrones={availableDrones}
            targetAltitude={targetAltitude}
          />
        </div>
      </div>
    </div>
  );
};

export default MapModal;
