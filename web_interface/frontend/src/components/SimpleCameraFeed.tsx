import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import ROSLIB from 'roslib';

interface SimpleCameraFeedProps {
  droneAPI: any;
  isConnected: boolean;
}

const SimpleCameraFeed: React.FC<SimpleCameraFeedProps> = ({ droneAPI, isConnected }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<string>('Connecting...');
  const [frameCount, setFrameCount] = useState<number>(0);

  useEffect(() => {
    if (!isConnected || !droneAPI.ros) {
      setStatus('Not connected to ROS');
      return;
    }

    console.log('SimpleCameraFeed: Setting up subscription');
    
    // Subscribe to compressed images - this is what works with showimage
    const imageSubscriber = new (ROSLIB as any).Topic({
      ros: droneAPI.ros,
      name: '/camera/image_raw/compressed',
      messageType: 'sensor_msgs/CompressedImage'
    });

    const handleImage = (message: any) => {
      console.log('SimpleCameraFeed: Got image:', {
        format: message.format,
        dataSize: message.data?.length,
        dataType: typeof message.data
      });

      if (!imgRef.current || !message.data) return;

      try {
        // Create blob from base64 data and set as image source
        const binaryString = atob(message.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const blob = new Blob([bytes], { type: `image/${message.format}` });
        const url = URL.createObjectURL(blob);
        
        imgRef.current.onload = () => {
          setFrameCount(prev => prev + 1);
          setStatus(`Live • ${frameCount} frames`);
          URL.revokeObjectURL(url); // Clean up
        };
        
        imgRef.current.onerror = () => {
          console.error('SimpleCameraFeed: Failed to load image');
          setStatus('Image load error');
        };
        
        imgRef.current.src = url;
        
      } catch (error) {
        console.error('SimpleCameraFeed: Error processing image:', error);
        setStatus('Processing error');
      }
    };

    imageSubscriber.subscribe(handleImage);
    setStatus('Subscribed, waiting for images...');

    return () => {
      console.log('SimpleCameraFeed: Cleaning up');
      imageSubscriber.unsubscribe();
    };
  }, [isConnected, droneAPI.ros, frameCount]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '1rem', 
        borderBottom: '1px solid #444',
        backgroundColor: '#2d2d2d'
      }}>
        <h2>📹 Simple Camera Feed</h2>
        <div style={{ fontSize: '0.875rem', color: '#888' }}>
          Status: {status}
        </div>
      </div>
      
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: '#1a1a1a'
      }}>
        <img
          ref={imgRef}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain'
          }}
          alt="Camera feed"
        />
      </div>
    </div>
  );
};

export default SimpleCameraFeed;