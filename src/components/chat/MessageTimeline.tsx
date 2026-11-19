import { useEffect, useMemo, useRef } from "react";
import type { MessageDto } from "../../lib/types";
import { buildTimelineItems } from "../../lib/ui-polish";
import { MessageBubble } from "./MessageBubble";

interface MessageTimelineProps {
  messages: MessageDto[];
  currentUserId: string;
  highlightedMessageId: string | null;
  onEditMessage: (messageId: string, newText: string) => Promise<void>;
  onRemoveMessage: (messageId: string) => Promise<void>;
  onReplyMessage: (message: MessageDto) => void;
  onTogglePinMessage: (message: MessageDto) => Promise<void>;
  onJumpToMessage: (messageId: string) => void;
}

export function MessageTimeline({
  messages,
  currentUserId,
  highlightedMessageId,
  onEditMessage,
  onRemoveMessage,
  onReplyMessage,
  onTogglePinMessage,
  onJumpToMessage,
}: MessageTimelineProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const timelineItems = useMemo(() => buildTimelineItems(messages), [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {timelineItems.length === 0 ? (
        <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)]">
          Messages are end-to-end encrypted before leaving your Windows device.
        </div>
      ) : (
        timelineItems.map((item) =>
          item.kind === "epoch_divider" ? (
            <div
              key={item.id}
              className="my-4 first:mt-0 flex items-center gap-3 text-xs text-[var(--text-muted)]"
            >
              <div className="flex-1 h-px bg-[var(--border-hairline)]" />
              <span className="px-2.5 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-hairline)] font-medium">
                {item.label}
              </span>
              <div className="flex-1 h-px bg-[var(--border-hairline)]" />
            </div>
          ) : (
            <MessageBubble
              key={item.message.id}
              message={item.message}
              isOwn={item.message.sender_id === currentUserId}
              isGroupedWithPrev={item.isGroupedWithPrev}
              isHighlighted={highlightedMessageId === item.message.id}
              onEdit={onEditMessage}
              onRemove={onRemoveMessage}
              onReply={onReplyMessage}
              onTogglePin={onTogglePinMessage}
              onJumpToMessage={onJumpToMessage}
            />
          )
        )
      )}
      <div ref={bottomRef} />
    </div>
  );
}
