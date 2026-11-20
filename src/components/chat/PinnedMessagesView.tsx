import { useState } from "react";
import { ArrowUpRight, Pin, PinOff, Search } from "lucide-react";
import type { PinnedMessageDto } from "../../lib/types";
import { filterPinnedMessages } from "../../lib/ui-polish";
import { MediaViewer } from "./MediaViewer";

interface PinnedMessagesViewProps {
  pinnedMessages: PinnedMessageDto[];
  currentUserId: string;
  onJumpToMessage: (messageId: string) => void;
  onUnpinMessage: (messageId: string) => Promise<void>;
}

export function PinnedMessagesView({
  pinnedMessages,
  currentUserId,
  onJumpToMessage,
  onUnpinMessage,
}: PinnedMessagesViewProps) {
  const [query, setQuery] = useState("");

  if (pinnedMessages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-10 h-10 rounded-xl bg-[#6366F1]/10 text-[#6366F1] flex items-center justify-center mb-3">
          <Pin className="w-5 h-5" />
        </div>
        <p className="text-sm font-medium text-[var(--text-primary)]">
          No pinned messages in this conversation yet
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)] max-w-xs">
          Hover any verified message in the timeline and select Pin to save it here for all participants.
        </p>
      </div>
    );
  }

  const filteredMessages = filterPinnedMessages(pinnedMessages, query);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
      {pinnedMessages.length > 1 && (
        <div className="relative pb-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter pinned messages..."
            aria-label="Filter pinned messages"
            className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
          />
        </div>
      )}
      {filteredMessages.length === 0 && (
        <div className="px-3 py-6 text-xs text-center text-[var(--text-muted)]">
          No pinned messages match "{query.trim()}".
        </div>
      )}
      {filteredMessages.map((entry) => {
        const { message } = entry;
        const sentAt = new Date(message.created_at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <div
            key={entry.message_id}
            className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/80 p-3.5 space-y-2"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-[var(--text-primary)] truncate">
                  {message.sender_display_name}
                </span>
                <span className="text-[var(--text-muted)]">{sentAt}</span>
                {message.is_edited && (
                  <span className="italic text-[var(--text-muted)]">Edited</span>
                )}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#6366F1]/10 text-[#6366F1] font-medium">
                  <Pin className="w-3 h-3" />
                  Pinned by {entry.pinned_by_display_name}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onJumpToMessage(entry.message_id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border-hairline)] hover:border-[#6366F1]/50 hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-primary)]"
                >
                  Jump to message
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void onUnpinMessage(entry.message_id)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#EF4444]/10 text-xs font-medium text-[var(--text-muted)] hover:text-[#EF4444]"
                  title="Unpin message"
                >
                  <PinOff className="w-3.5 h-3.5" />
                  Unpin
                </button>
              </div>
            </div>

            {message.text && (
              <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words">
                {message.text}
              </p>
            )}

            {message.attachment && (
              <MediaViewer
                attachment={message.attachment}
                isOwn={message.sender_id === currentUserId}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
