'use client';

import { type ComponentProps } from 'react';
import Image from 'next/image';
import { AnimatePresence } from 'motion/react';
import { type AgentState, type ReceivedMessage } from '@livekit/components-react';
import { AgentChatIndicator } from '@/components/agents-ui/agent-chat-indicator';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';

/**
 * Props for the AgentChatTranscript component.
 */
export interface AgentChatTranscriptProps extends ComponentProps<'div'> {
  /**
   * The current state of the agent. When 'thinking', displays a loading indicator.
   */
  agentState?: AgentState;
  /**
   * Array of messages to display in the transcript.
   * @defaultValue []
   */
  messages?: ReceivedMessage[];
  /**
   * Additional CSS class names to apply to the conversation container.
   */
  className?: string;
  /** Display name used for assistant transcript avatars. */
  agentDisplayName?: string;
  /** Public image path used for assistant transcript avatars. */
  agentAvatarSrc?: string;
}

/**
 * A chat transcript component that displays a conversation between the user and agent.
 * Shows messages with timestamps and origin indicators, plus a thinking indicator
 * when the agent is processing.
 *
 * @extends ComponentProps<'div'>
 *
 * @example
 * ```tsx
 * <AgentChatTranscript
 *   agentState={agentState}
 *   messages={chatMessages}
 * />
 * ```
 */
export function AgentChatTranscript({
  agentState,
  messages = [],
  className,
  agentDisplayName = 'Kate',
  agentAvatarSrc = '/agents/kate_photo.png',
  ...props
}: AgentChatTranscriptProps) {
  return (
    <Conversation className={className} {...props}>
      <ConversationContent>
        {messages.map((receivedMessage) => {
          const { id, timestamp, from, message } = receivedMessage;
          const locale = navigator?.language ?? 'en-US';
          const messageOrigin = from?.isLocal ? 'user' : 'assistant';
          const time = new Date(timestamp);
          const title = time.toLocaleTimeString(locale, { timeStyle: 'full' });

          return (
            <Message key={id} title={title} from={messageOrigin}>
              {messageOrigin === 'assistant' ? (
                <div className="flex max-w-full items-start gap-3">
                  <Image
                    src={agentAvatarSrc}
                    alt={agentDisplayName}
                    width={32}
                    height={32}
                    className="border-border mt-0.5 size-8 shrink-0 rounded-full border object-cover"
                  />
                  <MessageContent>
                    <MessageResponse>{message}</MessageResponse>
                  </MessageContent>
                </div>
              ) : (
                <MessageContent>
                  <MessageResponse>{message}</MessageResponse>
                </MessageContent>
              )}
            </Message>
          );
        })}
        <AnimatePresence>
          {agentState === 'thinking' && (
            <div className="flex items-start gap-3">
              <Image
                src={agentAvatarSrc}
                alt={agentDisplayName}
                width={32}
                height={32}
                className="border-border mt-0.5 size-8 shrink-0 rounded-full border object-cover"
              />
              <AgentChatIndicator size="sm" />
            </div>
          )}
        </AnimatePresence>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
