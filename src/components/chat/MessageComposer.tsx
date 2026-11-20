import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Image as ImageIcon, Paperclip, Reply, Send, X } from "lucide-react";
import { extractErrorMessage, tauriClient } from "../../lib/tauri-client";
import type { MessageDto } from "../../lib/types";
import {
  type AttachmentPreviewKind,
  computeComposerCharacterState,
  resolveComposerEscapeAction,
  validateAttachmentPath,
} from "../../lib/ui-polish";

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
  const [attachmentPreviewKind, setAttachmentPreviewKind] =
    useState<AttachmentPreviewKind>("file");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const lastTypingPingRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const clearAttachment = () => {
    setAttachmentPath(null);
    setAttachmentName(null);
    setAttachmentPreviewKind("file");
  };

  const stageFilePath = useCallback((nativePath: string) => {
    setError(null);
    const validation = validateAttachmentPath(nativePath);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setAttachmentPath(nativePath);
    setAttachmentName(validation.fileName);
    setAttachmentPreviewKind(validation.previewKind);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = tauriClient.onFileDragDrop((event) => {
      if (cancelled) return;
      if (event.type === "enter" || event.type === "over") {
        setIsDragOver(true);
      } else if (event.type === "leave") {
        setIsDragOver(false);
      } else if (event.type === "drop") {
        setIsDragOver(false);
        const firstPath = event.paths[0];
        if (firstPath) stageFilePath(firstPath);
      }
    });
    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [stageFilePath]);

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

  const handlePickAttachment = async () => {
    setError(null);
    try {
      const selectedPath = await tauriClient.pickAttachmentFile();
      if (selectedPath) stageFilePath(selectedPath);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
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
      clearAttachment();
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
      return;
    }
    if (e.key === "Escape") {
      const action = resolveComposerEscapeAction(Boolean(replyingTo), Boolean(attachmentPath));
      if (action === "cancel_reply") {
        e.preventDefault();
        e.stopPropagation();
        onCancelReply();
      } else if (action === "clear_attachment") {
        e.preventDefault();
        e.stopPropagation();
        clearAttachment();
      }
      // action === "none": let Escape propagate (e.g. to close an unrelated modal).
    }
  };

  const charState = computeComposerCharacterState(text.length);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      className="relative px-5 py-3 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]/50"
    >
      {isDragOver && (
        <div className="animate-fade-in absolute inset-1 z-10 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#6366F1] bg-[var(--bg-surface)]/95 text-xs font-medium text-[#6366F1] pointer-events-none">
          <Paperclip className="w-3.5 h-3.5" />
          Drop to attach an image, GIF, or video
        </div>
      )}
      {replyingTo && (
        <div className="animate-slide-up-fade mb-2 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[#6366F1]/10 border-l-2 border-[#6366F1] text-xs">
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
        <div className="animate-slide-up-fade mb-2 px-3 py-1.5 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
          {error}
        </div>
      )}

      {attachmentName && (
        <div className="animate-slide-up-fade mb-2 inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-lg bg-[#6366F1]/15 text-xs text-[#6366F1]">
          <span className="w-8 h-8 rounded-md bg-[#6366F1]/20 flex items-center justify-center shrink-0">
            {attachmentPreviewKind === "video" ? (
              <Film className="w-4 h-4" />
            ) : attachmentPreviewKind === "image" ? (
              <ImageIcon className="w-4 h-4" />
            ) : (
              <Paperclip className="w-4 h-4" />
            )}
          </span>
          <span className="truncate max-w-xs">{attachmentName}</span>
          <button
            type="button"
            onClick={clearAttachment}
            className="hover:text-[var(--text-primary)] transition-colors"
            title="Remove attachment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => void handlePickAttachment()}
          className="p-2.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[#6366F1] active:scale-95 transition-all duration-150"
          title="Attach image, GIF, or video (up to 50 MB)"
        >
          <Paperclip className="w-4 h-4" />
        </button>

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
          className="p-2.5 rounded-xl bg-[#6366F1] text-white hover:bg-[#6366F1]/90 active:scale-95 disabled:opacity-40 transition-all duration-150"
          title="Send encrypted message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {charState.show && (
        <p
          className={`mt-1 text-right text-[11px] font-medium ${
            charState.isOverLimit ? "text-[#EF4444]" : "text-[#F59E0B]"
          }`}
          role="status"
        >
          {charState.isOverLimit
            ? `${Math.abs(charState.remaining)} characters over the suggested length`
            : `${charState.remaining} characters remaining`}
        </p>
      )}
    </div>
  );
}
