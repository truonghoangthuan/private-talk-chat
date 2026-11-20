import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { MessageDto } from "../../lib/types";
import {
  buildTimelineItems,
  computeScrollFollowState,
  isScrolledNearBottom,
} from "../../lib/ui-polish";
import { MessageBubble } from "./MessageBubble";

interface MessageTimelineProps {
  messages: MessageDto[];
  currentUserId: string;
  highlightedMessageId: string | null;
  unreadDividerMessageId?: string | null;
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
  unreadDividerMessageId = null,
  onEditMessage,
  onRemoveMessage,
  onReplyMessage,
  onTogglePinMessage,
  onJumpToMessage,
}: MessageTimelineProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(messages.length);
  const [unseenCount, setUnseenCount] = useState(0);
  const timelineItems = useMemo(
    () => buildTimelineItems(messages, unreadDividerMessageId),
    [messages, unreadDividerMessageId]
  );

  useEffect(() => {
    const { shouldAutoScroll, unseenCount: nextUnseenCount } = computeScrollFollowState(
      prevMessageCountRef.current,
      messages.length,
      wasNearBottomRef.current,
      unseenCount
    );
    prevMessageCountRef.current = messages.length;
    setUnseenCount(nextUnseenCount);
    if (shouldAutoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // Only re-run when the message list itself changes; unseenCount is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    wasNearBottomRef.current = isScrolledNearBottom(
      el.scrollTop,
      el.scrollHeight,
      el.clientHeight
    );
    if (wasNearBottomRef.current) setUnseenCount(0);
  };

  const jumpToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    wasNearBottomRef.current = true;
    setUnseenCount(0);
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-5 py-4"
      >
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
            ) : item.kind === "unread_divider" ? (
              <div
                key={item.id}
                className="my-4 first:mt-0 flex items-center gap-3 text-xs font-semibold text-[#6366F1]"
              >
                <div className="flex-1 h-px bg-[#6366F1]/40" />
                <span className="px-2.5 py-0.5 rounded-full bg-[#6366F1]/10 border border-[#6366F1]/40">
                  New messages
                </span>
                <div className="flex-1 h-px bg-[#6366F1]/40" />
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

      {unseenCount > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#6366F1] text-white text-xs font-medium shadow-lg hover:bg-[#6366F1]/90 transition-colors"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          {unseenCount === 1 ? "1 new message" : `${unseenCount} new messages`}
        </button>
      )}
    </div>
  );
}
