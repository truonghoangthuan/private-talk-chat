import { useEffect, useRef, useState } from "react";
import { AtSign, Check, Copy, Pencil, Pin, PinOff, Reply, ShieldAlert, Trash2, X } from "lucide-react";
import type { MessageDto } from "../../lib/types";
import {
  formatFullMessageTimestamp,
  formatMessageTimestamp,
  getMessageCopyText,
  getMessageDensityClasses,
  type MessageDensityPreference,
  messageMentionsUser,
  resolveMessageBubbleEscapeAction,
  shouldSubmitMessageEditOnKeyDown,
  splitMessageTextIntoLinkSegments,
  splitTextForSearchHighlight,
} from "../../lib/ui-polish";
import { MediaViewer } from "./MediaViewer";

interface MessageBubbleProps {
  message: MessageDto;
  isOwn: boolean;
  isGroupedWithPrev?: boolean;
  isHighlighted?: boolean;
  /** Active in-conversation search query (issue #65); matches render with a `<mark>` highlight. */
  searchQuery?: string;
  /** Current viewer's own username (issue #102), used to detect and call out an "@mention" of them in a received message. */
  currentUsername?: string;
  /** Render timestamps in 24-hour time instead of 12-hour AM/PM (issue #108). */
  use24Hour?: boolean;
  /** Tighter bubble spacing/padding when the "compact" message density preference is active (issue #111). */
  density?: MessageDensityPreference;
  onEdit: (messageId: string, newText: string) => Promise<void>;
  onRemove: (messageId: string) => Promise<void>;
  onReply: (message: MessageDto) => void;
  onTogglePin: (message: MessageDto) => Promise<void>;
  onJumpToMessage?: (messageId: string) => void;
  /** Set by the parent (issue #98) when this message should immediately enter edit mode — e.g. via the composer's "ArrowUp to edit last message" shortcut. */
  autoEditMessageId?: string | null;
  /** Called once `autoEditMessageId` has been consumed, so the parent can clear it and avoid re-triggering. */
  onAutoEditConsumed?: () => void;
}

