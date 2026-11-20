import type { ConversationDto, MessageDto, PinnedMessageDto } from "./types";

export interface TimelineMessageItem {
  kind: "message";
  message: MessageDto;
  isGroupedWithPrev: boolean;
}

export interface TimelineEpochMarkerItem {
  kind: "epoch_divider";
  id: string;
  epoch: number;
  label: string;
}

export interface TimelineUnreadDividerItem {
  kind: "unread_divider";
  id: string;
}

export type TimelineRenderItem =
  | TimelineMessageItem
  | TimelineEpochMarkerItem
  | TimelineUnreadDividerItem;

const GROUP_WINDOW_MS = 120_000;

/**
 * Derives a deterministic 8-hex-character fingerprint ("XXXX • XXXX") from a
 * non-secret public identifier seed (e.g., user ID + username or conversation ID + epoch).
 */
export function formatCryptoFingerprint(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `${hex.slice(0, 4)} • ${hex.slice(4, 8)}`;
}

/**
 * Finds the message ID that should carry a "New messages" divider directly
 * above it, so re-opening a conversation with unread history shows the
 * viewer exactly where they left off (Discord/Slack convention) instead of
 * only a sidebar badge. `unreadCount` is a snapshot taken at the moment the
 * conversation is opened (before marking anything seen resets it), since
 * the count otherwise drops to 0 almost immediately and would make the
 * divider vanish on its own first render.
 *
 * The count walks backward counting only messages from other senders (the
 * unread counter never includes the viewer's own messages), anchoring the
 * divider at the earliest message in that unread streak. If `unreadCount`
 * exceeds what's currently loaded (older unread history isn't in memory
 * yet), it anchors at the oldest loaded message from someone else instead
 * of over/under-shooting. Returns `null` when there's nothing unread, no
 * messages at all, or every loaded message is the viewer's own.
 */
export function findUnreadDividerMessageId(
  messages: MessageDto[],
  unreadCount: number,
  currentUserId: string
): string | null {
  if (unreadCount <= 0 || messages.length === 0) return null;

  let remaining = unreadCount;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate.sender_id === currentUserId) continue;
    remaining -= 1;
    if (remaining === 0) return candidate.id;
  }

  const oldestFromOther = messages.find((m) => m.sender_id !== currentUserId);
  return oldestFromOther ? oldestFromOther.id : null;
}

/**
 * Transforms ordered messages into timeline render items, inserting inline epoch rotation
 * markers on epoch transitions, an optional "New messages" unread divider above
 * `unreadDividerMessageId` (see `findUnreadDividerMessageId`), and flagging consecutive
 * same-sender messages within 2 minutes.
 */
export function buildTimelineItems(
  messages: MessageDto[],
  unreadDividerMessageId: string | null = null
): TimelineRenderItem[] {
  const items: TimelineRenderItem[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const current = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;

    if (prev && current.epoch !== prev.epoch) {
      items.push({
        kind: "epoch_divider",
        id: `epoch-${current.epoch}-${current.id}`,
        epoch: current.epoch,
        label: `Epoch ${current.epoch} • Key rotated`,
      });
    }

    if (current.id === unreadDividerMessageId) {
      items.push({ kind: "unread_divider", id: `unread-${current.id}` });
    }

    const withinGroupWindow =
      prev !== null &&
      Math.abs(Date.parse(current.created_at) - Date.parse(prev.created_at)) <= GROUP_WINDOW_MS;

    const isGroupedWithPrev =
      prev !== null &&
      current.epoch === prev.epoch &&
      current.sender_id === prev.sender_id &&
      current.status === "verified" &&
      !current.is_removed &&
      prev.status === "verified" &&
      !prev.is_removed &&
      withinGroupWindow;

    items.push({
      kind: "message",
      message: current,
      isGroupedWithPrev,
    });
  }

  return items;
}

/**
 * Upserts a message into the timeline list and propagates any edit/removal/verification
 * status changes to in-memory reply previews referencing that message.
 */
export function upsertMessageWithReplySync(
  messages: MessageDto[],
  updated: MessageDto
): MessageDto[] {
  const exists = messages.some((m) => m.id === updated.id);
  const base = exists
    ? messages.map((m) => (m.id === updated.id ? updated : m))
    : [...messages, updated];

  const isRemoved = updated.is_removed || updated.status === "removed";
  const nextStatus = isRemoved ? "removed" : updated.status;

  return base.map((m) => {
    if (!m.reply_to || m.reply_to.message_id !== updated.id) return m;
    if (nextStatus !== "verified") {
      return {
        ...m,
        reply_to: {
          ...m.reply_to,
          status: nextStatus,
          text: null,
          has_attachment: false,
          attachment_mime: null,
        },
      };
    }
    return {
      ...m,
      reply_to: {
        ...m.reply_to,
        status: "verified",
        text: updated.text,
        has_attachment: Boolean(updated.attachment),
        attachment_mime: updated.attachment?.mime_type ?? null,
        is_edited: updated.is_edited,
      },
    };
  });
}

