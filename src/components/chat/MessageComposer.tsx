import { useRef, useState } from "react";
import { Paperclip, Send, X } from "lucide-react";

interface MessageComposerProps {
  onSend: (text?: string, attachmentPath?: string) => Promise<void>;
  onTypingChange: (isTyping: boolean) => void;
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

export function MessageComposer({ onSend, onTypingChange }: MessageComposerProps) {
  const [text, setText] = useState("");
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lastTypingPingRef = useRef<number>(0);

  const handleTextChange = (val: string) => {
    setText(val);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = text.trim();
    if (!trimmed && !attachmentPath) return;

    setSending(true);
    try {
      await onSend(trimmed || undefined, attachmentPath || undefined);
      setText("");
      setAttachmentPath(null);
      setAttachmentName(null);
      onTypingChange(false);
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

  return (
    <div className="px-5 py-3 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]/50">
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
            className="hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <label
          className="p-2.5 rounded-xl hover:bg-white/5 text-[var(--text-muted)] hover:text-[#6366F1] cursor-pointer transition-colors"
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

        <input
          type="text"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="Write an encrypted message..."
          className="flex-1 px-3.5 py-2.5 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
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
