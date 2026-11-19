import { useEffect, useRef } from "react";
import type { MessageDto } from "../../lib/types";
import { MessageBubble } from "./MessageBubble";

interface MessageTimelineProps {
  messages: MessageDto[];
  currentUserId: string;
  onEditMessage: (messageId: string, newText: string) => Promise<void>;
  onRemoveMessage: (messageId: string) => Promise<void>;
}

export function MessageTimeline({
  messages,
  currentUserId,
  onEditMessage,
  onRemoveMessage,
}: MessageTimelineProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
      {messages.length === 0 ? (
        <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)]">
          Messages are end-to-end encrypted before leaving your Windows device.
        </div>
      ) : (
        messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.sender_id === currentUserId}
            onEdit={onEditMessage}
            onRemove={onRemoveMessage}
          />
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
