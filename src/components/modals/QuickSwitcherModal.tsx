import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Users } from "lucide-react";
import type { ConversationDto } from "../../lib/types";
import { buildQuickSwitcherResults, getConversationTitle } from "../../lib/ui-polish";

interface QuickSwitcherModalProps {
  conversations: ConversationDto[];
  currentUserId: string;
  pinnedConversationIds: string[];
  onSelectConversation: (conversationId: string) => void;
  onClose: () => void;
}

/**
 * A Slack/Linear/VS-Code-style "jump to any conversation" command palette,
 * opened via `Ctrl+K`/`Cmd+K` (see `shouldOpenQuickSwitcher` in
 * `lib/ui-polish.ts`) as a faster alternative to clicking through the
 * sidebar, focusing its filter box with `/`, or stepping one at a time
 * with `Alt+Up`/`Alt+Down` (issue #92). Client-side only: filters
 * already-loaded conversation data via the same pinned-first ordering and
 * title/preview substring match the sidebar's own filter box already uses
 * (`buildQuickSwitcherResults`).
 */
export function QuickSwitcherModal({
  conversations,
  currentUserId,
  pinnedConversationIds,
  onSelectConversation,
  onClose,
}: QuickSwitcherModalProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(
    () => buildQuickSwitcherResults(conversations, query, currentUserId, pinnedConversationIds),
    [conversations, query, currentUserId, pinnedConversationIds]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clamp the highlighted row back in range whenever the result set
  // shrinks (e.g. typing narrows the match list below the previous index).
  useEffect(() => {
    setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const selectConversation = (conversationId: string) => {
    onSelectConversation(conversationId);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length > 0) setActiveIndex((i) => (i + 1) % results.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) setActiveIndex((i) => (i - 1 + results.length) % results.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = results[activeIndex];
      if (target) selectConversation(target.id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-[12vh] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Jump to conversation"
      >
        <div className="relative border-b border-[var(--border-hairline)]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a conversation..."
            aria-label="Jump to a conversation"
            className="w-full pl-10 pr-4 py-3 text-sm bg-transparent focus:outline-none"
          />
        </div>

        <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-xs text-center text-[var(--text-muted)]">
              No conversations match "{query.trim()}".
            </div>
          ) : (
            results.map((conv, index) => {
              const title = getConversationTitle(conv, currentUserId);
              return (
                <button
                  key={conv.id}
                  type="button"
                  data-index={index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectConversation(conv.id);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                    index === activeIndex
                      ? "bg-[#6366F1]/10 text-[#6366F1]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span className="w-7 h-7 rounded-full bg-[#6366F1]/20 text-[#6366F1] text-xs font-semibold flex items-center justify-center shrink-0">
                    {conv.is_group ? <Users className="w-3.5 h-3.5" /> : title.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{title}</span>
                    {conv.latest_preview && (
                      <span className="block text-xs text-[var(--text-muted)] truncate">
                        {conv.latest_preview}
                      </span>
                    )}
                  </span>
                  {conv.unread_count > 0 && (
                    <span className="shrink-0 min-w-4 h-4 px-1 rounded-full bg-[#6366F1] text-white text-xs font-bold flex items-center justify-center">
                      {conv.unread_count > 99 ? "99+" : conv.unread_count}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