/**
 * Returns the plain text to copy to the clipboard for a message, or null when there is
 * nothing copyable (removed, unverified, or attachment-only messages with no caption).
 */
export function getMessageCopyText(message: MessageDto): string | null {
  if (message.is_removed || message.status !== "verified") return null;
  const trimmed = message.text?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Keeps the Pinned subtab list synchronized when a pinned message is edited, removed,
 * or fails verification.
 */
export function syncPinnedMessage(
  pinned: PinnedMessageDto[],
  updated: MessageDto
): PinnedMessageDto[] {
  if (updated.is_removed || updated.status !== "verified") {
    return pinned.filter((p) => p.message_id !== updated.id);
  }
  return pinned.map((p) =>
    p.message_id === updated.id ? { ...p, message: updated } : p
  );
}

/**
 * Resolves the display title for a conversation: the group name for groups
 * (falling back to "Untitled Group"), or the other member's display name /
 * username for a direct chat (falling back to "Direct Chat").
 */
export function getConversationTitle(
  conv: ConversationDto,
  currentUserId: string
): string {
  if (conv.is_group) return conv.name || "Untitled Group";
  const peer = conv.members.find((m) => m.user_id !== currentUserId);
  return peer?.display_name || peer?.username || "Direct Chat";
}

/**
 * Filters the sidebar conversation list by a case-insensitive, whitespace-
 * trimmed substring match against the conversation's resolved title and its
 * latest message preview. An empty/blank query returns every conversation
 * unchanged (including order).
 */
export function filterConversations(
  conversations: ConversationDto[],
  query: string,
  currentUserId: string
): ConversationDto[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return conversations;
  return conversations.filter((conv) => {
    const title = getConversationTitle(conv, currentUserId).toLowerCase();
    const preview = (conv.latest_preview || "").toLowerCase();
    return title.includes(needle) || preview.includes(needle);
  });
}

const SCROLL_BOTTOM_THRESHOLD_PX = 120;

/**
 * Returns true when a scrollable container is close enough to its bottom
 * edge (within `thresholdPx`, default 120px) that auto-scrolling on new
 * content wouldn't disrupt the viewer. Used to decide whether an incoming
 * message should auto-scroll the timeline or just surface a "jump to
 * latest" affordance instead.
 */
export function isScrolledNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx: number = SCROLL_BOTTOM_THRESHOLD_PX
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= thresholdPx;
}

export interface ScrollFollowState {
  /** Whether the timeline should auto-scroll to the newest message now. */
  shouldAutoScroll: boolean;
  /** Running count of messages the viewer hasn't seen yet (while scrolled up). */
  unseenCount: number;
}

/**
 * Decides, on each message-list update, whether the timeline should
 * auto-scroll to the bottom or instead accumulate an "unseen" counter for a
 * floating "jump to latest" button. Reading history shouldn't be yanked
 * back to the bottom by an unrelated incoming message; auto-scroll only
 * resumes once the viewer was already near the bottom (or no messages were
 * actually added, e.g. an edit/removal).
 */
export function computeScrollFollowState(
  prevMessageCount: number,
  nextMessageCount: number,
  wasNearBottom: boolean,
  prevUnseenCount: number
): ScrollFollowState {
  const added = Math.max(0, nextMessageCount - prevMessageCount);
  if (wasNearBottom || added === 0) {
    return { shouldAutoScroll: true, unseenCount: 0 };
  }
  return { shouldAutoScroll: false, unseenCount: prevUnseenCount + added };
}

/**
 * Immutably updates the in-memory per-conversation composer draft map, so
 * switching conversations without sending doesn't leak one conversation's
 * unsent text into another's composer (the composer previously stayed
 * mounted across conversation switches, carrying its internal text state
 * along with it). Blank/whitespace-only text clears the entry entirely
 * rather than storing an empty string, so a cleared draft doesn't linger.
 * Returns the same map reference when the update is a no-op, so callers
 * relying on referential equality (e.g. React state setters) can skip a
 * re-render.
 */
