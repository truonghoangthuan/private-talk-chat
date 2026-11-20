import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Film, Image as ImageIcon, Paperclip, Reply, Send, Smile, X } from "lucide-react";
import { extractErrorMessage, tauriClient } from "../../lib/tauri-client";
import type { ConversationMemberDto, MessageDto } from "../../lib/types";
import {
  type AttachmentPreviewKind,
  applyMentionSelection,
  buildEmojiPickerOrder,
  computeComposerCharacterState,
  detectMentionQuery,
  filterMentionCandidates,
  insertTextAtCursor,
  loadRecentEmojis,
  QUICK_EMOJIS,
  recordRecentEmoji,
  resolveComposerEscapeAction,
  saveRecentEmojis,
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
  /** Current conversation's roster, used to resolve "@mention" autocomplete candidates. */
  members?: ConversationMemberDto[];
  /** Only group conversations show the "@mention" autocomplete (mentioning the only other party in a DM adds no value). */
  isGroup?: boolean;
}

export function MessageComposer({
  replyingTo,
  onCancelReply,
  onSend,
  onTypingChange,
  initialText = "",
  onDraftChange,
  members = [],
  isGroup = false,
}: MessageComposerProps) {
  const [text, setText] = useState(initialText);
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentPreviewKind, setAttachmentPreviewKind] =
    useState<AttachmentPreviewKind>("file");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => loadRecentEmojis());
  const [mentionState, setMentionState] = useState<{ query: string; start: number } | null>(
    null
  );
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const lastTypingPingRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const mentionListRef = useRef<HTMLDivElement | null>(null);

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

  // Close the "@mention" dropdown on an outside click, same convention as
  // the emoji picker above (selection itself happens via onMouseDown so it
  // fires before this would dismiss it).
  useEffect(() => {
    if (!mentionState) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (mentionListRef.current?.contains(target)) return;
      if (textareaRef.current?.contains(target)) return;
      setMentionState(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [mentionState]);

  const mentionCandidates = useMemo(
    () => (isGroup && mentionState ? filterMentionCandidates(members, mentionState.query) : []),
    [isGroup, mentionState, members]
  );

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

  const handleTextChange = (val: string, cursor: number = val.length) => {
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
    const nextMention = detectMentionQuery(val, cursor);
    setMentionState(nextMention);
    setMentionActiveIndex(0);
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

  const selectMention = (member: ConversationMemberDto) => {
    if (!mentionState) return;
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const result = applyMentionSelection(text, mentionState.start, cursor, member.username);
    handleTextChange(result.text, result.cursor);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.cursor, result.cursor);
    });
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
      setMentionState(null);
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
    if (mentionState && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionActiveIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionActiveIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectMention(mentionCandidates[mentionActiveIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMentionState(null);
        return;
      }
    }
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
    handleTextChange(result.text, result.cursor);
    setShowEmojiPicker(false);
    // Track usage so the picker floats recently-used emoji to the front
    // next time it opens (issue #58), persisted the same way as the
    // dark/light theme preference.
    setRecentEmojis((prev) => {
      const next = recordRecentEmoji(prev, emoji);
      saveRecentEmojis(next);
      return next;
    });
    // Restore focus and caret position so picking an emoji feels like typing
    // it rather than knocking focus out of the composer.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.cursor, result.cursor);
    });
  };

  const emojiPickerOrder = useMemo(
    () => buildEmojiPickerOrder(QUICK_EMOJIS, recentEmojis),
    [recentEmojis]
  );
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

      <form onSubmit={handleSubmit} className="flex items-end gap-2 relative">
        {mentionState && mentionCandidates.length > 0 && (
          <div
            ref={mentionListRef}
            className="animate-slide-up-fade absolute bottom-full left-11 mb-2 z-20 w-64 max-h-56 overflow-y-auto rounded-xl bg-[var(--bg-surface)] border border-[var(--border-hairline)] shadow-lg py-1"
          >
            {mentionCandidates.map((member, index) => (
              <button
                key={member.user_id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(member);
                }}
                onMouseEnter={() => setMentionActiveIndex(index)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                  index === mentionActiveIndex
                    ? "bg-[#6366F1]/10 text-[#6366F1]"
                    : "hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-[#6366F1]/20 flex items-center justify-center text-[10px] font-semibold text-[#6366F1] shrink-0">
                  {member.display_name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate font-medium">{member.display_name}</span>
                <span className="text-xs text-[var(--text-muted)] truncate">
                  @{member.username}
                </span>
              </button>
            ))}
          </div>
        )}
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
              {emojiPickerOrder.map((emoji) => (
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
          onChange={(e) =>
            handleTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }
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