export function MessageBubble({
  message,
  isOwn,
  isGroupedWithPrev = false,
  isHighlighted = false,
  searchQuery = "",
  currentUsername = "",
  use24Hour = false,
  density = "comfortable",
  onEdit,
  onRemove,
  onReply,
  onTogglePin,
  onJumpToMessage,
  autoEditMessageId = null,
  onAutoEditConsumed,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [draftText, setDraftText] = useState(message.text || "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const copyText = getMessageCopyText(message);

  // Enter edit mode automatically when the parent flags this message via
  // the composer's "ArrowUp to edit last message" shortcut (issue #98),
  // instead of requiring a hover + click on a message that may have
  // scrolled out of view. `onAutoEditConsumed` is called right away so
  // the parent clears the flag and this effect doesn't re-fire.
  useEffect(() => {
    if (autoEditMessageId !== message.id) return;
    setDraftText(message.text || "");
    setEditing(true);
    onAutoEditConsumed?.();
  }, [autoEditMessageId, message.id, message.text, onAutoEditConsumed]);

  const resizeEditTextarea = () => {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  // Autosize once the textarea mounts (editing starts) so an existing
  // multi-line message doesn't open clipped to a single row.
  useEffect(() => {
    if (editing) resizeEditTextarea();
  }, [editing]);

  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access unavailable; silently ignore (non-critical UX affordance).
    }
  };

  const { timeLabel, dateLabel } = formatMessageTimestamp(message.created_at, new Date(), use24Hour);
  const timestampDisplay = dateLabel ? `${dateLabel}, ${timeLabel}` : timeLabel;
  const fullTimestamp = formatFullMessageTimestamp(message.created_at, use24Hour);

  // Slack/Discord "you were mentioned" highlight (issue #102): only ever
  // called out on a received message — the viewer's own sends are never
  // highlighted back at them.
  const mentionsMe = !isOwn && messageMentionsUser(message.text, currentUsername);

  const submitEdit = async () => {
    const trimmed = draftText.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onEdit(message.id, trimmed);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitEdit();
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldSubmitMessageEditOnKeyDown(e.key, e.shiftKey)) {
      e.preventDefault();
      if (!busy) void submitEdit();
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      await onRemove(message.id);
    } finally {
      setBusy(false);
    }
  };

  const densityClasses = getMessageDensityClasses(density);
  const spacingClass = isGroupedWithPrev
    ? densityClasses.groupedSpacing
    : densityClasses.newGroupSpacing;

  const handleBubbleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    const action = resolveMessageBubbleEscapeAction(editing, confirmingRemove);
    if (action === "cancel_edit") {
      e.preventDefault();
      e.stopPropagation();
      setEditing(false);
    } else if (action === "cancel_remove_confirm") {
      e.preventDefault();
      e.stopPropagation();
      setConfirmingRemove(false);
    }
    // action === "none": let Escape propagate (e.g. to close an unrelated modal).
  };

  // Fail-closed verification banner (Constitution Principle IV & Contract §1.2 / §4)
  if (message.status === "verification_failed") {
    return (
      <div className={`${spacingClass} flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="max-w-md rounded-2xl px-3.5 py-2.5 bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] flex items-center gap-2 text-xs font-medium">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>Verification failed — content blocked</span>
        </div>
        <span className="mt-1 text-xs text-[var(--text-muted)]">
          {message.sender_display_name} • <span title={fullTimestamp}>{timestampDisplay}</span>
        </span>
      </div>
    );
  }

  // Removed message pill (FR-010)
  if (message.is_removed || message.status === "removed") {
    return (
      <div className={`${spacingClass} flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="px-3.5 py-2 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/50 backdrop-blur-xs text-xs italic text-[var(--text-muted)]">
          Message removed
        </div>
        <span className="mt-1 text-xs text-[var(--text-muted)]">
          {message.sender_display_name} • <span title={fullTimestamp}>{timestampDisplay}</span>
        </span>
      </div>
    );
  }

  return (
    <div
      id={`msg-${message.id}`}
      onKeyDown={handleBubbleKeyDown}
      className={`${spacingClass} animate-message-in group flex flex-col ${isOwn ? "items-end" : "items-start"}`}
    >
      {!isOwn && !isGroupedWithPrev && (
        <span className="mb-1 ml-1 text-xs font-medium text-[var(--text-muted)]">
          {message.sender_display_name}
        </span>
      )}

      <div className="flex items-end gap-1.5 max-w-[75%]">
        {isOwn && !editing && (
          <div
            className={`${
              confirmingRemove ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            } flex items-center gap-1 transition-opacity mb-1`}
          >
            {confirmingRemove ? (
              <>
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={busy}
                  className="px-2 py-0.5 rounded-md bg-[#EF4444] text-white text-xs font-medium hover:bg-[#EF4444]/90 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  disabled={busy}
                  className="px-2 py-0.5 rounded-md hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onReply(message)}
                  disabled={busy}
                  className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  title="Reply"
                >
                  <Reply className="w-3.5 h-3.5" />
                </button>
                {copyText && (
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    disabled={busy}
                    className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    title={copied ? "Copied!" : "Copy text"}
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void onTogglePin(message)}
                  disabled={busy}
                  className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[#6366F1]"
                  title={message.is_pinned ? "Unpin message" : "Pin message"}
                >
                  {message.is_pinned ? (
                    <PinOff className="w-3.5 h-3.5" />
                  ) : (
                    <Pin className="w-3.5 h-3.5" />
                  )}
                </button>
                {message.text && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftText(message.text || "");
                      setEditing(true);
                    }}
                    disabled={busy}
                    className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    title="Edit message"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(true)}
                  disabled={busy}
                  className="p-1 rounded-md hover:bg-[#EF4444]/15 text-[var(--text-muted)] hover:text-[#EF4444]"
                  title="Remove message"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}

        <div
          className={`rounded-2xl ${densityClasses.bubblePadding} text-[14px] leading-[1.5] border transition-shadow ${
            isOwn
              ? "bg-[#6366F1] text-white border-[var(--border-hairline)]"
              : mentionsMe
              ? "bg-[#F59E0B]/10 text-[var(--text-primary)] border-[#F59E0B]/50"
              : "bg-[var(--bg-bubble-peer)] text-[var(--text-primary)] border-[var(--border-hairline)]"
          } ${
            isHighlighted
              ? "ring-2 ring-[#6366F1] ring-offset-2 ring-offset-[var(--bg-canvas)]"
              : ""
          }`}
        >
          {editing ? (
            <form onSubmit={handleSaveEdit} className="flex items-end gap-1.5 min-w-[220px] max-w-sm">
              <textarea
                ref={editTextareaRef}
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  resizeEditTextarea();
                }}
                onKeyDown={handleEditKeyDown}
                autoFocus
                rows={1}
                className="flex-1 px-2 py-1 rounded-lg bg-black/25 text-white text-xs leading-[1.4] resize-none overflow-y-auto max-h-40 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="p-1 rounded-md bg-white/20 hover:bg-white/30 shrink-0"
                title="Save (Enter)"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="p-1 rounded-md hover:bg-[var(--bg-hover)] shrink-0"
                title="Cancel (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <>
              {message.reply_to && (
                <button
                  type="button"
                  onClick={() => onJumpToMessage?.(message.reply_to!.message_id)}
                  className={`mb-2 w-full text-left px-2.5 py-1.5 rounded-lg border-l-2 text-xs transition-colors ${
                    isOwn
                      ? "bg-black/20 border-white/70 text-white/90 hover:bg-black/30"
                      : "bg-[var(--bg-canvas)]/70 border-[#6366F1] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-semibold truncate">
                      {message.reply_to.sender_display_name}
                    </span>
                    {message.reply_to.status === "verified" && message.reply_to.is_edited && (
                      <span className="italic opacity-75 shrink-0">Edited</span>
                    )}
                  </div>
                  <div className="truncate opacity-80">
                    {message.reply_to.status === "removed"
                      ? "Message removed"
                      : message.reply_to.status === "verification_failed"
                      ? "Unverified message"
                      : message.reply_to.text ||
                        (message.reply_to.has_attachment
                          ? "Encrypted attachment"
                          : "Encrypted message")}
                  </div>
                </button>
              )}
              {message.text && (
                <p className="whitespace-pre-wrap break-words">
                  {splitMessageTextIntoLinkSegments(message.text).map((segment, i) =>
                    segment.isLink ? (
                      <a
                        key={i}
                        href={segment.text}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className={`underline underline-offset-2 break-all ${
                          isOwn ? "text-white hover:text-white/80" : "text-[#6366F1] hover:text-[#6366F1]/80"
                        }`}
                      >
                        {segment.text}
                      </a>
                    ) : (
                      <span key={i}>
                        {splitTextForSearchHighlight(segment.text, searchQuery).map((hseg, j) =>
                          hseg.isMatch ? (
                            <mark
                              key={j}
                              className="rounded-sm px-0.5 bg-[#F59E0B] text-[#1A1A1A]"
                            >
                              {hseg.text}
                            </mark>
                          ) : (
                            <span key={j}>{hseg.text}</span>
                          )
                        )}
                      </span>
                    )
                  )}
                </p>
              )}
              {message.attachment && <MediaViewer attachment={message.attachment} isOwn={isOwn} />}
            </>
          )}
        </div>

        {!isOwn && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity mb-1">
            <button
              type="button"
              onClick={() => onReply(message)}
              disabled={busy}
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Reply"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
            {copyText && (
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={busy}
                className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title={copied ? "Copied!" : "Copy text"}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-[#10B981]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => void onTogglePin(message)}
              disabled={busy}
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[#6366F1]"
              title={message.is_pinned ? "Unpin message" : "Pin message"}
            >
              {message.is_pinned ? (
                <PinOff className="w-3.5 h-3.5" />
              ) : (
                <Pin className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span title={fullTimestamp}>{timestampDisplay}</span>
        {message.is_edited && <span className="italic">Edited</span>}
        {message.is_pinned && (
          <span className="inline-flex items-center gap-1 text-[#6366F1] font-medium">
            <Pin className="w-3 h-3" />
            Pinned
          </span>
        )}
        {mentionsMe && (
          <span className="inline-flex items-center gap-1 text-[#F59E0B] font-medium">
            <AtSign className="w-3 h-3" />
            Mentioned you
          </span>
        )}

        {message.seen_by.length > 0 && (
          <div
            className="flex items-center -space-x-1.5 pl-1"
            title={message.seen_by
              .map(
                (s) =>
                  `Seen by ${s.display_name} • ${new Date(s.seen_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
              )
              .join("\n")}
          >
            {message.seen_by.slice(0, 5).map((s) =>
              s.avatar_url ? (
                <img
                  key={s.user_id}
                  src={s.avatar_url}
                  alt={s.display_name}
                  className="w-4 h-4 rounded-full object-cover ring-1 ring-[var(--bg-canvas)]"
                />
              ) : (
                <span
                  key={s.user_id}
                  className="w-4 h-4 rounded-full bg-[#6366F1]/80 text-white text-[10px] font-bold flex items-center justify-center ring-1 ring-[var(--bg-canvas)]"
                >
                  {s.display_name.slice(0, 1).toUpperCase()}
                </span>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
