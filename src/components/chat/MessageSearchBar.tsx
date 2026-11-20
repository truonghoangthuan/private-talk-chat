import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { MessageDto } from "../../lib/types";
import { findMessageSearchMatches } from "../../lib/ui-polish";

interface MessageSearchBarProps {
  messages: MessageDto[];
  onJumpToMessage: (messageId: string) => void;
  onClose: () => void;
}

/**
 * Inline search bar for the currently-open conversation's loaded message
 * history (client-side substring match only — no backend search endpoint).
 * Up/Down (or Enter/Shift+Enter) step through matches, reusing the same
 * scroll-and-highlight affordance already used to jump to a pinned message.
 */
export function MessageSearchBar({
  messages,
  onJumpToMessage,
  onClose,
}: MessageSearchBarProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(
    () => findMessageSearchMatches(messages, query),
    [messages, query]
  );

  // Clamp the active index whenever the match set shrinks/changes, and jump
  // to whichever match is now active so navigating is a single keystroke.
  useEffect(() => {
    if (matches.length === 0) return;
    const clamped = Math.min(activeIndex, matches.length - 1);
    if (clamped !== activeIndex) {
      setActiveIndex(clamped);
      return;
    }
    onJumpToMessage(matches[clamped]);
    // Only re-run when the match set or clamped index actually changes —
    // onJumpToMessage is expected to be referentially stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, activeIndex]);

  const stepMatch = (delta: 1 | -1) => {
    if (matches.length === 0) return;
    setActiveIndex((cur) => (cur + delta + matches.length) % matches.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      stepMatch(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      stepMatch(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      stepMatch(-1);
    }
  };

  return (
    <div className="px-5 py-2 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]/70 flex items-center gap-2">
      <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search in conversation..."
        aria-label="Search in conversation"
        className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-[var(--text-muted)]"
      />
      <span className="text-xs text-[var(--text-muted)] shrink-0 tabular-nums" role="status">
        {query.trim()
          ? matches.length > 0
            ? `${activeIndex + 1} of ${matches.length}`
            : "No matches"
          : ""}
      </span>
      <button
        type="button"
        onClick={() => stepMatch(-1)}
        disabled={matches.length === 0}
        title="Previous match"
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => stepMatch(1)}
        disabled={matches.length === 0}
        title="Next match"
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close search"
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
