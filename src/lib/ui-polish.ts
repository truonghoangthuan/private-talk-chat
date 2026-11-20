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

export interface MessageTextSegment {
  text: string;
  isLink: boolean;
}

const MESSAGE_URL_PATTERN = /https?:\/\/[^\s]+/gi;

/**
 * Splits already-decrypted message text into plain-text and link segments
 * so the timeline can render `http(s)://` URLs as real, clickable anchors
 * (issue #39) without reaching for `dangerouslySetInnerHTML` — every
 * segment is plain string data the caller renders as either a text node or
 * an `<a>`, so this introduces no new injection surface.
 *
 * Trailing sentence punctuation immediately after a URL (`.`, `,`, `!`,
 * `?`, `;`, `:`, a lone closing `)`/`]`/`}`, or a quote mark) is trimmed
 * back into plain text — matching other chat apps' handling of sentences
 * like "see https://example.com." or "(https://example.com)". A closing
 * paren/bracket is kept as part of the link if the URL itself contains a
 * matching unclosed opener (e.g. a Wikipedia URL with `(disambiguation)`).
 */
export function splitMessageTextIntoLinkSegments(text: string): MessageTextSegment[] {
  if (!text) return [];

  const segments: MessageTextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MESSAGE_URL_PATTERN.lastIndex = 0;

  while ((match = MESSAGE_URL_PATTERN.exec(text)) !== null) {
    let url = match[0];
    let end = match.index + url.length;

    while (url.length > 0) {
      const lastChar = url[url.length - 1];
      if (/[.,!?;:'"]/.test(lastChar)) {
        url = url.slice(0, -1);
        end -= 1;
        continue;
      }
      if (lastChar === ")" || lastChar === "]" || lastChar === "}") {
        const opener = lastChar === ")" ? "(" : lastChar === "]" ? "[" : "{";
        const openCount = url.split(opener).length - 1;
        const closeCount = url.split(lastChar).length - 1;
        if (closeCount > openCount) {
          url = url.slice(0, -1);
          end -= 1;
          continue;
        }
      }
      break;
    }

    if (!url) continue;

    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isLink: false });
    }
    segments.push({ text: url, isLink: true });
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isLink: false });
  }

  return segments;
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

const PINNED_CONVERSATIONS_STORAGE_PREFIX = "bloop:pinned-conversations:";

function pinnedConversationsStorageKey(userId: string): string {
  return `${PINNED_CONVERSATIONS_STORAGE_PREFIX}${userId}`;
}

/**
 * Toggles a conversation's pinned-to-top state in the sidebar (WhatsApp/
 * Telegram "pin chat" convention) — purely a client-side UI preference, not
 * the same thing as pinning an individual *message* inside a conversation
 * (`message_pin`/`is_pinned` on `MessageDto`), which is a separate,
 * server-synced feature. Adds `conversationId` to the end of `pinnedIds`
 * when absent, removes it when already present; returns a new array either
 * way so callers can rely on referential inequality to detect a change.
 */
export function togglePinnedConversationId(
  pinnedIds: string[],
  conversationId: string
): string[] {
  if (pinnedIds.includes(conversationId)) {
    return pinnedIds.filter((id) => id !== conversationId);
  }
  return [...pinnedIds, conversationId];
}

/**
 * Reorders the sidebar conversation list so every conversation whose ID is
 * in `pinnedIds` sorts ahead of the rest, preserving each group's original
 * relative order (a stable partition, not a full re-sort) — pinning a chat
 * moves it to the top without scrambling the order of everything else.
 * Conversation IDs in `pinnedIds` that no longer match any conversation in
 * the list (e.g. a pinned conversation was left or deleted) are silently
 * ignored rather than erroring. Returns `conversations` unchanged when
 * nothing is pinned, so callers can skip the extra array allocations.
 */
export function sortConversationsForSidebar(
  conversations: ConversationDto[],
  pinnedIds: string[]
): ConversationDto[] {
  if (pinnedIds.length === 0) return conversations;
  const pinnedSet = new Set(pinnedIds);
  const pinned = conversations.filter((c) => pinnedSet.has(c.id));
  if (pinned.length === 0) return conversations;
  const rest = conversations.filter((c) => !pinnedSet.has(c.id));
  return [...pinned, ...rest];
}

