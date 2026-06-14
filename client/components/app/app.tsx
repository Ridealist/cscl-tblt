'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Room, TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr';
import type { AppConfig } from '@/app-config';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { StartAudioButton } from '@/components/agents-ui/start-audio-button';
import { ViewController } from '@/components/app/view-controller';
import { Toaster } from '@/components/ui/sonner';
import { useAgentErrors } from '@/hooks/useAgentErrors';
import { useDebugMode } from '@/hooks/useDebug';
import type { AgentMode } from '@/lib/agent-mode';
import type { ActivityType, SessionPurpose } from '@/lib/session-activity';
import { getSandboxTokenSource } from '@/lib/utils';

const IN_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function AppSetup() {
  useDebugMode({ enabled: IN_DEVELOPMENT });
  useAgentErrors();

  return null;
}

interface AppProps {
  appConfig: AppConfig;
}

export function App({ appConfig }: AppProps) {
  const sessionInfoRef = useRef<{
    participantName: string;
    roomName: string;
    agentMode: AgentMode;
    activityType?: ActivityType;
    evaluationId?: string;
    sessionPurpose?: SessionPurpose;
  } | null>(null);
  const hadConnectedSessionRef = useRef(false);
  const [, forceRender] = useState(0);
  const [room, setRoom] = useState(() => new Room());
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const tokenSource = useMemo(() => {
    if (typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string') {
      return getSandboxTokenSource(appConfig);
    }
    return TokenSource.custom(async () => {
      const info = sessionInfoRef.current;
      if (!info) {
        throw new Error(
          '세션 정보가 아직 준비되지 않았습니다. 활동 선택 화면에서 다시 입장해주세요.'
        );
      }

      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_name: info.participantName,
          room_name: info.roomName,
          agent_mode: info.agentMode,
          ...(info.activityType ? { activity_type: info.activityType } : {}),
          ...(info.sessionPurpose ? { session_purpose: info.sessionPurpose } : {}),
          ...(info.evaluationId ? { evaluation_id: info.evaluationId } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message =
          typeof data.error === 'string' ? data.error : '세션 입장 준비에 실패했습니다.';
        throw new Error(message);
      }
      return res.json();
    });
  }, [appConfig]);

  const sessionOptions = useMemo(
    () => ({
      room,
      ...(appConfig.agentName ? { agentName: appConfig.agentName } : {}),
    }),
    [appConfig.agentName, room]
  );
  const session = useSession(tokenSource, sessionOptions);

  useEffect(() => {
    if (session.isConnected) {
      hadConnectedSessionRef.current = true;
      setSessionNotice(null);
      return;
    }

    if (!hadConnectedSessionRef.current) return;
    hadConnectedSessionRef.current = false;
    sessionInfoRef.current = null;
    setSessionNotice('이전 세션이 종료되었습니다. 최신 설정으로 다시 입장해주세요.');
    setRoom(new Room());
    forceRender((n) => n + 1);
  }, [session.isConnected]);

  const handleJoin = useCallback(
    (
      participantName: string,
      roomName: string,
      agentMode: AgentMode,
      options?: {
        activityType?: ActivityType;
        evaluationId?: string;
        sessionPurpose?: SessionPurpose;
      }
    ) => {
      sessionInfoRef.current = { participantName, roomName, agentMode, ...options };
      setSessionNotice(null);
      forceRender((n) => n + 1);
      void session.start({ tracks: { microphone: { enabled: false } } }).catch((error) => {
        const message = error instanceof Error ? error.message : '세션 입장에 실패했습니다.';
        sessionInfoRef.current = null;
        setSessionNotice(message);
        setRoom(new Room());
        forceRender((n) => n + 1);
      });
    },
    [session]
  );

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />
      <main className="grid h-svh grid-cols-1 place-content-center">
        <ViewController
          appConfig={appConfig}
          onJoin={handleJoin}
          sessionActivityType={sessionInfoRef.current?.activityType}
          sessionNotice={sessionNotice}
        />
      </main>
      <StartAudioButton label="Start Audio" />
      <Toaster
        icons={{
          warning: <WarningIcon weight="bold" />,
        }}
        position="top-center"
        className="toaster group"
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
          } as React.CSSProperties
        }
      />
    </AgentSessionProvider>
  );
}
