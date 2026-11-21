import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, History, Loader2 } from "lucide-react";
import type { MessageDto } from "../../lib/types";
import {
  buildTimelineItems,
  computeScrollFollowState,
  getTimelineScrollBehavior,
  isScrolledNearBottom,
  type MessageDensityPreference,
  shouldShowScrollToBottomButton,
} from "../../lib/ui-polish";
import { MessageBubble } from "./MessageBubble";

interface MessageTimelineProps {
  messages: MessageDto[];
  currentUserId: string;
  highlightedMessageId: string | null;
  unreadDividerMessageId?: string | null;
  /** Active in-conversation search query (issue #65); forwarded to bubbles for inline `<mark>` highlighting. */
  searchQuery?: string;
  /** Current viewer's own username (issue #102), forwarded to bubbles to detect/highlight an "@mention" of them. */
  currentUsername?: string;
  /** Render message timestamps in 24-hour time instead of 12-hour AM/PM (issue #108), forwarded to bubbles. */
  use24Hour?: boolean;
  /** Tighter bubble spacing/padding when the "compact" message density preference is active (issue #111), forwarded to bubbles. */
  density?: MessageDensityPreference;
  /** Whether an older page of history might still exist above what's loaded (issue #115). */
  hasMoreHistory?: boolean;
  /** Whether a "Load earlier messages" request is currently in flight (issue #115). */
  loadingEarlier?: boolean;
  /** Fetches and prepends the next-older page of history (issue #115). Omitted entirely when the caller hasn't wired up pagination. */
  onLoadEarlier?: () => void;
  onEditMessage: (messageId: string, newText: string) => Promise<void>;
  onRemoveMessage: (messageId: string) => Promise<void>;
  onReplyMessage: (message: MessageDto) => void;
  onTogglePinMessage: (message: MessageDto) => Promise<void>;
  onJumpToMessage: (messageId: string) => void;
  /** Forwarded to bubbles (issue #98) so the composer's "ArrowUp to edit last message" shortcut can open the right one in edit mode. */
  autoEditMessageId?: string | null;
  onAutoEditConsumed?: () => void;
}

export function MessageTimeline({
  messages,
  currentUserId,
  highlightedMessageId,
  unreadDividerMessageId = null,
  searchQuery = "",
  currentUsername = "",
  use24Hour = false,
  density = "comfortable",
  hasMoreHistory = false,
  loadingEarlier = false,
  onLoadEarlier,
  onEditMessage,
  onRemoveMessage,
  onReplyMessage,
  onTogglePinMessage,
  onJumpToMessage,
  autoEditMessageId = null,
  onAutoEditConsumed,
}: MessageTimelineProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(messages.length);
  // Set right before an onLoadEarlier() call so the message-count effect
  // below knows this update prepended older history rather than appending
  // a new incoming message, and should restore scroll position instead of
  // running the normal auto-scroll/"N new messages" logic.
  const pendingHistoryLoadRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const timelineItems = useMemo(
    () => buildTimelineItems(messages, unreadDividerMessageId),
    [messages, unreadDividerMessageId]
  );

  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    if (pendingHistoryLoadRef.current) {
      // An older page was just prepended: skip the auto-scroll/unseen-count
      // logic entirely (it isn't a new incoming message) and instead keep
      // the viewer's current message in view by offsetting scrollTop by
      // exactly how much taller the content just became.
      pendingHistoryLoadRef.current = false;
      prevMessageCountRef.current = messages.length;
      const el = scrollRef.current;
      if (el) {
        el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      }
      return;
    }
    const { shouldAutoScroll, unseenCount: nextUnseenCount } = computeScrollFollowState(
      prevCount,
      messages.length,
      wasNearBottomRef.current,
      unseenCount
    );
    prevMessageCountRef.current = messages.length;
    setUnseenCount(nextUnseenCount);
    if (shouldAutoScroll) {
      bottomRef.current?.scrollIntoView({
        behavior: getTimelineScrollBehavior(prevCount, messages.length),
      });
    }
    // Only re-run when the message list itself changes; unseenCount is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const handleLoadEarlierClick = () => {
    if (!onLoadEarlier || loadingEarlier) return;
    const el = scrollRef.current;
    prevScrollHeightRef.current = el?.scrollHeight ?? 0;
    pendingHistoryLoadRef.current = true;
    onLoadEarlier();
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = isScrolledNearBottom(
      el.scrollTop,
      el.scrollHeight,
      el.clientHeight
    );
    wasNearBottomRef.current = nearBottom;
    setIsNearBottom(nearBottom);
    if (nearBottom) setUnseenCount(0);
  };

  const jumpToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    wasNearBottomRef.current = true;
    setIsNearBottom(true);
    setUnseenCount(0);
  };

  const showScrollToBottomButton = shouldShowScrollToBottomButton(isNearBottom, unseenCount);

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
          <>
            {onLoadEarlier && hasMoreHistory && (
              <div className="flex justify-center mb-3">
                <button
                  type="button"
                  onClick={handleLoadEarlierClick}
                  disabled={loadingEarlier}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[#6366F1]/40 disabled:opacity-60 transition-colors"
                >
                  {loadingEarlier ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <History className="w-3.5 h-3.5" />
                  )}
                  {loadingEarlier ? "Loading earlier messages..." : "Load earlier messages"}
                </button>
              </div>
            )}
            {timelineItems.map((item) =>
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
                searchQuery={searchQuery}
                currentUsername={currentUsername}
                use24Hour={use24Hour}
                density={density}
                onEdit={onEditMessage}
                onRemove={onRemoveMessage}
                onReply={onReplyMessage}
                onTogglePin={onTogglePinMessage}
                onJumpToMessage={onJumpToMessage}
                autoEditMessageId={autoEditMessageId}
                onAutoEditConsumed={onAutoEditConsumed}
              />
            )
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {unseenCount > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="animate-slide-up-fade absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#6366F1] text-white text-xs font-medium shadow-lg hover:bg-[#6366F1]/90 active:scale-95 transition-all duration-150"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          {unseenCount === 1 ? "1 new message" : `${unseenCount} new messages`}
        </button>
      )}

      {showScrollToBottomButton && (
        <button
          type="button"
          onClick={jumpToLatest}
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
          className="animate-slide-up-fade absolute bottom-4 right-4 flex items-center justify-center w-9 h-9 rounded-full bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-muted)] shadow-lg hover:text-[#6366F1] hover:border-[#6366F1]/40 active:scale-95 transition-all duration-150"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
