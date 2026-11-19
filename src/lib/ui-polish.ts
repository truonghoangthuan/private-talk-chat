import type { MessageDto, PinnedMessageDto } from "./types";

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
