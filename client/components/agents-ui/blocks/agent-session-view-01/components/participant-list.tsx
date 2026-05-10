'use client';

import { ParticipantKind } from 'livekit-client';
import {
  useLocalParticipant,
  useParticipants,
  useSpeakingParticipants,
} from '@livekit/components-react';
import { cn } from '@/lib/shadcn/utils';

export function ParticipantList() {
  const participants = useParticipants();
  const speakingParticipants = useSpeakingParticipants();
  const { localParticipant } = useLocalParticipant();

  const speakingIds = new Set(speakingParticipants.map((p) => p.identity));

  const humans = participants.filter((p) => p.kind !== ParticipantKind.AGENT);
  const agents = participants.filter((p) => p.kind === ParticipantKind.AGENT);

  return (
    <div className="bg-background/80 border-border absolute top-4 right-4 z-50 max-w-[220px] min-w-[160px] rounded-xl border px-3 py-2 backdrop-blur-sm">
      <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
        참가자 {humans.length}명
      </p>
      <ul className="flex flex-col gap-1">
        {/* 사람 참가자 */}
        {humans.map((p) => {
          const isSpeaking = speakingIds.has(p.identity);
          const isLocal = p.identity === localParticipant.identity;
          return (
            <li key={p.identity} className="flex items-center gap-2">
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full transition-colors duration-200',
                  isSpeaking
                    ? 'bg-green-400 shadow-[0_0_6px_1px_rgba(74,222,128,0.6)]'
                    : 'bg-muted-foreground/40'
                )}
              />
              <span className="text-foreground truncate text-xs font-medium">
                {p.name || p.identity}
                {isLocal && <span className="text-muted-foreground ml-1 font-normal">(나)</span>}
              </span>
            </li>
          );
        })}

        {/* 에이전트 구분선 */}
        {agents.length > 0 && humans.length > 0 && <li className="border-border my-1 border-t" />}

        {/* AI 에이전트 */}
        {agents.map((p) => {
          const isSpeaking = speakingIds.has(p.identity);
          return (
            <li key={p.identity} className="flex items-center gap-2">
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full transition-colors duration-200',
                  isSpeaking
                    ? 'bg-primary shadow-[0_0_6px_1px_rgba(0,44,242,0.5)]'
                    : 'bg-muted-foreground/40'
                )}
              />
              <span className="text-muted-foreground truncate text-xs font-medium">Daisy</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
