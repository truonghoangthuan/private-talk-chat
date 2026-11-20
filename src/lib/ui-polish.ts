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

export type TimelineRenderItem = TimelineMessageItem | TimelineEpochMarkerItem;

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
 * Transforms ordered messages into timeline render items, inserting inline epoch rotation
 * markers on epoch transitions and flagging consecutive same-sender messages within 2 minutes.
 */
export function buildTimelineItems(messages: MessageDto[]): TimelineRenderItem[] {
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