export function updateDraft(
  drafts: Record<string, string>,
  conversationId: string,
  text: string
): Record<string, string> {
  if (!text.trim()) {
    if (!(conversationId in drafts)) return drafts;
    const next = { ...drafts };
    delete next[conversationId];
    return next;
  }
  if (drafts[conversationId] === text) return drafts;
  return { ...drafts, [conversationId]: text };
}

/**
 * Reads the saved draft for a conversation, defaulting to an empty string
 * when there is none (or no conversation is selected).
 */
export function getDraft(
  drafts: Record<string, string>,
  conversationId: string | null
): string {
  if (!conversationId) return "";
  return drafts[conversationId] ?? "";
}

export interface MessageTimestampLabel {
  /** Always-shown locale time, e.g. "14:32". */
  timeLabel: string;
  /**
   * Date context shown ahead of the time once it's no longer obvious:
   * `null` for a message sent earlier today, `"Yesterday"` for the
   * previous calendar day, otherwise a short date (with year only when it
   * differs from the reference year).
   */
  dateLabel: string | null;
}

/**
 * Splits a message timestamp into its time label and an optional date
 * label, so bubbles orient the viewer when scrolling into older history
 * instead of showing a bare `HH:MM` with no indication of which day it
 * was sent. Calendar-day comparisons use local-time day boundaries via an
 * injectable `referenceNow` (defaults to the real current time) so the
 * logic stays deterministic and timezone-correct under test. A sent date
 * that is today or later (including minor clock skew) yields no date
 * label at all.
 */
export function formatMessageTimestamp(
  isoString: string,
  referenceNow: Date = new Date()
): MessageTimestampLabel {
  const sent = new Date(isoString);
  const timeLabel = sent.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(referenceNow) - startOfDay(sent)) / 86_400_000);

  if (dayDiff <= 0) return { timeLabel, dateLabel: null };
  if (dayDiff === 1) return { timeLabel, dateLabel: "Yesterday" };

  const sameYear = sent.getFullYear() === referenceNow.getFullYear();
  const dateLabel = sent.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return { timeLabel, dateLabel };
}

/**
 * Soft, purely client-side guidance limit for composer text length. There is
 * no confirmed server-side cap on message text to match, so this never
 * blocks sending — it only drives when/how the composer surfaces a
 * character counter to let the user know a draft is getting long.
 */
export const COMPOSER_SOFT_CHAR_LIMIT = 4000;

export interface ComposerCharacterState {
  /** Whether the counter should be rendered at all (hidden while comfortably short). */
  show: boolean;
  /** Characters left before `limit`; negative once over it. */
  remaining: number;
  /** True once within the last 20% of `limit` (counter shown, amber warning). */
  isNearLimit: boolean;
  /** True once length exceeds `limit` (counter shown, red warning). Sending is never blocked. */
  isOverLimit: boolean;
}

/**
 * Computes whether/how to show a composer character counter as a draft
 * grows. Hidden while there's plenty of room; shown as an amber "remaining"
 * count once within the last 20% of `limit`, and in a red over-limit state
 * past it. This is informational guidance only — callers must still allow
 * sending text beyond the limit, since no server-side text length cap is
 * confirmed to exist.
 */
export function computeComposerCharacterState(
  length: number,
  limit: number = COMPOSER_SOFT_CHAR_LIMIT
): ComposerCharacterState {
  const remaining = limit - length;
  const isOverLimit = remaining < 0;
  const isNearLimit = isOverLimit || remaining <= limit * 0.2;
  return { show: isNearLimit, remaining, isNearLimit, isOverLimit };
}

/** What pressing Escape in the composer should do, in priority order. */
export type ComposerEscapeAction = "cancel_reply" | "clear_attachment" | "none";

/**
 * Resolves what the composer's Escape key should do, so a user can back out
 * of a reply context or drop a staged attachment without reaching for the
 * mouse (matching Slack/Discord/Telegram conventions). An active reply
 * takes priority over a staged attachment when both are present, since
 * canceling the reply is the more surprising/stateful thing to leave
 * lingering; a second Escape press then clears any remaining attachment.
 * Returns "none" when there's nothing to back out of, so callers can skip
 * calling preventDefault() and let Escape propagate normally (e.g. to close
 * an unrelated modal).
 */
export function resolveComposerEscapeAction(
  hasReply: boolean,
  hasAttachment: boolean
): ComposerEscapeAction {
  if (hasReply) return "cancel_reply";
  if (hasAttachment) return "clear_attachment";
  return "none";
}

