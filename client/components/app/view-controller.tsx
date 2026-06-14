'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { AnimatePresence, motion } from 'motion/react';
import { useSessionContext } from '@livekit/components-react';
import type { AppConfig } from '@/app-config';
import { AgentSessionView_01 } from '@/components/agents-ui/blocks/agent-session-view-01';
import { LobbyView } from '@/components/app/lobby-view';
import { WelcomeView } from '@/components/app/welcome-view';
import type { AgentMode } from '@/lib/agent-mode';
import type { ActivityType, SessionPurpose } from '@/lib/session-activity';

const MotionWelcomeView = motion.create(WelcomeView);
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
  onJoin: (
    participantName: string,
    roomName: string,
    agentMode: AgentMode,
    options?: {
      activityType?: ActivityType;
      evaluationId?: string;
      sessionPurpose?: SessionPurpose;
    }
  ) => void;
  sessionActivityType?: ActivityType;
  sessionNotice?: string | null;
}

export function ViewController({ appConfig, onJoin, sessionNotice }: ViewControllerProps) {
  const { isConnected } = useSessionContext();
  const { resolvedTheme } = useTheme();
  const [showLobby, setShowLobby] = useState(false);
  const agentDisplayName = 'Kate';
  const agentAvatarSrc = '/agents/kate_photo.png';

  return (
    <AnimatePresence mode="wait">
      {/* Welcome view */}
      {!isConnected && !showLobby && (
        <MotionWelcomeView
          key="welcome"
          {...VIEW_MOTION_PROPS}
          startButtonText={appConfig.startButtonText}
          onStartCall={() => setShowLobby(true)}
        />
      )}
      {/* Lobby view */}
      {!isConnected && showLobby && (
        <MotionLobbyView
          key="lobby"
          {...VIEW_MOTION_PROPS}
          onJoin={onJoin}
          sessionNotice={sessionNotice}
        />
      )}
      {/* Session view */}
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
