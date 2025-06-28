import React, { useEffect, useRef, useState, useCallback } from 'react';
// @ts-ignore
import ROSLIB from 'roslib';
import { DroneStatus } from '../App';

interface CameraFeedProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  isConnected: boolean;
}

const CameraFeed: React.FC<CameraFeedProps> = ({ droneAPI, droneStatus, isConnected }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageSubscriberRef = useRef<any>(null);
  const [feedStatus, setFeedStatus] = useState<'connecting' | 'connected' | 'error' | 'no_feed'>('connecting');
  const [lastImageTime, setLastImageTime] = useState<number>(0);
  const [frameCount, setFrameCount] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [frameRate, setFrameRate] = useState<number>(10); // Target FPS
  const [lastFrameTime, setLastFrameTime] = useState<number>(0);

  // Try multiple camera topics in order of preference
  const cameraTopics = [
    `/camera/image_raw/compressed`,
    `/camera/image_raw`,
    `/${droneStatus.drone_name}/annotated_image`,
    `/${droneStatus.drone_name}/image_raw`,
    `/image_raw/compressed`
  ];

  const drawImageToCanvas = useCallback((imageData: string, width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match image
    canvas.width = width;
    canvas.height = height;

    // Create image from base64 data
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      setFrameCount(prev => prev + 1);
      setLastImageTime(Date.now());
    };
    img.src = `data:image/jpeg;base64,${imageData}`;
  }, []);

  const handleImageMessage = useCallback((message: any) => {
    try {
      // Skip processing if paused
      if (isPaused) return;

      // Frame rate limiting
      const now = Date.now();
      const frameInterval = 1000 / frameRate; // ms per frame
      if (now - lastFrameTime < frameInterval) {
        return; // Skip this frame to maintain target FPS
      }
      setLastFrameTime(now);

      if (frameCount % 60 === 0) { // Log every 60th frame to reduce console spam
        console.log('CameraFeed: Processing frame', { 
          format: message.format, 
          encoding: message.encoding, 
          frameCount,
          dataSize: message.data ? message.data.length : 0,
          dataType: typeof message.data,
          dataPreview: message.data ? message.data.substring(0, 50) : 'no data'
        });
      }
      
      // Handle sensor_msgs/CompressedImage (from /camera/image_raw/compressed)
      if (message.format && message.data) {
        // Compressed image (sensor_msgs/CompressedImage)
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set default dimensions if not provided
        const width = message.width || 640;
        const height = message.height || 480;
        canvas.width = width;
        canvas.height = height;

        // Create image from base64 data
        const img = new Image();
        img.onload = () => {
          console.log('CameraFeed: Image loaded successfully, dimensions:', img.width, 'x', img.height);
          ctx.drawImage(img, 0, 0, width, height);
          setFrameCount(prev => prev + 1);
          setLastImageTime(Date.now());
          if (feedStatus !== 'connected') {
            setFeedStatus('connected');
            setErrorMessage('');
            console.log('CameraFeed: Successfully displaying camera feed');
          }
        };
        img.onerror = (error) => {
          console.error('CameraFeed: Failed to decode image:', error);
          console.error('CameraFeed: Image data preview:', message.data.substring(0, 100));
          setErrorMessage('Failed to decode image data');
        };
        
        // Handle base64 data - camera_ros sends raw binary data as base64
        const imageData = message.data;
        
        // Debug: check if the data looks like valid base64
        if (frameCount % 30 === 0) {
          console.log('CameraFeed: Image data sample:', imageData.substring(0, 50));
          console.log('CameraFeed: Constructing data URI with format:', message.format);
        }
        
        // For sensor_msgs/CompressedImage, data is base64 encoded binary JPEG
        // Try different approaches for the data URI
        let dataUri;
        if (imageData.startsWith('/9j/') || imageData.startsWith('iVBOR')) {
          // Already base64 encoded
          dataUri = `data:image/${message.format};base64,${imageData}`;
        } else {
          // Might need to convert array to base64
          dataUri = `data:image/${message.format};base64,${btoa(String.fromCharCode(...imageData))}`;
        }
        
        if (frameCount % 30 === 0) {
          console.log('CameraFeed: Setting image src to:', dataUri.substring(0, 100) + '...');
        }
        img.src = dataUri;
      } else if (message.encoding === 'rgb8' || message.encoding === 'bgr8') {
        // Raw image - convert to displayable format
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = message.width;
        canvas.height = message.height;

        // Create ImageData from raw pixel data
        const imageData = ctx.createImageData(message.width, message.height);
        const data = new Uint8Array(atob(message.data).split('').map(c => c.charCodeAt(0)));
        
        // Convert RGB/BGR to RGBA
        for (let i = 0; i < data.length; i += 3) {
          const pixelIndex = (i / 3) * 4;
          if (message.encoding === 'rgb8') {
            imageData.data[pixelIndex] = data[i];     // R
            imageData.data[pixelIndex + 1] = data[i + 1]; // G
            imageData.data[pixelIndex + 2] = data[i + 2]; // B
          } else { // bgr8
            imageData.data[pixelIndex] = data[i + 2];     // R
            imageData.data[pixelIndex + 1] = data[i + 1]; // G
            imageData.data[pixelIndex + 2] = data[i];     // B
          }
          imageData.data[pixelIndex + 3] = 255; // A
        }

        ctx.putImageData(imageData, 0, 0);
        setFrameCount(prev => prev + 1);
        setLastImageTime(Date.now());
        setFeedStatus('connected');
        setErrorMessage('');
      }
    } catch (error) {
      console.error('CameraFeed: Error processing image:', error);
      setErrorMessage(`Image processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setFeedStatus('error');
    }
  }, [drawImageToCanvas, isPaused, frameRate, lastFrameTime, frameCount]);

  const subscribeToCameraTopic = useCallback(async (topicName: string) => {
    if (!droneAPI.ros) {
      console.warn('CameraFeed: No ROS connection available');
      return false;
    }

    try {
      console.log(`CameraFeed: Attempting to subscribe to ${topicName}`);
      
      // Check if topic exists
      const getTopicsService = new ROSLIB.Service({
        ros: droneAPI.ros,
        name: '/rosapi/topics',
        serviceType: 'rosapi_msgs/srv/Topics'
      });

      return new Promise<boolean>((resolve) => {
        const request = new ROSLIB.ServiceRequest({});
        
        getTopicsService.callService(request, (result: any) => {
          const availableTopics = result.topics || [];
          console.log('CameraFeed: Available topics:', availableTopics);
          
          if (availableTopics.includes(topicName)) {
            console.log(`CameraFeed: Topic ${topicName} found, subscribing...`);
            
            // Clean up existing subscription
            if (imageSubscriberRef.current) {
              imageSubscriberRef.current.unsubscribe();
            }

            // Determine message type based on topic name
            const isCompressed = topicName.includes('/compressed');
            const messageType = isCompressed ? 'sensor_msgs/CompressedImage' : 'sensor_msgs/Image';
            
            console.log(`CameraFeed: Subscribing to ${topicName} with message type ${messageType}`);

            // Create new subscription
            imageSubscriberRef.current = new (ROSLIB as any).Topic({
              ros: droneAPI.ros,
              name: topicName,
              messageType: messageType
            });

            imageSubscriberRef.current.subscribe(handleImageMessage);
            
            // Set timeout to check if we're receiving data (only for raw image topics)
            if (!isCompressed) {
              setTimeout(() => {
                if (Date.now() - lastImageTime > 3000) {
                  console.log(`CameraFeed: No data received from ${topicName}, topic may not be publishing`);
                }
              }, 3000);
            }

            resolve(true);
          } else {
            console.log(`CameraFeed: Topic ${topicName} not found`);
            resolve(false);
          }
        }, (error: any) => {
          console.error(`CameraFeed: Error checking topics:`, error);
          resolve(false);
        });
      });
    } catch (error) {
      console.error(`CameraFeed: Error subscribing to ${topicName}:`, error);
      return false;
    }
  }, [droneAPI.ros, handleImageMessage, lastImageTime]);

  const initializeCameraFeed = useCallback(async () => {
    if (!isConnected || !droneAPI.ros) {
      setFeedStatus('connecting');
      return;
    }

    // Don't re-initialize if already connected and receiving frames
    if (feedStatus === "connected" && Date.now() - lastImageTime < 5000) {
      console.log('CameraFeed: Already connected and receiving frames, skipping re-initialization');
      return;
    }

    setFeedStatus('connecting');
    setErrorMessage('');

    // Try each camera topic until one works
    for (const topic of cameraTopics) {
      console.log(`CameraFeed: Trying topic: ${topic}`);
      const success = await subscribeToCameraTopic(topic);
      if (success) {
        console.log(`CameraFeed: Successfully subscribed to ${topic}`);
        return;
      }
    }

    // If no topics work, show no feed available
    setFeedStatus('no_feed');
    setErrorMessage('No camera feed available. Check if camera is running on remote host.');
  }, [isConnected, droneAPI.ros, subscribeToCameraTopic, cameraTopics, feedStatus, lastImageTime]);

  // Initialize camera feed when connection or drone changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      initializeCameraFeed();
    }, 1000); // Delay to prevent rapid re-initialization

    return () => {
      clearTimeout(timeoutId);
      if (imageSubscriberRef.current) {
        imageSubscriberRef.current.unsubscribe();
        imageSubscriberRef.current = null;
      }
    };
  }, [isConnected, droneStatus.drone_name]); // Remove initializeCameraFeed from deps to prevent loop

  // Check for stale feed
  useEffect(() => {
    const checkFeedHealth = setInterval(() => {
      if (feedStatus === 'connected' && lastImageTime > 0) {
        const timeSinceLastFrame = Date.now() - lastImageTime;
        if (timeSinceLastFrame > 10000) { // No frames for 10 seconds
          console.warn('CameraFeed: Feed appears stale, reinitializing...');
          setFeedStatus('error');
          setErrorMessage('Camera feed timed out');
        }
      }
    }, 5000);

    return () => clearInterval(checkFeedHealth);
  }, [feedStatus, lastImageTime]);

  const getFeedStatusColor = () => {
    switch (feedStatus) {
      case 'connected': return '#00ff88';
      case 'connecting': return '#ff8800';
      case 'error': return '#ff4444';
      case 'no_feed': return '#888888';
      default: return '#888888';
    }
  };

  const getFeedStatusText = () => {
    switch (feedStatus) {
      case 'connected': return `${isPaused ? '⏸️ Paused' : 'Live Feed'} • ${frameCount} frames @ ${frameRate}fps`;
      case 'connecting': return 'Connecting to camera...';
      case 'error': return 'Feed Error';
      case 'no_feed': return 'No Camera Available';
      default: return 'Unknown Status';
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ 
        padding: '1rem', 
        borderBottom: '1px solid #444',
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h2>📹 Live Camera Feed</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ 
            fontSize: '0.875rem',
            color: getFeedStatusColor(),
            fontWeight: 'bold'
          }}>
            {getFeedStatusText()}
          </div>
          
          {/* Bandwidth Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
            <button
              className={`btn ${isPaused ? 'primary' : 'secondary'}`}
              onClick={() => setIsPaused(!isPaused)}
              style={{ padding: '0.25rem 0.5rem' }}
            >
              {isPaused ? '▶️ Resume' : '⏸️ Pause'}
            </button>
            
            <select
              value={frameRate}
              onChange={(e) => setFrameRate(Number(e.target.value))}
              style={{
                padding: '0.25rem',
                backgroundColor: '#3d3d3d',
                color: '#fff',
                border: '1px solid #555',
                borderRadius: '4px',
                fontSize: '0.75rem'
              }}
            >
              <option value={1}>1 FPS</option>
              <option value={2}>2 FPS</option>
              <option value={5}>5 FPS</option>
              <option value={10}>10 FPS</option>
              <option value={15}>15 FPS</option>
              <option value={30}>30 FPS</option>
            </select>
          </div>
          
          <button
            className="btn secondary"
            onClick={initializeCameraFeed}
            style={{ padding: '0.5rem 1rem' }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>
      
      {/* Camera Feed Display */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: '#1a1a1a',
        position: 'relative'
      }}>
        {feedStatus === 'connected' && (
          <canvas
            ref={canvasRef}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              border: '2px solid #00ff88',
              borderRadius: '4px'
            }}
          />
        )}
        
        {feedStatus !== 'connected' && (
          <div style={{
            textAlign: 'center',
            padding: '2rem',
            color: '#888'
          }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
              {feedStatus === 'connecting' ? '⏳' : 
               feedStatus === 'error' ? '⚠️' : 
               feedStatus === 'no_feed' ? '📷' : '❓'}
            </div>
            <div style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
              {getFeedStatusText()}
            </div>
            {errorMessage && (
              <div style={{ 
                fontSize: '0.875rem', 
                color: '#ff8888',
                backgroundColor: '#442222',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                maxWidth: '400px',
                margin: '0 auto'
              }}>
                {errorMessage}
              </div>
            )}
            <div style={{ fontSize: '0.875rem', marginTop: '1rem' }}>
              Make sure the camera container is running on the remote host<br/>
              and publishing to one of these topics:
              <ul style={{ textAlign: 'left', marginTop: '0.5rem', display: 'inline-block' }}>
                {cameraTopics.map(topic => (
                  <li key={topic} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {topic}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Paused Overlay */}
        {isPaused && feedStatus === 'connected' && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#ff8800',
            padding: '1rem 2rem',
            borderRadius: '8px',
            fontSize: '1.5rem',
            fontWeight: 'bold',
            textAlign: 'center',
            border: '2px solid #ff8800'
          }}>
            ⏸️ FEED PAUSED
            <div style={{ fontSize: '0.875rem', marginTop: '0.5rem', fontWeight: 'normal' }}>
              Click Resume to continue streaming
            </div>
          </div>
        )}

        {/* Feed Info Overlay */}
        {feedStatus === 'connected' && !isPaused && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'rgba(0, 0, 0, 0.7)',
            color: '#00ff88',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontFamily: 'monospace'
          }}>
            {droneStatus.drone_name} • {frameCount} frames @ {frameRate}fps
            {lastImageTime > 0 && (
              <div>Last frame: {Math.round((Date.now() - lastImageTime) / 1000)}s ago</div>
            )}
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div style={{
        padding: '0.5rem 1rem',
        backgroundColor: '#2d2d2d',
        fontSize: '0.75rem',
        color: '#888',
        borderTop: '1px solid #444',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>
          Target: {droneStatus.drone_name} • 
          ROS: {isConnected ? '🟢 Connected' : '🔴 Disconnected'} •
          Bandwidth: {isPaused ? '🔴 Paused' : frameRate <= 5 ? '🟢 Low' : frameRate <= 15 ? '🟡 Medium' : '🔴 High'}
        </span>
        <span>
          Camera: /camera/image_raw/compressed • JPG format • Frame limiting: {frameRate}fps
        </span>
      </div>
    </div>
  );
};

export default CameraFeed;