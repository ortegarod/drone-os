export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class OpenClawChatClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(msg: ChatMessage) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private runWaiters = new Map<string, { resolve: (text: string) => void; reject: (err: Error) => void; text: string }>();
  private token?: string;
  public sessionKey = 'main';

  constructor(private gatewayUrl: string) {
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('openclaw.gateway.token') || undefined;
    }
  }

  onMessage(cb: (msg: ChatMessage) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStatus(cb: (connected: boolean) => void) {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus(v: boolean) {
    this.statusListeners.forEach((l) => l(v));
  }

  private emitMessage(msg: ChatMessage) {
    this.listeners.forEach((l) => l(msg));
  }

  async connect() {
    this.ws = new WebSocket(this.gatewayUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('socket not created'));

      this.ws.onopen = () => {
        this.request('connect', {
          minProtocol: 2,
          maxProtocol: 3,
          client: {
            id: 'webchat-ui',
            displayName: 'DroneOS Web UI',
            version: 'dev',
            platform: navigator.userAgent,
            mode: 'webchat'
          },
          auth: this.token ? { token: this.token } : undefined
        })
          .then((res) => {
            const sk = res?.payload?.snapshot?.sessionDefaults?.mainSessionKey;
            if (sk) this.sessionKey = sk;
            this.emitStatus(true);
            resolve();
          })
          .catch(reject);
      };

      this.ws.onmessage = (e) => this.handleIncoming(e.data);
      this.ws.onerror = () => {
        this.emitStatus(false);
      };
      this.ws.onclose = () => {
        this.emitStatus(false);
      };
    });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  async history(limit = 20) {
    const res = await this.request('chat.history', { sessionKey: this.sessionKey, limit });
    const items = (res?.payload?.messages || []) as any[];
    return items
      .filter((m) => m?.role === 'user' || m?.role === 'assistant')
      .map((m, i) => ({
        id: `h-${i}-${Date.now()}`,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        timestamp: Date.now()
      })) as ChatMessage[];
  }

  async send(message: string) {
    return this.request('chat.send', {
      sessionKey: this.sessionKey,
      message,
      idempotencyKey: `webui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deliver: false
    });
  }

  async sendAndWait(message: string) {
    const res = await this.send(message);
    const runId = res?.payload?.runId;
    if (!runId) {
      throw new Error('chat.send ack missing runId');
    }

    return new Promise<string>((resolve, reject) => {
      this.runWaiters.set(runId, { resolve, reject, text: '' });
      setTimeout(() => {
        if (this.runWaiters.has(runId)) {
          this.runWaiters.delete(runId);
          reject(new Error('chat run timeout'));
        }
      }, 45000);
    });
  }

  async abort() {
    return this.request('chat.abort', { sessionKey: this.sessionKey });
  }

  private request(method: string, params?: any) {
    return new Promise<any>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('gateway not connected'));
        return;
      }
      const id = `${method}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  private handleIncoming(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'res') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(msg?.error?.message || 'request failed'));
      return;
    }

    if (msg.type === 'event' && msg.event === 'chat') {
      const p = msg.payload || {};
      const waiter = p.runId ? this.runWaiters.get(p.runId) : undefined;

      if (p.state === 'delta' && typeof p.message === 'string') {
        if (waiter) waiter.text += p.message;
        this.emitMessage({ id: `run-${p.runId}`, role: 'assistant', content: p.message, timestamp: Date.now() });
      } else if (p.state === 'final' && p.message) {
        const finalText = typeof p.message === 'string' ? p.message : JSON.stringify(p.message);
        if (waiter) {
          this.runWaiters.delete(p.runId);
          waiter.resolve(finalText || waiter.text);
        }
        this.emitMessage({ id: `run-${p.runId}:final`, role: 'assistant', content: finalText, timestamp: Date.now() });
      } else if (p.state === 'error') {
        if (waiter) {
          this.runWaiters.delete(p.runId);
          waiter.reject(new Error(p.errorMessage || 'Agent error'));
        }
        this.emitMessage({ id: `run-${p.runId}:error`, role: 'system', content: p.errorMessage || 'Agent error', timestamp: Date.now() });
      } else if (p.state === 'aborted') {
        if (waiter) {
          this.runWaiters.delete(p.runId);
          waiter.reject(new Error('Agent run aborted'));
        }
      }
    }
  }
}
