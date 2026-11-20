import { useEffect, useRef, useState } from "react";
import { Film, Paperclip, Reply, Send, Smile, X } from "lucide-react";
import type { MessageDto } from "../../lib/types";
import {
  computeComposerCharacterState,
  getAttachmentPreviewKind,
  insertTextAtCursor,
  QUICK_EMOJIS,
  resolveComposerEscapeAction,
  validateAttachmentFile,
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
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [attachmentMimeType, setAttachmentMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const dragDepthRef = useRef(0);
  const lastTypingPingRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);

  // Close the emoji picker on an outside click, matching other popovers in
  // the app (e.g. the attachment/reply affordances dismiss without needing
  // Escape too).
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (emojiPickerRef.current?.contains(target)) return;
      if (emojiButtonRef.current?.contains(target)) return;
      setShowEmojiPicker(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showEmojiPicker]);

  // Revoke the staged attachment's blob: URL whenever it's replaced/cleared
  // (cleanup runs with the *previous* value before the next effect) and on
  // unmount, so a switched-away conversation or a swapped-in new attachment
  // never leaks a blob: URL.
  useEffect(() => {
    return () => {
      if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    };
  }, [attachmentPreviewUrl]);

  const clearAttachment = () => {
    setAttachmentPath(null);
    setAttachmentName(null);
    setAttachmentMimeType(null);
    setAttachmentPreviewUrl(null);
  };

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

  const stageFile = (file: File) => {
    setError(null);
    const validation = validateAttachmentFile(file.type, file.size);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    const nativePath = (file as File & { path?: string }).path;
    if (!nativePath) {
      setError("File path unavailable outside Tauri desktop window.");
      return;
    }
    setAttachmentPath(nativePath);
    setAttachmentName(file.name);
    setAttachmentMimeType(file.type);
    // Client-side-only preview of the local file before it's encrypted and
    // sent; never touches the network or Tauri IPC.
    setAttachmentPreviewUrl(URL.createObjectURL(file));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stageFile(file);
    // Allow re-selecting the same file path again after clearing it.
    e.target.value = "";
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) stageFile(file);
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
      const action = resolveComposerEscapeAction(
        Boolean(replyingTo),
        Boolean(attachmentPath),
        showEmojiPicker
      );
      if (action === "close_emoji_picker") {
        e.preventDefault();
        e.stopPropagation();
        setShowEmojiPicker(false);
      } else if (action === "cancel_reply") {
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

  const handleEmojiPick = (emoji: string) => {
    const el = textareaRef.current;
    const selectionStart = el?.selectionStart ?? text.length;
    const selectionEnd = el?.selectionEnd ?? text.length;
    const result = insertTextAtCursor(text, selectionStart, selectionEnd, emoji);
    handleTextChange(result.text);
    setShowEmojiPicker(false);
    // Restore focus and caret position so picking an emoji feels like typing
    // it rather than knocking focus out of the composer.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.cursor, result.cursor);
    });
  };

  const charState = computeComposerCharacterState(text.length);
  const attachmentPreviewKind = attachmentMimeType
    ? getAttachmentPreviewKind(attachmentMimeType)
    : "file";

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative px-5 py-3 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]/50"
    >
      {isDragOver && (
        <div className="absolute inset-1 z-10 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#6366F1] bg-[var(--bg-surface)]/95 text-xs font-medium text-[#6366F1] pointer-events-none">
          <Paperclip className="w-3.5 h-3.5" />
          Drop to attach an image, GIF, or video
        </div>
      )}
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
        <div className="mb-2 inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-lg bg-[#6366F1]/15 text-xs text-[#6366F1]">
          {attachmentPreviewKind === "image" && attachmentPreviewUrl ? (
            <img
              src={attachmentPreviewUrl}
              alt=""
              className="w-8 h-8 rounded-md object-cover shrink-0"
            />
          ) : (
            <span className="w-8 h-8 rounded-md bg-[#6366F1]/20 flex items-center justify-center shrink-0">
              {attachmentPreviewKind === "video" ? (
                <Film className="w-4 h-4" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </span>
          )}
          <span className="truncate max-w-xs">{attachmentName}</span>
          <button
            type="button"
            onClick={clearAttachment}
            className="hover:text-[var(--text-primary)]"
            title="Remove attachment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="relative">
          <button
            ref={emojiButtonRef}
            type="button"
            onClick={() => setShowEmojiPicker((v) => !v)}
            className={`p-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors ${
              showEmojiPicker
                ? "text-[#6366F1] bg-[#6366F1]/10"
                : "text-[var(--text-muted)] hover:text-[#6366F1]"
            }`}
            title="Insert emoji"
          >
            <Smile className="w-4 h-4" />
          </button>
          {showEmojiPicker && (
            <div
              ref={emojiPickerRef}
              className="absolute bottom-full left-0 mb-2 z-20 grid grid-cols-8 gap-0.5 p-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-hairline)] shadow-lg"
            >
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleEmojiPick(emoji)}
                  className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

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
