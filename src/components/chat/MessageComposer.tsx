import { useRef, useState } from "react";
import { Paperclip, Reply, Send, X } from "lucide-react";
import type { MessageDto } from "../../lib/types";

interface MessageComposerProps {
  replyingTo: MessageDto | null;
  onCancelReply: () => void;
  onSend: (text?: string, attachmentPath?: string) => Promise<void>;
  onTypingChange: (isTyping: boolean) => void;
  /** Unsent draft text to restore when the composer mounts for a conversation. */
  initialText?: string;
  /** Called on every text change (and on clear after sending) so the caller can persist a per-conversation draft. */
  onDraftChange?: (text: string) => void;
}

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB (52,428,800 bytes)
const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
];

export function MessageComposer({
  replyingTo,
  onCancelReply,
  onSend,
  onTypingChange,
  initialText = "",
  onDraftChange,
}: MessageComposerProps) {
  const [text, setText] = useState(initialText);
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lastTypingPingRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleTextChange = (val: string) => {
    setText(val);
    onDraftChange?.(val);
    resizeTextarea();
    const now = Date.now();
    if (val.trim().length > 0 && now - lastTypingPingRef.current > 2000) {
      lastTypingPingRef.current = now;
      onTypingChange(true);
    } else if (val.trim().length === 0) {
      onTypingChange(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME.includes(file.type)) {
      setError("Allowed formats: PNG, JPG, WEBP, GIF, MP4, WEBM.");
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setError("Attachment exceeds the 50 MB limit.");
      return;
    }
    const nativePath = (file as File & { path?: string }).path;
    if (!nativePath) {
      setError("File path unavailable outside Tauri desktop window.");
      return;
    }
    setAttachmentPath(nativePath);
    setAttachmentName(file.name);
  };

  const submitMessage = async () => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed && !attachmentPath) return;

    setSending(true);
    try {
      await onSend(trimmed || undefined, attachmentPath || undefined);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      setAttachmentPath(null);
      setAttachmentName(null);
      onTypingChange(false);
      onDraftChange?.("");
    } catch (err) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending && (text.trim().length > 0 || attachmentPath)) {
        void submitMessage();
      }
    }
  };

  return (
    <div className="px-5 py-3 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]/50">
      {replyingTo && (
        <div className="mb-2 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[#6366F1]/10 border-l-2 border-[#6366F1] text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Reply className="w-3.5 h-3.5 text-[#6366F1] shrink-0" />
            <div className="min-w-0">
              <span className="font-medium text-[#6366F1]">
                Replying to {replyingTo.sender_display_name}
              </span>
              <p className="truncate text-[var(--text-muted)]">
                {replyingTo.text ||
                  (replyingTo.attachment
                    ? `Attachment: ${replyingTo.attachment.file_name}`
                    : "Encrypted message")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            title="Cancel reply"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="mb-2 px-3 py-1.5 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
          {error}
        </div>
      )}

      {attachmentName && (
        <div className="mb-2 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#6366F1]/15 text-xs text-[#6366F1]">
          <span className="truncate max-w-xs">{attachmentName}</span>
          <button
            type="button"
            onClick={() => {
              setAttachmentPath(null);
              setAttachmentName(null);
            }}
            className="hover:text-[var(--text-primary)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <label
          className="p-2.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[#6366F1] cursor-pointer transition-colors"
          title="Attach image, GIF, or video (up to 50 MB)"
        >
          <Paperclip className="w-4 h-4" />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
            onChange={handleFileSelect}
            className="hidden"
          />
        </label>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write an encrypted message..."
          className="flex-1 px-3.5 py-2.5 text-sm leading-[1.5] max-h-[120px] resize-none overflow-y-auto rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
        />

        <button
          type="submit"
          disabled={sending || (!text.trim() && !attachmentPath)}
          className="p-2.5 rounded-xl bg-[#6366F1] text-white hover:bg-[#6366F1]/90 disabled:opacity-40 transition-colors"
          title="Send encrypted message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
