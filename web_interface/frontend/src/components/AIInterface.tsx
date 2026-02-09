import React, { useState, useRef, useEffect } from 'react';
import { DroneStatus } from '../types/drone';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

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
    <Card className="h-full border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle>AI Assistant</CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-56px)] flex flex-col gap-2 p-3 pt-0">
        <div className="flex-1 overflow-y-auto rounded-md border border-border bg-[#2a2f38] p-2 min-h-0">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`mb-2 rounded-md p-2 text-sm ${message.type === 'user' ? 'bg-[#2f6fb2] text-white ml-8' : 'bg-[#3a4250] text-white mr-8'}`}
            >
              <div className="mb-1 text-[11px] opacity-70">
                {message.type === 'user' ? 'You' : 'AI Assistant'} • {formatTime(message.timestamp)}
              </div>
              <div>{message.content}</div>
            </div>
          ))}

          {isLoading && (
            <div className="mb-2 rounded-md bg-[#3a4250] p-2 text-sm text-white mr-8">
              <div className="mb-1 text-[11px] opacity-70">AI Assistant • {formatTime(new Date())}</div>
              <div className="italic opacity-80">Processing...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            className="flex-1 rounded-md border border-border bg-[#252b35] text-white p-2 text-sm min-h-[64px]"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask me to control the drone..."
            disabled={isLoading}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <Button type="submit" disabled={!inputMessage.trim() || isLoading} className="h-10 w-20">
            {isLoading ? '...' : 'Send'}
          </Button>
        </form>

        <div className="rounded-md border border-border bg-[#2a2f38] p-2 text-xs text-[#cbd5e1]">
          <div>Drone: {droneStatus.drone_name || 'No drone selected'}</div>
          <div>Status: {droneStatus.armed ? 'Armed' : 'Disarmed'} • {droneStatus.flight_mode}</div>
          <div>Position: ({droneStatus.position.x.toFixed(1)}, {droneStatus.position.y.toFixed(1)}, {droneStatus.position.z.toFixed(1)})</div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AIInterface;