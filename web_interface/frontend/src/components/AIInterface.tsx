import React, { useMemo, useState } from 'react';
import { DroneStatus } from '../types/drone';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react';

interface AIInterfaceProps {
  droneAPI: any;
  droneStatus: DroneStatus;
  onCommandUpdate?: (update: {
    state?: string;
    message?: string;
    target?: { label?: string; x?: number; y?: number; z?: number };
    telemetry?: { x?: number; y?: number; z?: number };
    mode?: string;
    armed?: boolean;
  }) => void;
}

const OPENCLAW_HTTP_ENDPOINT = '/api/openclaw/chat';

function parseStructuredResponse(text: string): any | null {
  if (!text || typeof text !== 'string') return null;

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // continue
    }
  }

  return null;
}

function toConciseText(parsed: any, fallback: string): string {
  const msg = parsed?.message;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();

  const state = parsed?.state;
  const intent = parsed?.intent;
  if (intent && state) return `${intent}: ${state}`;
  if (state) return String(state);

  return fallback.split('\n')[0].trim().slice(0, 220) || 'No response.';
}

const AIInterface: React.FC<AIInterfaceProps> = ({ onCommandUpdate }) => {
  const [isConnected, setIsConnected] = useState(true);
  const [sessionKey, setSessionKey] = useState('hook:webui');

  const runtime = useLocalRuntime(
    useMemo(
      () => ({
        run: async function* ({ messages }: any) {
          const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
          const userText =
            lastUser?.content?.find?.((p: any) => p.type === 'text')?.text ||
            lastUser?.content?.[0]?.text ||
            '';

          if (!userText) {
            yield { content: [{ type: 'text', text: 'No input message.' }] };
            return;
          }

          const wiredPrompt = [
            'WEB UI MODE: return concise output.',
            'If command/action related, prefer JSON object with keys:',
            '{"intent","state","message","target":{"label","x","y","z"},"status":{"mode","armed"},"telemetry":{"x","y","z"}}',
            'No emoji. No decorative symbols. Keep message short.',
            '',
            `User command: ${userText}`,
          ].join('\n');

          try {
            const res = await fetch(OPENCLAW_HTTP_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: wiredPrompt, session_key: sessionKey }),
            });

            if (!res.ok) {
              setIsConnected(false);
              yield { content: [{ type: 'text', text: `Error: backend returned ${res.status}` }] };
              return;
            }

            const data = await res.json();
            if (data?.sessionKey) setSessionKey(data.sessionKey);
            setIsConnected(Boolean(data?.ok));

            const rawText = data?.text || data?.error || 'No response.';
            const parsed = parseStructuredResponse(rawText);

            if (parsed) {
              onCommandUpdate?.({
                state: parsed?.state,
                message: parsed?.message,
                target: parsed?.target,
                telemetry: parsed?.telemetry,
                mode: parsed?.status?.mode,
                armed: parsed?.status?.armed,
              });
            }

            yield { content: [{ type: 'text', text: parsed ? toConciseText(parsed, rawText) : rawText }] };
          } catch (e: any) {
            setIsConnected(false);
            yield { content: [{ type: 'text', text: `Error: ${e?.message || 'failed'}` }] };
          }
        },
      }),
      [sessionKey, onCommandUpdate]
    )
  );

  return (
    <div className="h-full min-h-0 flex flex-col">
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex h-full flex-col">
          <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto p-2">
            <ThreadPrimitive.Messages
              components={{
                UserMessage: () => (
                  <MessagePrimitive.Root className="mx-auto w-full max-w-[760px] py-2" data-role="user">
                    <div className="ml-8 rounded-md border border-[#355b83] bg-[#223445] px-3 py-2 text-white">
                      <div className="mb-1 text-xs text-[#8ea4bb]">You</div>
                      <MessagePrimitive.Content />
                    </div>
                  </MessagePrimitive.Root>
                ),
                AssistantMessage: () => (
                  <MessagePrimitive.Root className="mx-auto w-full max-w-[760px] py-2" data-role="assistant">
                    <div className="mr-8 rounded-md border border-[#3a4250] bg-[#1f242d] px-3 py-2 text-white">
                      <div className="mb-1 text-xs text-[#8b949e]">DroneOS</div>
                      <MessagePrimitive.Content />
                    </div>
                  </MessagePrimitive.Root>
                ),
                SystemMessage: () => (
                  <MessagePrimitive.Root className="mx-auto w-full max-w-[760px] py-2" data-role="system">
                    <div className="rounded-md border border-[#4b5563] bg-[#2a313d] px-3 py-2 text-white">
                      <div className="mb-1 text-xs text-[#a1a1aa]">System</div>
                      <MessagePrimitive.Content />
                    </div>
                  </MessagePrimitive.Root>
                ),
              }}
            />
          </ThreadPrimitive.Viewport>

          <ComposerPrimitive.Root className="border-t border-border p-2">
            <div className="flex items-end gap-2">
              <ComposerPrimitive.Input
                placeholder={isConnected ? 'Enter command…' : 'Offline'}
                className="min-h-[40px] flex-1 resize-none rounded-md border border-border bg-[#252b35] p-2 text-sm text-white outline-none"
                rows={1}
                disabled={!isConnected}
              />
              <ComposerPrimitive.Send asChild>
                <button
                  className="h-10 w-20 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                  type="submit"
                  disabled={!isConnected}
                >
                  Send
                </button>
              </ComposerPrimitive.Send>
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
};

export default AIInterface;