/**
 * Loads the pinned-conversation IDs persisted for `userId` from
 * `localStorage` (scoped per user so switching accounts on the same
 * machine never leaks one user's pinned chats into another's sidebar).
 * Returns an empty array when nothing is stored, `localStorage` isn't
 * available (e.g. under the Vitest `node` test environment), or the
 * stored value is missing/corrupt/not a string array — this is a
 * best-effort UI preference, never something that should throw and break
 * the sidebar from rendering.
 */
export function loadPinnedConversationIds(userId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(pinnedConversationsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/**
 * Persists `pinnedIds` for `userId` to `localStorage` so pinned chats
 * survive an app restart. A no-op (rather than a thrown error) when
 * `localStorage` is unavailable or writing fails (e.g. storage quota) —
 * losing the pinned-order preference for this session is an acceptable
 * degradation, never worth surfacing as a user-facing error.
 */
export function savePinnedConversationIds(userId: string, pinnedIds: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(pinnedConversationsStorageKey(userId), JSON.stringify(pinnedIds));
  } catch {
    // Storage unavailable or full; pinned order just won't persist this session.
  }
}

const MUTED_CONVERSATIONS_STORAGE_PREFIX = "bloop:muted-conversations:";

function mutedConversationsStorageKey(userId: string): string {
  return `${MUTED_CONVERSATIONS_STORAGE_PREFIX}${userId}`;
}

/**
 * Toggles a conversation's muted state (WhatsApp/Telegram "mute chat"
 * convention) — a purely client-side UI preference, separate from any
 * OS-level desktop notification suppression (which is backend/Rust-owned
 * and out of scope here). Muting only affects how this conversation's
 * unread count is surfaced in global UI chrome (see
 * `sumUnreadExcludingMuted`) and its badge styling in the sidebar; it never
 * stops messages from arriving or being counted within the conversation
 * itself. Adds `conversationId` to the end of `mutedIds` when absent,
 * removes it when already present; returns a new array either way so
 * callers can rely on referential inequality to detect a change.
 */
export function toggleMutedConversationId(
  mutedIds: string[],
  conversationId: string
): string[] {
  if (mutedIds.includes(conversationId)) {
    return mutedIds.filter((id) => id !== conversationId);
  }
  return [...mutedIds, conversationId];
}

/**
 * Loads the muted-conversation IDs persisted for `userId` from
 * `localStorage` (scoped per user, same convention as
 * `loadPinnedConversationIds`, so switching accounts on the same machine
 * never leaks one user's muted chats into another's). Returns an empty
 * array when nothing is stored, `localStorage` isn't available (e.g. the
 * Vitest `node` test environment), or the stored value is
 * missing/corrupt/not a string array — this is a best-effort UI
 * preference, never something that should throw.
 */
export function loadMutedConversationIds(userId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(mutedConversationsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/**
 * Persists `mutedIds` for `userId` to `localStorage` so muted chats survive
 * an app restart. A no-op (rather than a thrown error) when `localStorage`
 * is unavailable or writing fails (e.g. storage quota) — losing the muted
 * preference for this session is an acceptable degradation, never worth
 * surfacing as a user-facing error.
 */
export function saveMutedConversationIds(userId: string, mutedIds: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(mutedConversationsStorageKey(userId), JSON.stringify(mutedIds));
  } catch {
    // Storage unavailable or full; muted set just won't persist this session.
  }
}

/**
 * Sums `unread_count` across `conversations`, excluding any conversation
 * whose ID is in `mutedIds` — so a muted chat can keep its own in-chat
 * unread count (still visible once opened) without inflating the global
 * nav-rail badge or the window/document title's unread prefix
 * (`computeDocumentTitle`), matching the real-world expectation that
 * muting a noisy chat stops it from nagging you everywhere else in the
 * app.
 */
export function sumUnreadExcludingMuted(
  conversations: ConversationDto[],
  mutedIds: string[]
): number {
  if (mutedIds.length === 0) {
    return conversations.reduce((acc, c) => acc + c.unread_count, 0);
  }
  const mutedSet = new Set(mutedIds);
  return conversations.reduce(
    (acc, c) => (mutedSet.has(c.id) ? acc : acc + c.unread_count),
    0
  );
}

const THEME_STORAGE_KEY = "bloop:dark-mode";

/**
 * Loads the persisted dark/light theme preference from `localStorage`
 * (issue #56). Unlike pinned conversations, this is stored globally rather
 * than per-user: the theme also applies to the unauthenticated
 * `AuthScreen`, which renders before any user is known, so scoping it to a
 * user ID would leave the login screen with no persisted preference at
 * all. Falls back to `systemPrefersDark` (the OS `prefers-color-scheme`
 * media query, read by the caller) when nothing has been explicitly saved
 * yet — e.g. on a brand-new install — so a light-OS user doesn't land in
 * dark mode by surprise just because that happened to be the app's
 * original hardcoded default. Also falls back to it when `localStorage`
 * isn't available (e.g. the Vitest `node` test environment) or the stored
 * value is anything other than the two values this module ever writes,
 * since this is a best-effort UI preference that should never throw.
 */
export function loadThemePreference(systemPrefersDark: boolean): boolean {
  if (typeof localStorage === "undefined") return systemPrefersDark;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "dark") return true;
    if (raw === "light") return false;
    return systemPrefersDark;
  } catch {
    return systemPrefersDark;
  }
}

