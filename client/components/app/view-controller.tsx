'use client';

import { useTheme } from 'next-themes';
import { AnimatePresence, motion } from 'motion/react';
import { useSessionContext } from '@livekit/components-react';
import type { AppConfig } from '@/app-config';
import { AgentSessionView_01 } from '@/components/agents-ui/blocks/agent-session-view-01';
import { LobbyView } from '@/components/app/lobby-view';
import { StudentLoginView } from '@/components/app/student-login-view';
import type { AgentMode } from '@/lib/agent-mode';
import type { ActivityType, SessionPurpose } from '@/lib/session-activity';
import type { StudentProfile } from '@/lib/student';

const MotionStudentLoginView = motion.create(StudentLoginView);
const MotionLobbyView = motion.create(LobbyView);
const MotionSessionView = motion.create(AgentSessionView_01);

const VIEW_MOTION_PROPS = {
  variants: {
    visible: { opacity: 1 },
    hidden: { opacity: 0 },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
  transition: {
    duration: 0.5,
    ease: 'linear',
  },
};

interface ViewControllerProps {
  appConfig: AppConfig;
  checkingStudent: boolean;
  onJoin: (
    displayName: string,
    roomName: string,
    agentMode: AgentMode,
    options?: {
      activityType?: ActivityType;
      evaluationId?: string;
      sessionPurpose?: SessionPurpose;
    }
  ) => void;
  onStudentLogin: (student: StudentProfile) => void;
  onStudentLogout: () => void;
  sessionActivityType?: ActivityType;
  sessionNotice?: string | null;
  student: StudentProfile | null;
}

export function ViewController({
  appConfig,
  checkingStudent,
  onJoin,
  onStudentLogin,
  onStudentLogout,
  sessionActivityType,
  sessionNotice,
  student,
}: ViewControllerProps) {
  const { isConnected } = useSessionContext();
  const { resolvedTheme } = useTheme();
  const agentDisplayName = sessionActivityType === 'free_conversation' ? 'Kate' : 'Daisy';
  const agentAvatarSrc =
    sessionActivityType === 'free_conversation'
      ? '/agents/kate_photo.png'
      : '/agents/daisy_photo.png';

  return (
    <AnimatePresence mode="wait">
      {!isConnected && checkingStudent && (
        <motion.div
          key="student-check"
          {...VIEW_MOTION_PROPS}
          className="text-muted-foreground text-sm"
        >
          불러오는 중...
        </motion.div>
      )}
      {!isConnected && !checkingStudent && !student && (
        <MotionStudentLoginView
          key="student-login"
          {...VIEW_MOTION_PROPS}
          onLogin={onStudentLogin}
        />
      )}
      {!isConnected && !checkingStudent && student && (
        <MotionLobbyView
          key="lobby"
          {...VIEW_MOTION_PROPS}
          onJoin={onJoin}
          onLogout={onStudentLogout}
          sessionNotice={sessionNotice}
          student={student}
        />
      )}
      {isConnected && (
        <MotionSessionView
          key="session-view"
          {...VIEW_MOTION_PROPS}
          supportsChatInput={appConfig.supportsChatInput}
          supportsVideoInput={appConfig.supportsVideoInput}
          supportsScreenShare={appConfig.supportsScreenShare}
          isPreConnectBufferEnabled={appConfig.isPreConnectBufferEnabled}
          agentDisplayName={agentDisplayName}
          agentAvatarSrc={agentAvatarSrc}
          audioVisualizerType={appConfig.audioVisualizerType}
          audioVisualizerColor={
            resolvedTheme === 'dark'
              ? appConfig.audioVisualizerColorDark
              : appConfig.audioVisualizerColor
          }
          audioVisualizerColorShift={appConfig.audioVisualizerColorShift}
          audioVisualizerBarCount={appConfig.audioVisualizerBarCount}
          audioVisualizerGridRowCount={appConfig.audioVisualizerGridRowCount}
          audioVisualizerGridColumnCount={appConfig.audioVisualizerGridColumnCount}
          audioVisualizerRadialBarCount={appConfig.audioVisualizerRadialBarCount}
          audioVisualizerRadialRadius={appConfig.audioVisualizerRadialRadius}
          audioVisualizerWaveLineWidth={appConfig.audioVisualizerWaveLineWidth}
          className="fixed inset-0"
        />
      )}
    </AnimatePresence>
  );
}
