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
import {
  type AgentCharacter,
  KATE_CHARACTER,
  normalizeAgentCharacter,
} from '@/lib/agent-character';
import type { AgentMode } from '@/lib/agent-mode';
import type { ActivityType, SessionPurpose } from '@/lib/session-activity';
import type { StudentProfile } from '@/lib/student';
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
    displayName: string;
    roomName: string;
    agentMode: AgentMode;
    activityType?: ActivityType;
    agentCharacter?: AgentCharacter;
    evaluationId?: string;
    sessionPurpose?: SessionPurpose;
  } | null>(null);
  const hadConnectedSessionRef = useRef(false);
  const [, forceRender] = useState(0);
  const [room, setRoom] = useState(() => new Room());
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [checkingStudent, setCheckingStudent] = useState(true);
  const [sessionAgentCharacter, setSessionAgentCharacter] =
    useState<AgentCharacter>(KATE_CHARACTER);

  useEffect(() => {
    let cancelled = false;
    async function loadStudent() {
      try {
        const res = await fetch('/api/student/me', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.student) setStudent(data.student);
      } catch {
        // ignore; the login screen handles missing sessions
      } finally {
        if (!cancelled) setCheckingStudent(false);
      }
    }
    void loadStudent();
    return () => {
      cancelled = true;
    };
  }, []);

  const tokenSource = useMemo(() => {
    if (typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string') {
      return getSandboxTokenSource(appConfig);
    }
    return TokenSource.custom(async () => {
      const info = sessionInfoRef.current;
      if (!student || !info?.displayName || !info.roomName) {
        throw new Error('세션 정보가 준비되지 않았습니다.');
      }
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: info.displayName,
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
      const data = await res.json();
      setSessionAgentCharacter(normalizeAgentCharacter(data.agentCharacter));
      return data;
    });
  }, [appConfig, student]);

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
    setSessionAgentCharacter(KATE_CHARACTER);
    setSessionNotice('이전 세션이 종료되었습니다. 최신 설정으로 다시 입장해주세요.');
    setRoom(new Room());
    forceRender((n) => n + 1);
  }, [session.isConnected]);

  const handleJoin = useCallback(
    (
      displayName: string,
      roomName: string,
      agentMode: AgentMode,
      options?: {
        activityType?: ActivityType;
        agentCharacter?: AgentCharacter;
        evaluationId?: string;
        sessionPurpose?: SessionPurpose;
      }
    ) => {
      sessionInfoRef.current = { displayName, roomName, agentMode, ...options };
      setSessionAgentCharacter(options?.agentCharacter ?? KATE_CHARACTER);
      setSessionNotice(null);
      forceRender((n) => n + 1);
      void session.start({ tracks: { microphone: { enabled: false } } }).catch((error) => {
        const message = error instanceof Error ? error.message : '세션 입장에 실패했습니다.';
        sessionInfoRef.current = null;
        setSessionAgentCharacter(KATE_CHARACTER);
        setSessionNotice(message);
        setRoom(new Room());
        forceRender((n) => n + 1);
      });
    },
    [session]
  );

  const handleStudentLogout = useCallback(() => {
    void fetch('/api/student/logout', { method: 'POST' }).finally(() => {
      sessionInfoRef.current = null;
      setSessionAgentCharacter(KATE_CHARACTER);
      setStudent(null);
      setSessionNotice(null);
      setRoom(new Room());
      forceRender((n) => n + 1);
    });
  }, []);

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />
      <main className="grid h-svh grid-cols-1 place-content-center place-items-center">
        <ViewController
          appConfig={appConfig}
          checkingStudent={checkingStudent}
          onJoin={handleJoin}
          onStudentLogin={setStudent}
          onStudentLogout={handleStudentLogout}
          sessionAgentCharacter={sessionAgentCharacter}
          sessionNotice={sessionNotice}
          student={student}
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
