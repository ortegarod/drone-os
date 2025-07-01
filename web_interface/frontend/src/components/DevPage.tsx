import React, { useState, useEffect } from 'react';
// @ts-ignore
import ROSLIB from 'roslib';

interface DevPageProps {
  ros: any;
  isConnected: boolean;
}

interface TopicInfo {
  name: string;
  type: string;
  publisherCount: number;
  subscriberCount: number;
}

interface ServiceInfo {
  name: string;
  type: string;
}

const DevPage: React.FC<DevPageProps> = ({ ros, isConnected }) => {
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [topicMessages, setTopicMessages] = useState<any[]>([]);
  const [subscribedTopic, setSubscribedTopic] = useState<any>(null);

  // Fetch topics and services via rosbridge
  const refreshRosData = async () => {
    if (!ros || !isConnected) return;
    
    setIsLoading(true);
    console.log('[DevPage] Starting ROS data refresh via rosbridge...');
    
    try {
      // Get topics with types
      const getTopicsService = new ROSLIB.Service({
        ros: ros,
        name: '/rosapi/topics_and_raw_types',
        serviceType: 'rosapi_msgs/srv/TopicsAndRawTypes'
      });

      const topicsRequest = new ROSLIB.ServiceRequest({});
      getTopicsService.callService(topicsRequest, (result: any) => {
        console.log('[DevPage] Received topics:', result.topics?.length || 0);
        const topicInfos: TopicInfo[] = [];
        
        if (result.topics && result.types) {
          for (let i = 0; i < result.topics.length; i++) {
            topicInfos.push({
              name: result.topics[i],
              type: result.types[i] || 'unknown',
              publisherCount: 0,
              subscriberCount: 0
            });
          }
        }
        
        setTopics(topicInfos.sort((a, b) => a.name.localeCompare(b.name)));
      }, (error: any) => {
        console.error('[DevPage] Failed to get topics:', error);
        
        // Fallback to basic topics service
        const basicTopicsService = new ROSLIB.Service({
          ros: ros,
          name: '/rosapi/topics',
          serviceType: 'rosapi_msgs/srv/Topics'
        });
        
        basicTopicsService.callService(topicsRequest, (result: any) => {
          console.log('[DevPage] Fallback topics received:', result.topics?.length || 0);
          const topicInfos: TopicInfo[] = (result.topics || []).map((topic: string) => ({
            name: topic,
            type: 'unknown',
            publisherCount: 0,
            subscriberCount: 0
          }));
          setTopics(topicInfos.sort((a, b) => a.name.localeCompare(b.name)));
        }, (error: any) => {
          console.error('[DevPage] Failed to get basic topics:', error);
        });
      });

      // Get services
      const getServicesService = new ROSLIB.Service({
        ros: ros,
        name: '/rosapi/services',
        serviceType: 'rosapi_msgs/srv/Services'
      });

      const servicesRequest = new ROSLIB.ServiceRequest({});
      getServicesService.callService(servicesRequest, (result: any) => {
        console.log('[DevPage] Received services:', result.services?.length || 0);
        
        const serviceInfos: ServiceInfo[] = (result.services || []).map((serviceName: string) => ({
          name: serviceName,
          type: 'unknown' // Could add individual type lookups later if needed
        }));
        
        setServices(serviceInfos.sort((a, b) => a.name.localeCompare(b.name)));
      }, (error: any) => {
        console.error('[DevPage] Failed to get services:', error);
      });

    } catch (error) {
      console.error('[DevPage] Error refreshing ROS data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Subscribe to a topic to see its data
  const subscribeToTopic = (topicName: string, messageType: string) => {
    // Unsubscribe from previous topic
    if (subscribedTopic) {
      subscribedTopic.unsubscribe();
    }

    setSelectedTopic(topicName);
    setTopicMessages([]);

    try {
      const topic = new (ROSLIB as any).Topic({
        ros: ros,
        name: topicName,
        messageType: messageType
      });

      const subscription = topic.subscribe((message: any) => {
        setTopicMessages(prev => [...prev, {
          timestamp: new Date().toLocaleTimeString(),
          data: message
        }]);
      });

      setSubscribedTopic(subscription);
      console.log('[DevPage] Subscribed to topic:', topicName);
    } catch (error) {
      console.error('[DevPage] Failed to subscribe to topic:', error);
      setTopicMessages([{ error: `Failed to subscribe: ${error}`, timestamp: new Date().toLocaleTimeString() }]);
    }
  };

  // Unsubscribe from current topic
  const unsubscribeFromTopic = () => {
    if (subscribedTopic) {
      subscribedTopic.unsubscribe();
      setSubscribedTopic(null);
      console.log('[DevPage] Unsubscribed from topic');
    }
    setSelectedTopic(null);
    setTopicMessages([]);
  };

  // Auto-refresh on connection
  useEffect(() => {
    if (isConnected && ros) {
      refreshRosData();
    }
  }, [ros, isConnected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (subscribedTopic) {
        subscribedTopic.unsubscribe();
      }
    };
  }, []);

  // Filter topics and services
  const filteredTopics = topics.filter(topic => 
    topic.name.toLowerCase().includes(filter.toLowerCase()) ||
    topic.type.toLowerCase().includes(filter.toLowerCase())
  );

  const filteredServices = services.filter(service => 
    service.name.toLowerCase().includes(filter.toLowerCase()) ||
    service.type.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ padding: '1rem', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>🔧 Developer Console</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Filter topics/services..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              padding: '0.5rem',
              backgroundColor: '#2d2d2d',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              minWidth: '200px'
            }}
          />
          <button 
            className="btn secondary"
            onClick={refreshRosData}
            disabled={!isConnected || isLoading}
            style={{ padding: '0.5rem 1rem' }}
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {!isConnected && (
        <div style={{ 
          padding: '2rem', 
          textAlign: 'center', 
          backgroundColor: '#4d2d2d', 
          borderRadius: '4px',
          marginBottom: '1rem'
        }}>
          <strong>Not connected to rosbridge</strong>
          <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#ccc' }}>
            Connect to rosbridge to explore ROS2 topics and services
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', height: 'calc(100% - 100px)' }}>
        
        {/* Topics Column */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2>📡 Topics ({filteredTopics.length})</h2>
          <div style={{ 
            flex: 1, 
            overflow: 'auto', 
            backgroundColor: '#2d2d2d', 
            borderRadius: '4px', 
            padding: '0.5rem' 
          }}>
            {filteredTopics.map(topic => (
              <div
                key={topic.name}
                style={{
                  padding: '0.5rem',
                  marginBottom: '0.5rem',
                  backgroundColor: selectedTopic === topic.name ? '#4d4d4d' : '#3d3d3d',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: selectedTopic === topic.name ? '1px solid #00ff88' : '1px solid transparent'
                }}
                onClick={() => subscribeToTopic(topic.name, topic.type)}
              >
                <div style={{ fontWeight: 'bold', fontSize: '0.875rem' }}>
                  {topic.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#888' }}>
                  {topic.type}
                </div>
              </div>
            ))}
            {filteredTopics.length === 0 && !isLoading && (
              <div style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
                {isConnected ? 'No topics found' : 'Connect to rosbridge to see topics'}
              </div>
            )}
          </div>
        </div>

        {/* Services Column */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2>⚙️ Services ({filteredServices.length})</h2>
          <div style={{ 
            flex: 1, 
            overflow: 'auto', 
            backgroundColor: '#2d2d2d', 
            borderRadius: '4px', 
            padding: '0.5rem' 
          }}>
            {filteredServices.map(service => (
              <div
                key={service.name}
                style={{
                  padding: '0.5rem',
                  marginBottom: '0.5rem',
                  backgroundColor: '#3d3d3d',
                  borderRadius: '4px'
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: '0.875rem' }}>
                  {service.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#888' }}>
                  {service.type}
                </div>
              </div>
            ))}
            {filteredServices.length === 0 && !isLoading && (
              <div style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
                {isConnected ? 'No services found' : 'Connect to rosbridge to see services'}
              </div>
            )}
          </div>
        </div>

        {/* Topic Data Column */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h2>📊 Topic Data</h2>
            {selectedTopic && (
              <button
                className="btn danger"
                onClick={unsubscribeFromTopic}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                Unsubscribe
              </button>
            )}
          </div>
          
          <div style={{ 
            flex: 1, 
            overflow: 'auto', 
            backgroundColor: '#2d2d2d', 
            borderRadius: '4px', 
            padding: '1rem' 
          }}>
            {selectedTopic ? (
              <div>
                <div style={{ marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid #555' }}>
                  <strong>Subscribed to:</strong> {selectedTopic}
                  {subscribedTopic && <span style={{ color: '#00ff88', marginLeft: '0.5rem' }}>● LIVE</span>}
                </div>
                
                {topicMessages.length > 0 ? (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.5rem' }}>
                      Messages received: {topicMessages.length}
                    </div>
                    <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                      {topicMessages.map((msg, index) => (
                        <div key={index} style={{ marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid #444' }}>
                          {msg.error ? (
                            <div style={{ color: '#ff4444' }}>
                              <strong>Error:</strong> {msg.error}
                            </div>
                          ) : (
                            <div>
                              <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.5rem' }}>
                                #{index + 1} - {msg.timestamp}
                              </div>
                              <pre style={{
                                backgroundColor: '#1d1d1d',
                                padding: '0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                overflow: 'auto',
                                color: '#ccc'
                              }}>
                                {JSON.stringify(msg.data, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
                    Waiting for data...
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
                Click on a topic to subscribe and view live data
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DevPage;