/**
 * Persists the dark/light theme preference to `localStorage` so it
 * survives an app restart (issue #56) instead of always resetting to the
 * hardcoded dark default. A no-op (rather than a thrown error) when
 * `localStorage` is unavailable or writing fails (e.g. storage quota) —
 * losing the theme preference for this session is an acceptable
 * degradation, never worth surfacing as a user-facing error.
 */
export function saveThemePreference(darkMode: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
  } catch {
    // Storage unavailable or full; theme preference just won't persist this session.
  }
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
 * Decides the scroll behavior for `MessageTimeline`: initial load jumps
 * instantaneously (`"auto"`) to avoid sweeping across 50 messages, while
 * incremental updates scroll smoothly (`"smooth"`).
 */
export function getTimelineScrollBehavior(
  prevMessageCount: number,
  nextMessageCount: number
): ScrollBehavior {
  return prevMessageCount === 0 && nextMessageCount > 0 ? "auto" : "smooth";
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
 * Formats the full, unambiguous date and time for a message timestamp
 * (e.g. "Thursday, November 20, 2025 at 2:32:45 PM"), for use as a hover
 * tooltip on the bubble's short `formatMessageTimestamp` label — matching
 * the Slack/Discord/Gmail convention where the compact in-timeline time
 * (and the "Yesterday"/"Nov 18" date context once it's shown) hides the
 * exact second and weekday until the viewer hovers over it. Always
 * includes the weekday, full month name, day, year, and seconds
 * regardless of how recent the message is, since a tooltip is opt-in
 * (hover) rather than always-visible chrome competing for timeline space.
 */
export function formatFullMessageTimestamp(isoString: string): string {
  const sent = new Date(isoString);
  const datePart = sent.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timePart = sent.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${datePart} at ${timePart}`;
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
export type ComposerEscapeAction =
  | "close_emoji_picker"
  | "cancel_reply"
  | "clear_attachment"
  | "none";

/**
 * Resolves what the composer's Escape key should do, so a user can back out
 * of an open emoji picker, a reply context, or a staged attachment without
 * reaching for the mouse (matching Slack/Discord/Telegram conventions). An
 * open emoji picker (issue #50) takes priority over everything else since
 * it's a transient popover floating above the rest of the composer; an
 * active reply then takes priority over a staged attachment when both are
 * present, since canceling the reply is the more surprising/stateful thing
 * to leave lingering. Returns "none" when there's nothing to back out of,
 * so callers can skip calling preventDefault() and let Escape propagate
 * normally (e.g. to close an unrelated modal).
 */
export function resolveComposerEscapeAction(
  hasReply: boolean,
  hasAttachment: boolean,
  hasEmojiPickerOpen: boolean = false
): ComposerEscapeAction {
  if (hasEmojiPickerOpen) return "close_emoji_picker";
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

/** File extensions accepted as message attachments. */
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "mp4",
  "webm",
] as const;

/** File extensions accepted for user avatars. */
export const ALLOWED_AVATAR_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

export type AttachmentPathValidationResult =
  | { ok: true; fileName: string; previewKind: AttachmentPreviewKind }
  | { ok: false; error: string };

/** Extracts the base filename from a Windows or POSIX path. */
export function extractFileName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * Validates a native file path selected via Tauri dialog or drag-and-drop
 * against allowed attachment extensions. Authoritative size (<= 50 MB) and
 * MIME checks run in Rust (`message_send_core`).
 */
export function validateAttachmentPath(
  filePath: string
): AttachmentPathValidationResult {
  const fileName = extractFileName(filePath.trim());
  const dotIdx = fileName.lastIndexOf(".");
  const ext = dotIdx >= 0 ? fileName.slice(dotIdx + 1).toLowerCase() : "";
  if (
    !(ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)
  ) {
    return { ok: false, error: "Allowed formats: PNG, JPG, WEBP, GIF, MP4, WEBM." };
  }
  const previewKind: AttachmentPreviewKind =
    ext === "mp4" || ext === "webm" ? "video" : "image";
  return { ok: true, fileName, previewKind };
}

/** Validates a native file path selected for a user avatar. */
export function validateAvatarPath(filePath: string): AttachmentValidationResult {
  const fileName = extractFileName(filePath.trim());
  const dotIdx = fileName.lastIndexOf(".");
  const ext = dotIdx >= 0 ? fileName.slice(dotIdx + 1).toLowerCase() : "";
  if (!(ALLOWED_AVATAR_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: "Avatar must be PNG, JPEG, or WEBP." };
  }
  return { ok: true };
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

export interface SearchHighlightSegment {
  text: string;
  isMatch: boolean;
}

/**
 * Splits `text` into alternating matched/unmatched segments against every
 * case-insensitive occurrence of `query` (issue #65), so the in-conversation
 * search bar can wrap each hit in a `<mark>` highlight — matching the
 * browser/Slack in-page-find convention — instead of only ring-highlighting
 * the whole bubble the active match belongs to. Mirrors
 * `splitMessageTextIntoLinkSegments`'s segment-array shape so a caller can
 * render either with the same `.map()` pattern; every segment is plain
 * string data, so this introduces no `dangerouslySetInnerHTML` injection
 * surface. A blank/whitespace-only `query` (no active search) or empty
 * `text` returns the text unsplit with `isMatch: false` (or `[]` for empty
 * text) rather than matching everything.
 */
export function splitTextForSearchHighlight(
  text: string,
  query: string
): SearchHighlightSegment[] {
  if (!text) return [];
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [{ text, isMatch: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const segments: SearchHighlightSegment[] = [];
  let index = 0;

  while (index < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, index);
    if (matchIndex === -1) {
      segments.push({ text: text.slice(index), isMatch: false });
      break;
    }
    if (matchIndex > index) {
      segments.push({ text: text.slice(index, matchIndex), isMatch: false });
    }
    const matchEnd = matchIndex + trimmedQuery.length;
    segments.push({ text: text.slice(matchIndex, matchEnd), isMatch: true });
    index = matchEnd;
  }

  return segments;
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

/**
 * Computes the browser/OS window title to reflect the total unread message
 * count across all conversations (issue #42), the same way Slack/Discord/Gmail
 * surface unread counts in a tab or taskbar title — so there's a way to tell
 * at a glance whether anything new has arrived while the app is minimized,
 * behind other windows, or just not currently focused, without switching
 * back to it. A zero or negative count (nothing unread) returns the plain
 * `appName` unchanged; any positive count is prefixed as `(N) <appName>`,
 * capped at the same "99+" display convention the sidebar/nav-rail unread
 * badges already use so an extreme count never grows the title unbounded.
 */
export function computeDocumentTitle(appName: string, totalUnread: number): string {
  if (totalUnread <= 0) return appName;
  const display = totalUnread > 99 ? "99+" : String(totalUnread);
  return `(${display}) ${appName}`;
}

/**
 * Formats a millisecond duration as a short, human-readable offline-outage
 * length (e.g. "45s", "1m 30s", "1h", "1h 1m") for the "Back online — you
 * were offline for <duration>" reconnect banner (issue #46). Mirrors the
 * compact style already used by relative timestamps elsewhere in the app
 * rather than a verbose `Intl.DurationFormat`-style string. Negative or
 * non-finite input (e.g. a clock skew edge case) is clamped to zero so the
 * banner never shows a nonsensical duration; whole seconds under a minute
 * drop the minutes/hours units entirely, and a unit with a zero remainder
 * (e.g. exactly 60s, exactly 3600s) is omitted rather than shown as "1m 0s".
 */
export function formatOfflineDuration(durationMs: number): string {
  const totalSeconds =
    Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** One row of the keyboard shortcuts help modal (issue #48). */
export interface KeyboardShortcutEntry {
  keys: string;
  description: string;
}

/**
 * The full list of keyboard shortcuts already supported across the
 * composer, message timeline, and in-conversation search (issue #48) —
 * previously only discoverable by accident. Kept as a single exported
 * constant so the help modal and its tests read from the same source of
 * truth instead of a duplicated hardcoded list drifting out of sync.
 */
export const KEYBOARD_SHORTCUTS: KeyboardShortcutEntry[] = [
  { keys: "Enter", description: "Send message, or save a message edit" },
  { keys: "Shift + Enter", description: "Insert a new line instead of sending/saving" },
  {
    keys: "Escape",
    description:
      "Cancel an active reply or clear a staged attachment, cancel an in-progress message edit, or dismiss a pending remove confirmation",
  },
  { keys: "Enter / Shift + Enter", description: "Jump to the next / previous search match" },
  { keys: "↓ / ↑", description: "Jump to the next / previous search match" },
  { keys: "Ctrl/Cmd + F", description: "Open search in the current conversation" },
  { keys: "?", description: "Show this keyboard shortcuts list" },
];

/**
 * Decides whether a global `?` keypress should open the keyboard shortcuts
 * help modal (issue #48), matching the Slack/Discord/Linear convention.
 * Suppressed while the user is actively typing in an editable field (a
 * text input, textarea, select, or `contenteditable` element) so typing a
 * literal `?` into a message, search box, or display-name field never gets
 * hijacked into opening the modal instead.
 */
export function shouldOpenShortcutsHelp(
  key: string,
  activeElementTagName: string | null,
  isContentEditable: boolean
): boolean {
  if (key !== "?") return false;
  if (isContentEditable) return false;
  const tag = activeElementTagName?.toUpperCase() ?? "";
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT";
}

/**
 * Decides whether a global keydown should open the in-conversation message
 * search bar, matching the browser/Slack/Discord `Ctrl+F` (`Cmd+F` on
 * macOS) "find" convention instead of only being reachable via the header's
 * search icon. Unlike `shouldOpenShortcutsHelp`, this is never suppressed
 * while typing in an editable field: holding Ctrl/Cmd means the browser
 * would not insert a literal "f" character into that field anyway, so there
 * is nothing to protect by checking the active element. `key` is matched
 * case-insensitively since some keyboard layouts/OSes report an uppercase
 * "F" while the modifier is held.
 */
export function shouldOpenConversationSearch(key: string, ctrlOrMetaKey: boolean): boolean {
  return ctrlOrMetaKey && key.toLowerCase() === "f";
}

/**
 * A small, curated set of common reaction/sentiment emoji for the
 * composer's quick emoji picker (issue #50). Deliberately a fixed list
 * rather than a full emoji library/picker dependency — covers the most
 * common chat reactions (thumbs up, heart, laugh, celebrate, etc.)
 * without adding a new runtime dependency or a searchable-but-overkill
 * picker UI for a desktop chat app this size.
 */
export const QUICK_EMOJIS: string[] = [
  "😀", "😂", "😍", "😮", "😢", "😡", "👍", "👎",
  "🙏", "🎉", "🔥", "❤️", "👀", "✅", "❌", "🚀",
];

const RECENT_EMOJIS_STORAGE_KEY = "bloop:recent-emoji";
const MAX_RECENT_EMOJIS = 8;

/**
 * Moves `emoji` to the front of `recent` (most-recently-used first),
 * dropping any earlier occurrence of it, and caps the result at
 * `MAX_RECENT_EMOJIS` entries (issue #58) — mirrors the
 * `togglePinnedConversationId` convention of always returning a new array
 * so callers can rely on referential inequality to detect a change.
 */
export function recordRecentEmoji(recent: string[], emoji: string): string[] {
  const withoutEmoji = recent.filter((e) => e !== emoji);
  return [emoji, ...withoutEmoji].slice(0, MAX_RECENT_EMOJIS);
}

/**
 * Builds the quick emoji picker's display order (issue #58): recently
 * used emoji from `recent` (most recent first) float to the front,
 * followed by the remaining entries of `allEmojis` in their original
 * curated order — the Slack/Discord/OS emoji-picker convention of
 * surfacing what's actually used instead of a static fixed layout.
 * Entries in `recent` that aren't in `allEmojis` (e.g. a stale
 * `localStorage` value left over from a previously different curated
 * set) are silently ignored rather than erroring.
 */
export function buildEmojiPickerOrder(allEmojis: string[], recent: string[]): string[] {
  const validRecent = recent.filter((e) => allEmojis.includes(e));
  if (validRecent.length === 0) return allEmojis;
  const rest = allEmojis.filter((e) => !validRecent.includes(e));
  return [...validRecent, ...rest];
}

/**
 * Loads the persisted recently-used emoji list (most-recent first) from
 * `localStorage` (issue #58). Stored globally rather than per-user — same
 * reasoning as the dark/light theme preference (issue #56): a low-stakes
 * UI preference that isn't worth plumbing `currentUserId` through the
 * composer for. Returns an empty array when nothing is stored,
 * `localStorage` isn't available (e.g. the Vitest `node` test
 * environment), or the stored value is missing/corrupt/not a string
 * array — this is a best-effort UI preference, never something that
 * should throw and break the composer from rendering.
 */
export function loadRecentEmojis(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_EMOJIS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is string => typeof e === "string");
  } catch {
    return [];
  }
}

/**
 * Persists the recently-used emoji list to `localStorage` (issue #58). A
 * no-op (rather than a thrown error) when `localStorage` is unavailable
 * or writing fails (e.g. storage quota) — losing the recent-emoji order
 * for this session is an acceptable degradation, never worth surfacing
 * as a user-facing error.
 */
export function saveRecentEmojis(recent: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECENT_EMOJIS_STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Storage unavailable or full; recent-emoji order just won't persist this session.
  }
}

/**
 * Filters the Pinned subtab's list by a case-insensitive, whitespace-
 * trimmed substring match against the pinned message's text and its
 * sender's display name (issue #68) -- mirroring the sidebar's
 * `filterConversations` convention for the per-conversation pinned-message
 * list instead of leaving it unfilterable once a conversation accumulates
 * more than a handful of pins. An empty/blank query returns `pinned`
 * unchanged (including order), matching `filterConversations`'s no-op
 * behavior for a blank filter. Attachment-only pins (no `text`) still
 * match on sender name alone.
 */
export function filterPinnedMessages(
  pinned: PinnedMessageDto[],
  query: string
): PinnedMessageDto[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return pinned;
  return pinned.filter((entry) => {
    const text = (entry.message.text || "").toLowerCase();
    const sender = entry.message.sender_display_name.toLowerCase();
    return text.includes(needle) || sender.includes(needle);
  });
}

export interface TextInsertionResult {
  /** The full text after inserting `insertion` in place of the selected range. */
  text: string;
  /** Where the caret should land after the insertion (end of the inserted text). */
  cursor: number;
}

/**
 * Inserts `insertion` (e.g. an emoji) into `text` in place of the current
 * selection (`selectionStart`..`selectionEnd`, both clamped to the text's
 * bounds and swapped if given out of order), replacing any selected text
 * exactly like typing would. Used by the composer's quick emoji picker
 * (issue #50) so clicking an emoji inserts it at the caret — not just
 * appended to the end — matching ordinary keyboard typing behavior, and
 * returns the caret position so the composer can restore focus there
 * instead of leaving it stranded at the start of the textarea.
 */
export function insertTextAtCursor(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string
): TextInsertionResult {
  const length = text.length;
  const start = Math.max(0, Math.min(length, selectionStart, selectionEnd));
  const end = Math.max(0, Math.min(length, Math.max(selectionStart, selectionEnd)));
  const nextText = text.slice(0, start) + insertion + text.slice(end);
  return { text: nextText, cursor: start + insertion.length };
}
