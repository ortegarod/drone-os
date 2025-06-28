import React, { useState, useRef, useEffect } from 'react';
import { DroneStatus } from '../App';

interface AIMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AIInterfaceProps {
  droneAPI: any;
  droneStatus: DroneStatus;
}

const AIInterface: React.FC<AIInterfaceProps> = ({ droneAPI, droneStatus }) => {
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: '1',
      type: 'assistant',
      content: 'AI Assistant ready. I can help you control the drone using natural language commands.',
      timestamp: new Date()
    }
  ]);
  
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addMessage = (type: 'user' | 'assistant', content: string) => {
    const newMessage: AIMessage = {
      id: Date.now().toString(),
      type,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    
    // Add user message
    addMessage('user', userMessage);
    
    setIsLoading(true);
    
    try {
      // Simple response for now - this would connect to the AI agent system
      addMessage('assistant', 'AI agent system not yet connected. Use the Manual Controls panel for drone operations.');
    } catch (error) {
      addMessage('assistant', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="ai-chat">
      <h2>AI Assistant</h2>
      
      {/* Chat Messages */}
      <div className="ai-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`ai-message ${message.type}`}
          >
            <div style={{ 
              fontSize: '0.75rem', 
              opacity: 0.7, 
              marginBottom: '0.25rem' 
            }}>
              {message.type === 'user' ? 'You' : 'AI Assistant'} • {formatTime(message.timestamp)}
            </div>
            <div>{message.content}</div>
          </div>
        ))}
        
        {isLoading && (
          <div className="ai-message assistant">
            <div style={{ 
              fontSize: '0.75rem', 
              opacity: 0.7, 
              marginBottom: '0.25rem' 
            }}>
              AI Assistant • {formatTime(new Date())}
            </div>
            <div style={{ fontStyle: 'italic', opacity: 0.8 }}>
              🤖 Processing...
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="ai-input-area">
        <textarea
          className="ai-input"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Ask me to control the drone: 'arm the drone', 'take off', 'fly to coordinates 10,5,15'..."
          disabled={isLoading}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={!inputMessage.trim() || isLoading}
          style={{ minWidth: '60px', height: 'fit-content' }}
        >
          {isLoading ? '...' : 'Send'}
        </button>
      </form>

      {/* Status */}
      <div style={{ 
        marginTop: '1rem', 
        padding: '0.75rem', 
        backgroundColor: '#3d3d3d', 
        borderRadius: '4px',
        fontSize: '0.75rem'
      }}>
        <div style={{ marginBottom: '0.5rem', fontWeight: 'bold' }}>Current Context:</div>
        <div>Drone: {droneStatus.drone_name}</div>
        <div>Status: {droneStatus.armed ? 'Armed' : 'Disarmed'} • {droneStatus.flight_mode}</div>
        <div>Position: ({droneStatus.position.x.toFixed(1)}, {droneStatus.position.y.toFixed(1)}, {droneStatus.position.z.toFixed(1)})</div>
      </div>
    </div>
  );
};

export default AIInterface;