/** What pressing Escape on a message bubble should do, in priority order. */
export type MessageBubbleEscapeAction = "cancel_edit" | "cancel_remove_confirm" | "none";

/**
 * Resolves what the Escape key should do on a message bubble, so a user can
 * back out of an in-progress edit or a pending "Confirm remove" prompt
 * without reaching for the mouse (matching the composer's Escape
 * convention). Backing out of an active edit takes priority over dismissing
 * a remove-confirmation, since the two states are mutually exclusive in
 * practice but an in-progress edit is the more surprising thing to leave
 * uncommitted. Returns "none" when there's nothing to back out of, so
 * callers can skip calling preventDefault() and let Escape propagate
 * normally (e.g. to close an unrelated modal).
 */
export function resolveMessageBubbleEscapeAction(
  isEditing: boolean,
  isConfirmingRemove: boolean
): MessageBubbleEscapeAction {
  if (isEditing) return "cancel_edit";
  if (isConfirmingRemove) return "cancel_remove_confirm";
  return "none";
}

/**
 * Decides whether clicking a media attachment thumbnail should open a
 * full-screen lightbox preview. Images are cropped to a small `max-h-72`
 * thumbnail inline in the chat timeline, so expanding them is the only way
 * to see the full, uncropped picture — hence `true` for any `image/*` mime
 * type. Videos already expose their own native fullscreen/zoom controls via
 * the `<video controls>` element, so wrapping them in a second overlay
 * would just conflict with those controls; hence `false` for `video/*` and
 * any other/unknown mime type.
 */
export function shouldOpenMediaLightbox(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** How a staged (not-yet-sent) composer attachment should be previewed. */
export type AttachmentPreviewKind = "image" | "video" | "file";

/**
 * Decides how to preview a staged composer attachment before the user hits
 * send. Images get a real client-side thumbnail (the caller generates it via
 * `URL.createObjectURL` on the selected `File` — no Tauri/backend round-trip
 * needed, since the file is already in the browser process at this point).
 * Videos and anything else fall back to a generic icon badge: extracting a
 * representative video frame client-side isn't worth the complexity for a
 * transient staging preview that's replaced the moment the message sends.
 */
export function getAttachmentPreviewKind(mimeType: string): AttachmentPreviewKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

/** MIME types the composer accepts as a message attachment. */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
];

/** Max staged attachment size: 50 MB (52,428,800 bytes). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export type AttachmentValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validates a candidate composer attachment's MIME type and size against the
 * same limits regardless of how the file was selected (native file picker
 * `<input type="file">` change event or a drag-and-drop `DataTransfer`
 * drop), so both entry points enforce identical rules instead of each
 * hand-rolling its own copy of the checks.
 */
export function validateAttachmentFile(
  mimeType: string,
  sizeBytes: number
): AttachmentValidationResult {
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(mimeType)) {
    return { ok: false, error: "Allowed formats: PNG, JPG, WEBP, GIF, MP4, WEBM." };
  }
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "Attachment exceeds the 50 MB limit." };
  }
  return { ok: true };
}

/**
 * Finds the IDs of currently-loaded messages whose text matches `query`
 * (case-insensitive substring, surrounding whitespace trimmed), in the same
 * order as `messages`, for the chat header's in-conversation search bar.
 * Only verified, non-removed messages with text are eligible — a
 * removed/unverified/attachment-only message has nothing meaningful to
 * match against (mirrors the eligibility rule `getMessageCopyText` already
 * uses for copy-to-clipboard). A blank query matches nothing rather than
 * everything, so the search bar starts empty instead of flooding the
 * match counter before the user has typed anything.
 */
export function findMessageSearchMatches(
  messages: MessageDto[],
  query: string
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return messages
    .filter((m) => getMessageCopyText(m)?.toLowerCase().includes(needle))
    .map((m) => m.id);
}

/**
 * Decides whether a keydown inside the message-edit field should save the
 * edit, matching the composer's own Enter-to-send / Shift+Enter-for-newline
 * convention. The edit field is an auto-growing `<textarea>` (not a
 * single-line `<input>`) so multi-line messages — rendered with
 * `whitespace-pre-wrap` once sent — can actually be edited without losing
 * their line breaks: plain Enter saves, Shift+Enter is left alone so the
 * browser's default textarea behavior inserts a newline instead.
 */
export function shouldSubmitMessageEditOnKeyDown(key: string, shiftKey: boolean): boolean {
  return key === "Enter" && !shiftKey;
}
