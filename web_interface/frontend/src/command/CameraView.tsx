// Camera viewport: shows the MJPEG stream with an overlay for object detections.
import React, { useEffect, useState } from 'react';
import type { FleetDrone } from '../api/fleet';

interface Props {
  drone: string;
  det?: FleetDrone['detections'];
}

const CameraView: React.FC<Props> = ({ drone, det }) => {
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  useEffect(() => { setLive(false); setAttempt(0); }, [drone]);
  if (!drone) return <div className="cc-camera empty">No drone selected</div>;
  const shown = (det?.objects || []).filter(o => o.confirmed !== false);
  const src = `/camera/stream?topic=${encodeURIComponent('/' + drone + '/camera')}&type=mjpeg&width=640&height=480&quality=50&r=${attempt}`;
  return (
    <div className="cc-camera">
      <img key={src} src={src} alt={`${drone} camera`}
           onLoad={() => setLive(true)}
           onError={() => { setLive(false); setTimeout(() => setAttempt(a => a + 1), 2000); }} />
      <span className={`cc-camera-tag ${live ? 'live' : ''}`}>{live ? '● LIVE' : 'connecting…'} {drone}</span>
      {live && det && (
        <div className="cc-det" title="Object detector on the drone (only objects seen in several frames in a row)">
          {shown.map((o, i) => (
            <div key={i} className={`cc-det-box det-${o.label.replace(/[^a-z]/gi, '')}`}
                 style={{ left: `${o.box[0] * 100}%`, top: `${o.box[1] * 100}%`, width: `${(o.box[2] - o.box[0]) * 100}%`, height: `${(o.box[3] - o.box[1]) * 100}%` }}>
              <span>{o.label} {Math.round(o.score * 100)}%</span>
            </div>
          ))}
          <span className="cc-det-tag">{shown.length ? shown.length + ' detected' : 'detector on'}{det.fps ? ` · ${det.fps.toFixed(0)} fps` : ''}</span>
        </div>
      )}
    </div>
  );
};

export default CameraView;
