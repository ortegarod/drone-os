import React, { useState, useRef, useEffect } from 'react';
import { DroneStatus } from '../types/drone';
import './AIInterface.css';

interface AIInterfaceProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  onCommandUpdate?: (update: any) => void;
}

interface Message {
  role: 'user' | 'assistant' | 'error';
  text: string;
}

const ENDPOINT = '/api/openclaw/chat';

const AIInterface: React.FC<AIInterfaceProps> = ({ onCommandUpdate }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState('');
  const [agent, setAgent] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  useEffect(() => {
    fetch('/api/openclaw/status').then(r => r.json()).then(d => {
      if (d?.model) setModel(d.model);
      if (d?.agent) setAgent(d.agent);
    }).catch(() => {});
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_key: 'main' }),
      });
      const data = await res.json();
      const reply = data?.text || data?.error || 'No response';

      // Try to parse structured response for command overlay
      try {
        const parsed = JSON.parse(reply);
        if (parsed && typeof parsed === 'object') {
          onCommandUpdate?.({
            state: parsed.state, message: parsed.message,
            target: parsed.target, mode: parsed.status?.mode, armed: parsed.status?.armed,
          });
        }
      } catch { /* not JSON, that's fine */ }

      setMessages(prev => [...prev, { role: 'assistant', text: reply }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'error', text: e.message || 'Request failed' }]);
    }
    setLoading(false);
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat-header">
        <span>{agent || 'AI'}</span>
        {model && <span className="ai-chat-model">{model}</span>}
        <span className="ai-chat-session">main session</span>
      </div>
      <div className="ai-chat-messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}`}>
            <span className="ai-msg-role">{m.role === 'user' ? '>' : m.role === 'error' ? '!' : '◆'}</span>
            <span className="ai-msg-text">{m.text}</span>
          </div>
        ))}
        {loading && <div className="ai-msg ai-msg-assistant"><span className="ai-msg-role">◆</span><span className="ai-msg-text ai-thinking">thinking…</span></div>}
      </div>
      <div className="ai-chat-input">
        <span className="ai-prompt">{'>'}</span>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="command…"
          disabled={loading}
        />
      </div>
    </div>
  );
};

export default AIInterface;
