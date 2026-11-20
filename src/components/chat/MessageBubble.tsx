import { useState } from "react";
import { Check, Copy, Pencil, Pin, PinOff, Reply, ShieldAlert, Trash2, X } from "lucide-react";
import type { MessageDto } from "../../lib/types";
import { getMessageCopyText } from "../../lib/ui-polish";
import { MediaViewer } from "./MediaViewer";

interface MessageBubbleProps {
  message: MessageDto;
  isOwn: boolean;
  isGroupedWithPrev?: boolean;
  isHighlighted?: boolean;
  onEdit: (messageId: string, newText: string) => Promise<void>;
  onRemove: (messageId: string) => Promise<void>;
  onReply: (message: MessageDto) => void;
  onTogglePin: (message: MessageDto) => Promise<void>;
  onJumpToMessage?: (messageId: string) => void;
}

export function MessageBubble({
  message,
  isOwn,
  isGroupedWithPrev = false,
  isHighlighted = false,
  onEdit,
  onRemove,
  onReply,
  onTogglePin,
  onJumpToMessage,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [draftText, setDraftText] = useState(message.text || "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyText = getMessageCopyText(message);

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

  const timeLabel = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const handleRemove = async () => {
    setBusy(true);
    try {
      await onRemove(message.id);
    } finally {
      setBusy(false);
    }
  };

  const spacingClass = isGroupedWithPrev ? "mt-1" : "mt-4 first:mt-0";

  // Fail-closed verification banner (Constitution Principle IV & Contract §1.2 / §4)
  if (message.status === "verification_failed") {
    return (
      <div className={`${spacingClass} flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="max-w-md rounded-2xl px-3.5 py-2.5 bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] flex items-center gap-2 text-xs font-medium">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>Verification failed — content blocked</span>
        </div>
        <span className="mt-1 text-xs text-[var(--text-muted)]">
          {message.sender_display_name} • {timeLabel}
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
          {message.sender_display_name} • {timeLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={`${spacingClass} group flex flex-col ${isOwn ? "items-end" : "items-start"}`}
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
          className={`rounded-2xl px-3.5 py-2.5 text-[14px] leading-[1.5] border border-[var(--border-hairline)] transition-shadow ${
            isOwn
              ? "bg-[#6366F1] text-white"
              : "bg-[var(--bg-bubble-peer)] text-[var(--text-primary)]"
          } ${
            isHighlighted
              ? "ring-2 ring-[#6366F1] ring-offset-2 ring-offset-[var(--bg-canvas)]"
              : ""
          }`}
        >
          {editing ? (
            <form onSubmit={handleSaveEdit} className="flex items-center gap-1.5 min-w-[220px]">
              <input
                type="text"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                autoFocus
                className="flex-1 px-2 py-1 rounded-lg bg-black/25 text-white text-xs focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="p-1 rounded-md bg-white/20 hover:bg-white/30"
                title="Save"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="p-1 rounded-md hover:bg-[var(--bg-hover)]"
                title="Cancel"
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
              {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
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
        <span>{timeLabel}</span>
        {message.is_edited && <span className="italic">Edited</span>}
        {message.is_pinned && (
          <span className="inline-flex items-center gap-1 text-[#6366F1] font-medium">
            <Pin className="w-3 h-3" />
            Pinned
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
