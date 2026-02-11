import React, { useMemo, useState } from 'react';
import { DroneStatus } from '../types/drone';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  AuiIf
} from '@assistant-ui/react';

interface AIInterfaceProps {
  droneAPI: any;
  droneStatus: DroneStatus;
}

// NOTE: This webpack setup does not polyfill `process` in the browser.
// Keep this runtime-safe by deriving the endpoint from the current location.
const OPENCLAW_HTTP_ENDPOINT = '/api/openclaw/chat';

const UserMessage = () => (
  <MessagePrimitive.Root className="mx-auto w-full max-w-[760px] py-2" data-role="user">
    <div className="ml-8 rounded-md bg-[#2f6fb2] px-3 py-2 text-white">
      <MessagePrimitive.Content />
    </div>
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root className="mx-auto w-full max-w-[760px] py-2" data-role="assistant">
    <div className="mr-8 rounded-md bg-[#3a4250] px-3 py-2 text-white">
      <MessagePrimitive.Content />
    </div>
  </MessagePrimitive.Root>
);

const SystemMessage = () => (
  <MessagePrimitive.Root className="mx-auto w-full max-w-[760px] py-2" data-role="system">
    <div className="rounded-md bg-[#4b5563] px-3 py-2 text-white">
      <MessagePrimitive.Content />
    </div>
  </MessagePrimitive.Root>
);

const AIInterface: React.FC<AIInterfaceProps> = ({ droneStatus }) => {
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

          try {
            const res = await fetch(OPENCLAW_HTTP_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: userText, session_key: sessionKey })
            });

            if (!res.ok) {
              setIsConnected(false);
              yield { content: [{ type: 'text', text: `Error: backend returned ${res.status}` }] };
              return;
            }

            const data = await res.json();
            if (data?.sessionKey) setSessionKey(data.sessionKey);
            setIsConnected(Boolean(data?.ok));

            yield { content: [{ type: 'text', text: data?.text || data?.error || 'No response.' }] };
          } catch (e: any) {
            setIsConnected(false);
            yield { content: [{ type: 'text', text: `Error: ${e?.message || 'failed'}` }] };
          }
        }
      }),
      [sessionKey]
    )
  );

  return (
    <div className="h-full min-h-0 flex flex-col">
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex h-full flex-col">
          <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto p-2">
            <ThreadPrimitive.Messages
              components={{
                UserMessage: ({ children }: any) => (
                  <MessagePrimitive.Root className="py-2" data-role="user">
                    <MessagePrimitive.Content />
                    {children}
                  </MessagePrimitive.Root>
                ),
                AssistantMessage: ({ children }: any) => (
                  <MessagePrimitive.Root className="py-2" data-role="assistant">
                    <MessagePrimitive.Content />
                    {children}
                  </MessagePrimitive.Root>
                ),
                SystemMessage: ({ children }: any) => (
                  <MessagePrimitive.Root className="py-2" data-role="system">
                    <MessagePrimitive.Content />
                    {children}
                  </MessagePrimitive.Root>
                )
              }}
            />
          </ThreadPrimitive.Viewport>

          <ComposerPrimitive.Root className="border-t border-border p-2">
            <div className="flex items-end gap-2">
              <ComposerPrimitive.Input
                placeholder={isConnected ? 'Message…' : 'Offline'}
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
