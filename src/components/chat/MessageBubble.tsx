import { useState } from "react";
import { Check, Pencil, ShieldAlert, Trash2, X } from "lucide-react";
import type { MessageDto } from "../../lib/types";
import { MediaViewer } from "./MediaViewer";

interface MessageBubbleProps {
  message: MessageDto;
  isOwn: boolean;
  onEdit: (messageId: string, newText: string) => Promise<void>;
  onRemove: (messageId: string) => Promise<void>;
}

export function MessageBubble({
  message,
  isOwn,
  onEdit,
  onRemove,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(message.text || "");
  const [busy, setBusy] = useState(false);

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

  // Fail-closed verification banner (Constitution Principle IV & Contract §1.2 / §4)
  if (message.status === "verification_failed") {
    return (
      <div className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="max-w-md rounded-2xl px-3.5 py-2.5 bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] flex items-center gap-2 text-xs font-medium">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>Verification failed — content blocked</span>
        </div>
        <span className="mt-1 text-[10px] text-[var(--text-muted)]">
          {message.sender_display_name} • {timeLabel}
        </span>
      </div>
    );
  }

  // Removed message pill (FR-010)
  if (message.is_removed || message.status === "removed") {
    return (
      <div className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="px-3.5 py-2 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/50 backdrop-blur-xs text-xs italic text-[var(--text-muted)]">
          Message removed
        </div>
        <span className="mt-1 text-[10px] text-[var(--text-muted)]">
          {message.sender_display_name} • {timeLabel}
        </span>
      </div>
    );
  }

  return (
    <div className={`group flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
      {!isOwn && (
        <span className="mb-1 ml-1 text-[11px] font-medium text-[var(--text-muted)]">
          {message.sender_display_name}
        </span>
      )}

      <div className="flex items-end gap-1.5 max-w-[75%]">
        {isOwn && !editing && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity mb-1">
            {message.text && (
              <button
                onClick={() => {
                  setDraftText(message.text || "");
                  setEditing(true);
                }}
                disabled={busy}
                className="p-1 rounded-md hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title="Edit message"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={handleRemove}
              disabled={busy}
              className="p-1 rounded-md hover:bg-[#EF4444]/15 text-[var(--text-muted)] hover:text-[#EF4444]"
              title="Remove message"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div
          className={`rounded-2xl px-3.5 py-2.5 text-[14px] leading-[1.5] border border-[var(--border-hairline)] ${
            isOwn
              ? "bg-[#6366F1] text-white"
              : "bg-[var(--bg-bubble)] text-[var(--text-primary)]"
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
                className="p-1 rounded-md hover:bg-white/20"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <>
              {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
              {message.attachment && <MediaViewer attachment={message.attachment} />}
            </>
          )}
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <span>{timeLabel}</span>
        {message.is_edited && <span className="italic">Edited</span>}

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
                  className="w-4 h-4 rounded-full bg-[#6366F1]/80 text-white text-[8px] font-bold flex items-center justify-center ring-1 ring-[var(--bg-canvas)]"
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
