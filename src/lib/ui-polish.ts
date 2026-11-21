import type { ContactDto, ConversationDto, MessageDto, PinnedMessageDto } from "./types";

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
 * Decides whether a page of messages fetched from `message_list` might have
 * more, older history behind it (issue #115) — the app only ever loaded the
 * most recent `limit` messages with no way to go further back. A page that
 * came back exactly as full as requested suggests the server had at least
 * that many to give and may have more before it; a short page (the oldest
 * message in the conversation was reached) means there's nothing left to
 * load. This is a heuristic, not a server-confirmed "has more" flag — a
 * conversation whose total history is an exact multiple of `limit` will
 * show one extra "Load earlier" click that comes back empty, which the
 * caller (via `mergeOlderMessages` returning no new messages) should treat
 * the same as reaching the end.
 */
export function hasMoreOlderMessages(fetchedCount: number, limit: number): boolean {
  return fetchedCount >= limit;
}

/**
 * Prepends an older page of messages (fetched via `message_list`'s `before`
 * cursor, issue #115) ahead of the already-loaded `existing` messages,
 * de-duplicating by `id` in case the server's cursor ever includes the
 * boundary message again. Preserves `older`'s own (oldest-first) order
 * followed by `existing`'s, so the merged result stays in the same
 * chronological order the timeline already expects. Returns `existing`
 * unchanged (same reference) when `older` contributes nothing new, so
 * callers can detect a no-op page via referential equality.
 */
export function mergeOlderMessages(
  existing: MessageDto[],
  older: MessageDto[]
): MessageDto[] {
  const existingIds = new Set(existing.map((m) => m.id));
  const newOlder = older.filter((m) => !existingIds.has(m.id));
  if (newOlder.length === 0) return existing;
  return [...newOlder, ...existing];
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
 * Builds a plain-text export of a conversation's already-loaded message
 * history (Slack/WhatsApp/Telegram "export chat" convention) — one line
 * per message as `[<full timestamp>] <sender>: <body>`, so a conversation
 * can be kept as a personal record outside the app instead of only ever
 * being viewable while scrolled into view in the timeline. Only formats
 * already-decrypted, already-loaded `MessageDto` data that's already
 * rendered on screen; nothing new is fetched, decrypted, or transmitted.
 *
 * Mirrors the same fail-closed placeholders the timeline already shows
 * instead of ever including raw ciphertext: a removed message exports as
 * "Message removed" and a signature-verification failure exports as
 * "Unverified message" — neither carries real content. An attachment is
 * noted by file name only (`[Attachment: <name>]`); the binary itself is
 * never embedded in the export. `exportedAt` is injectable (defaults to
 * the real current time) so the header line stays deterministic in tests.
 * `use24Hour` (issue #108) threads the same clock-format preference the
 * timeline bubbles use into the exported timestamps.
 */
export function buildConversationExportText(
  messages: MessageDto[],
  conversationTitle: string,
  exportedAt: Date = new Date(),
  use24Hour: boolean = false
): string {
  const header = `Bloop conversation export — ${conversationTitle}\nExported ${formatFullMessageTimestamp(
    exportedAt.toISOString(),
    use24Hour
  )}\n${"=".repeat(60)}`;

  if (messages.length === 0) {
    return `${header}\n(no messages)\n`;
  }

  const lines = messages.map((message) => {
    const timestamp = formatFullMessageTimestamp(message.created_at, use24Hour);
    let body: string;
    if (message.is_removed || message.status === "removed") {
      body = "Message removed";
    } else if (message.status === "verification_failed") {
      body = "Unverified message";
    } else {
      const parts: string[] = [];
      if (message.text) parts.push(message.text);
      if (message.attachment) parts.push(`[Attachment: ${message.attachment.file_name}]`);
      body = parts.length > 0 ? parts.join(" ") : "[Empty message]";
      if (message.is_edited) body += " (edited)";
    }
    return `[${timestamp}] ${message.sender_display_name}: ${body}`;
  });

  return `${header}\n${lines.join("\n")}\n`;
}

/**
 * Builds a filesystem-safe `.txt` filename for a conversation export,
 * e.g. `bloop-export-general-team-chat-2026-11-20.txt` — lowercased,
 * non-alphanumeric runs collapsed to a single hyphen, trimmed of leading/
 * trailing hyphens, and falling back to "conversation" if the title is
 * empty or entirely punctuation (e.g. an emoji-only group name).
 */
export function buildConversationExportFilename(
  conversationTitle: string,
  exportedAt: Date = new Date()
): string {
  const slug = conversationTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const datePart = exportedAt.toISOString().slice(0, 10);
  return `bloop-export-${slug || "conversation"}-${datePart}.txt`;
}

/**
 * Triggers a browser-native download of plain-text content as a file, via
 * a short-lived Blob URL — the standard client-side "save as file"
 * pattern (no Tauri IPC or filesystem access involved; the browser's own
 * download manager writes the file, same as any web app's export button).
 * A no-op when `document`/`URL` aren't available (e.g. the Vitest `node`
 * test environment), since this is a best-effort UI convenience and
 * should never throw.
 */
export function downloadTextFile(filename: string, content: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  try {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch {
    // Download unavailable in this environment; nothing to recover from.
  }
}

/**
 * Sanitizes a decrypted attachment's file name for use as a browser
 * download target (issue #119) — strips any directory component (the
 * decrypted envelope's file name is otherwise attacker-controlled and
 * could smuggle a `../`-style path segment) and characters Windows,
 * macOS, and Linux all reject in a plain file name, trims leading dots
 * so the saved file can't end up hidden, and falls back to a generic
 * name if nothing usable remains (e.g. an empty or punctuation-only
 * original name).
 */
export function sanitizeAttachmentDownloadFilename(
  fileName: string | null | undefined
): string {
  const fallback = "attachment";
  if (!fileName) return fallback;
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[<>:"|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || fallback;
}

/**
 * Triggers a browser-native "save as" download of arbitrary binary
 * content — e.g. an already-decrypted chat attachment fetched back from
 * the app's `privatetalk-media://` cache (issue #119) — via a
 * short-lived Blob URL, the same no-Tauri-IPC, no-filesystem-access
 * pattern `downloadTextFile` above already uses for the conversation
 * `.txt` export (issue #106). A no-op when `document`/`URL` aren't
 * available (e.g. the Vitest `node` test environment), since this is a
 * best-effort UI convenience and should never throw.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch {
    // Download unavailable in this environment; nothing to recover from.
  }
}

/**
 * Decides whether a decrypted image attachment's MIME type can be handed
 * straight to the OS clipboard via `ClipboardItem` (issue #123's "Copy
 * image" button, next to the existing "Download attachment" button from
 * issue #119) or needs a canvas round-trip to PNG first. Chromium-based
 * webviews (the WebView2 shell this app runs in) only accept a narrow,
 * well-supported allowlist of image clipboard MIME types in practice —
 * `image/png` and `image/jpeg` — so anything else (`image/webp`,
 * `image/gif`, `image/svg+xml`, ...) is re-encoded to PNG before the
 * clipboard write is attempted, the same way most browsers' own
 * "Copy image" context-menu action behaves for formats they don't
 * support copying natively.
 */
export function canCopyImageMimeTypeDirectly(mimeType: string | null | undefined): boolean {
  const normalized = (mimeType || "").toLowerCase();
  return normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/jpg";
}

export interface MessageTextSegment {
  text: string;
  isLink: boolean;
}

export interface MessageFormatSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
}

// Order matters: a longer/more-specific marker (`**`, `~~`, `` ` ``) must be
// tried before the single-`*` italic marker at the same starting position,
// since the regex engine evaluates alternatives left-to-right and stops at
// the first one that matches. Each marker's content disallows the marker
// character itself (no nesting) and a leading/trailing space (so "* not
// italic *" and a bare lone "*" in ordinary prose are left as plain text).
const INLINE_FORMAT_PATTERN =
  /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*|~~([^\s~](?:[^~]*[^\s~])?)~~|`([^`]+)`|\*([^\s*](?:[^*]*[^\s*])?)\*/g;

function plainFormatSegment(text: string): MessageFormatSegment {
  return { text, bold: false, italic: false, strikethrough: false, code: false };
}

/**
 * Splits already-decrypted, already-link-segmented message text into plain
 * and lightweight-Markdown-formatted segments (issue #113) — `**bold**`,
 * `*italic*`, `~~strikethrough~~`, and `` `inline code` `` — matching the
 * Slack/Discord/WhatsApp composer convention, without `dangerouslySetInnerHTML`
 * (every segment is plain string data the caller renders inside a styled
 * `<span>`). Purely a display treatment: the raw markers are untouched in
 * storage, export, and anywhere else only the literal text matters.
 */
export function splitMessageTextIntoFormatSegments(text: string): MessageFormatSegment[] {
  if (!text) return [];

  const segments: MessageFormatSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_FORMAT_PATTERN.lastIndex = 0;

  while ((match = INLINE_FORMAT_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(plainFormatSegment(text.slice(lastIndex, match.index)));
    }
    if (match[1] !== undefined) {
      segments.push({ text: match[1], bold: true, italic: false, strikethrough: false, code: false });
    } else if (match[2] !== undefined) {
      segments.push({ text: match[2], bold: false, italic: false, strikethrough: true, code: false });
    } else if (match[3] !== undefined) {
      segments.push({ text: match[3], bold: false, italic: false, strikethrough: false, code: true });
    } else {
      segments.push({ text: match[4], bold: false, italic: true, strikethrough: false, code: false });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push(plainFormatSegment(text.slice(lastIndex)));
  }

  return segments;
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

/**
 * Narrows the sidebar conversation list down to only conversations with
 * at least one unread message, OR manually marked unread (issue #86)
 * (Gmail/Slack "unreads only" convention), so a long conversation list
 * can be scanned for what's actually new — or flagged to come back to —
 * without eyeballing every unread badge. When `unreadOnly` is false,
 * returns `conversations` unchanged (including order/reference) so
 * callers can skip extra array allocations on the common case. Intended
 * to run alongside (not instead of) the existing text filter — apply
 * both before `sortConversationsForSidebar`, in either order, since
 * neither reorders the input. `manuallyUnreadIds` defaults to an empty
 * array for callers that haven't wired up the manual-unread feature.
 */
export function filterUnreadOnlyConversations(
  conversations: ConversationDto[],
  unreadOnly: boolean,
  manuallyUnreadIds: string[] = []
): ConversationDto[] {
  if (!unreadOnly) return conversations;
  return conversations.filter((conv) => isConversationUnreadForDisplay(conv, manuallyUnreadIds));
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

const MANUALLY_UNREAD_CONVERSATIONS_STORAGE_PREFIX = "bloop:manually-unread-conversations:";

function manuallyUnreadConversationsStorageKey(userId: string): string {
  return `${MANUALLY_UNREAD_CONVERSATIONS_STORAGE_PREFIX}${userId}`;
}

/**
 * Toggles a conversation's "manually marked unread" flag (Gmail/Outlook
 * "mark as unread" convention, issue #86) — a purely client-side signal
 * layered on top of the server-driven `unread_count`, for a conversation
 * that's already fully read but the viewer wants to flag as something to
 * come back to. Distinct from muting (issue #63, suppresses noise) and
 * pinning (issue #53, sidebar order): this is a read/unread marker, not a
 * notification or ordering preference. Adds `conversationId` to the end
 * of `manuallyUnreadIds` when absent, removes it when already present;
 * returns a new array either way so callers can rely on referential
 * inequality to detect a change.
 */
export function toggleManuallyUnreadConversationId(
  manuallyUnreadIds: string[],
  conversationId: string
): string[] {
  if (manuallyUnreadIds.includes(conversationId)) {
    return manuallyUnreadIds.filter((id) => id !== conversationId);
  }
  return [...manuallyUnreadIds, conversationId];
}

/**
 * Loads the manually-marked-unread conversation IDs persisted for
 * `userId` from `localStorage` (issue #86), scoped per user the same way
 * `loadMutedConversationIds`/`loadPinnedConversationIds` are, so
 * switching accounts on the same machine never leaks one user's manual
 * unread flags into another's sidebar. Returns an empty array when
 * nothing is stored, `localStorage` isn't available (e.g. the Vitest
 * `node` test environment), or the stored value is
 * missing/corrupt/not a string array — this is a best-effort UI
 * preference, never something that should throw.
 */
export function loadManuallyUnreadConversationIds(userId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(manuallyUnreadConversationsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/**
 * Persists `manuallyUnreadIds` for `userId` to `localStorage` (issue #86)
 * so a manual unread flag survives an app restart. A no-op (rather than a
 * thrown error) when `localStorage` is unavailable or writing fails
 * (e.g. storage quota) — losing the flag for this session is an
 * acceptable degradation, never worth surfacing as a user-facing error.
 */
export function saveManuallyUnreadConversationIds(
  userId: string,
  manuallyUnreadIds: string[]
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      manuallyUnreadConversationsStorageKey(userId),
      JSON.stringify(manuallyUnreadIds)
    );
  } catch {
    // Storage unavailable or full; the manual unread flag just won't persist this session.
  }
}

/**
 * Resolves whether a conversation's sidebar unread badge should render,
 * combining the server-driven `unread_count` with the purely client-side
 * manually-marked-unread flag (issue #86) — either one is enough to show
 * an unread indicator. Used instead of a bare `conv.unread_count > 0`
 * check wherever the sidebar decides badge visibility or the "Unread
 * only" filter (issue #76) membership, so a manually-flagged
 * already-read conversation isn't silently dropped from either.
 */
export function isConversationUnreadForDisplay(
  conversation: ConversationDto,
  manuallyUnreadIds: string[]
): boolean {
  return conversation.unread_count > 0 || manuallyUnreadIds.includes(conversation.id);
}

/**
 * Returns the IDs of every conversation with a real, server-tracked unread
 * count (issue #96's "Mark all as read" sidebar action) — deliberately
 * excludes conversations that are unread only via the purely client-side
 * manually-marked-unread flag (issue #86), since those don't need a
 * `message_mark_seen` IPC round trip at all; the caller clears that flag
 * separately (the same way opening a single conversation already does).
 * Preserves `conversations`' input order.
 */
export function getUnreadConversationIds(conversations: ConversationDto[]): string[] {
  return conversations.filter((conv) => conv.unread_count > 0).map((conv) => conv.id);
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
 * Decides whether `MessageTimeline` should show its plain "scroll to
 * bottom" floating button (issue #90). That button is for the case where
 * the viewer scrolled up to read history and nothing new has arrived since
 * — there's otherwise no quick way back down. It must stay hidden whenever
 * the "N new messages" jump-to-latest pill (`unseenCount > 0`) is already
 * showing its own affordance, and whenever the viewer is already near the
 * bottom.
 */
export function shouldShowScrollToBottomButton(
  isNearBottom: boolean,
  unseenCount: number
): boolean {
  return !isNearBottom && unseenCount === 0;
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

/** Sidebar's resolved preview line for a conversation: either its unsent draft or the latest-message preview. */
export interface ConversationPreviewLabel {
  /** The text to render in place of the plain latest-message preview. */
  text: string;
  /** Whether `text` is an unsent draft rather than the latest message preview. */
  isDraft: boolean;
}

/**
 * Resolves the sidebar's preview line for a conversation (issue #84):
 * an unsent draft, Telegram/WhatsApp-style, takes priority over the
 * latest-message preview so a conversation left mid-compose is easy to
 * find again — "Draft: " is prefixed to call out that it isn't the
 * other side's message. Falls back to the ordinary latest-message
 * preview (or the empty-conversation placeholder text supplied by the
 * caller) once the draft is blank/whitespace-only, matching `getDraft`'s
 * own blank-is-empty convention. Caller is expected to give this lower
 * priority than an active typing indicator, which is more time-sensitive
 * than a stale draft.
 */
export function buildConversationPreviewLabel(
  latestPreview: string | null | undefined,
  draftText: string,
  emptyPlaceholder = "Encrypted channel ready"
): ConversationPreviewLabel {
  const trimmedDraft = draftText.trim();
  if (trimmedDraft) {
    return { text: `Draft: ${trimmedDraft}`, isDraft: true };
  }
  return { text: latestPreview || emptyPlaceholder, isDraft: false };
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
  referenceNow: Date = new Date(),
  use24Hour: boolean = false
): MessageTimestampLabel {
  const sent = new Date(isoString);
  const timeLabel = sent.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !use24Hour,
  });

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
export function formatFullMessageTimestamp(
  isoString: string,
  use24Hour: boolean = false
): string {
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
    hour12: !use24Hour,
  });
  return `${datePart} at ${timePart}`;
}

const CLOCK_FORMAT_STORAGE_KEY = "bloop:clock-format";

/**
 * Whether message timestamps (bubble short label, full hover tooltip, and
 * the plain-text conversation export) render in 12-hour AM/PM or 24-hour
 * time (issue #108). The app previously always deferred to the browser
 * locale's default, which is 12-hour for this app's locale and had no
 * in-app override short of changing OS-wide locale settings.
 */
export type ClockFormatPreference = "12h" | "24h";

/**
 * Loads the persisted clock-format preference from `localStorage`
 * (issue #108). Stored globally (same convention as the dark/light theme
 * preference) rather than per-user, since it's a display-habit setting
 * rather than anything tied to an account. Falls back to `"12h"` — the
 * app's original, unconfigurable behavior — when nothing has been
 * explicitly saved yet, `localStorage` is unavailable (e.g. the Vitest
 * `node` test environment), or the stored value is anything other than
 * the two values this module ever writes, since this is a best-effort UI
 * preference that should never throw.
 */
export function loadClockFormatPreference(): ClockFormatPreference {
  if (typeof localStorage === "undefined") return "12h";
  try {
    const raw = localStorage.getItem(CLOCK_FORMAT_STORAGE_KEY);
    return raw === "24h" ? "24h" : "12h";
  } catch {
    return "12h";
  }
}

/**
 * Persists the clock-format preference to `localStorage` so it survives
 * an app restart (issue #108). A no-op (rather than a thrown error) when
 * `localStorage` is unavailable or writing fails (e.g. storage quota) —
 * losing this preference for the session is an acceptable degradation,
 * never worth surfacing as a user-facing error.
 */
export function saveClockFormatPreference(preference: ClockFormatPreference): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CLOCK_FORMAT_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable or full; preference just won't persist this session.
  }
}

const MESSAGE_DENSITY_STORAGE_KEY = "bloop:message-density";

/**
 * Whether the message timeline renders with its original spacing/padding
 * ("comfortable") or a tighter layout that fits more history on screen at
 * once ("compact") — the Slack/Discord "compact mode" convention. Purely a
 * display preference over already-loaded, already-decrypted message data;
 * introduces no new backend/IPC surface.
 */
export type MessageDensityPreference = "comfortable" | "compact";

/**
 * Loads the persisted message-density preference from `localStorage`.
 * Stored globally (same convention as the dark/light theme and clock-format
 * preferences) rather than per-user, since it's a display-habit setting
 * rather than anything tied to an account. Falls back to `"comfortable"` —
 * the app's original, unconfigurable spacing — when nothing has been
 * explicitly saved yet, `localStorage` is unavailable (e.g. the Vitest
 * `node` test environment), or the stored value is anything other than the
 * two values this module ever writes, since this is a best-effort UI
 * preference that should never throw.
 */
export function loadMessageDensityPreference(): MessageDensityPreference {
  if (typeof localStorage === "undefined") return "comfortable";
  try {
    const raw = localStorage.getItem(MESSAGE_DENSITY_STORAGE_KEY);
    return raw === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

/**
 * Persists the message-density preference to `localStorage` so it survives
 * an app restart. A no-op (rather than a thrown error) when `localStorage`
 * is unavailable or writing fails (e.g. storage quota) — losing this
 * preference for the session is an acceptable degradation, never worth
 * surfacing as a user-facing error.
 */
export function saveMessageDensityPreference(preference: MessageDensityPreference): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MESSAGE_DENSITY_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable or full; preference just won't persist this session.
  }
}

/** Tailwind class fragments the timeline/bubble swap in for each density level. */
export interface MessageDensityClasses {
  /** Replaces the bubble wrapper's vertical margin when grouped with the previous message. */
  groupedSpacing: string;
  /** Replaces the bubble wrapper's vertical margin when starting a new sender/group. */
  newGroupSpacing: string;
  /** Replaces the message bubble's own internal padding. */
  bubblePadding: string;
}

/**
 * Resolves the Tailwind class fragments `MessageBubble`/`MessageTimeline`
 * swap in for the current message-density preference. `"compact"` shrinks
 * both the gap between bubbles and each bubble's own internal padding so
 * more history fits on screen at once, without changing the 2-minute
 * same-sender grouping logic (`buildTimelineItems`) itself — only how far
 * apart grouped/ungrouped bubbles render. `"comfortable"` reproduces the
 * app's original, unconfigurable spacing exactly.
 */
export function getMessageDensityClasses(
  density: MessageDensityPreference
): MessageDensityClasses {
  if (density === "compact") {
    return {
      groupedSpacing: "mt-0.5",
      newGroupSpacing: "mt-2 first:mt-0",
      bubblePadding: "px-3 py-1.5",
    };
  }
  return {
    groupedSpacing: "mt-1",
    newGroupSpacing: "mt-4 first:mt-0",
    bubblePadding: "px-3.5 py-2.5",
  };
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
    keys: "↑ (empty composer)",
    description: "Edit your last message",
  },
  {
    keys: "Escape",
    description:
      "Cancel an active reply or clear a staged attachment, cancel an in-progress message edit, or dismiss a pending remove confirmation",
  },
  { keys: "Enter / Shift + Enter", description: "Jump to the next / previous search match" },
  { keys: "↓ / ↑", description: "Jump to the next / previous search match" },
  { keys: "Ctrl/Cmd + F", description: "Open search in the current conversation" },
  { keys: "Ctrl/Cmd + K", description: "Open the quick switcher to jump to any conversation" },
  { keys: "Alt + ↓ / ↑", description: "Switch to the next / previous conversation in the sidebar" },
  {
    keys: "Alt + Shift + ↓ / ↑",
    description: "Jump to the next / previous unread conversation",
  },
  { keys: "/", description: "Focus the sidebar's conversation filter box" },
  { keys: "?", description: "Show this keyboard shortcuts list" },
  {
    keys: "Ctrl/Cmd + = / -",
    description: "Increase / decrease the app's text size",
  },
  { keys: "Ctrl/Cmd + 0", description: "Reset the app's text size to 100%" },
  { keys: "Ctrl/Cmd + B", description: "Toggle **bold** on the selected composer text" },
  { keys: "Ctrl/Cmd + I", description: "Toggle *italic* on the selected composer text" },
  {
    keys: "Ctrl/Cmd + Shift + X",
    description: "Toggle ~~strikethrough~~ on the selected composer text",
  },
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
 * Decides whether a global keydown should focus the sidebar's "Filter
 * conversations..." input (issue #78), matching the Slack/Linear/GitHub
 * `/` convention for jumping straight to a search/filter box instead of it
 * only being reachable by clicking in. Suppressed the same way
 * `shouldOpenShortcutsHelp`'s `?` shortcut is — while the user is actively
 * typing in an editable field (a text input, textarea, select, or
 * `contenteditable` element) — so typing a literal `/` into a message,
 * search box, or display-name field never gets hijacked into refocusing
 * the sidebar filter instead.
 */
export function shouldFocusConversationFilter(
  key: string,
  activeElementTagName: string | null,
  isContentEditable: boolean
): boolean {
  if (key !== "/") return false;
  if (isContentEditable) return false;
  const tag = activeElementTagName?.toUpperCase() ?? "";
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT";
}

/**
 * Decides whether a global keydown should open the quick-switcher modal
 * (a "jump to any conversation" command palette), matching the Slack/
 * Linear/VS Code `Ctrl+K` (`Cmd+K` on macOS) convention. Never suppressed
 * while typing in an editable field — same rationale as
 * `shouldOpenConversationSearch`'s `Ctrl+F`: holding Ctrl/Cmd means the
 * browser would not insert a literal "k" into that field anyway, so
 * there's nothing to protect by checking the active element. `key` is
 * matched case-insensitively since some keyboard layouts/OSes report an
 * uppercase "K" while the modifier is held.
 */
export function shouldOpenQuickSwitcher(key: string, ctrlOrMetaKey: boolean): boolean {
  return ctrlOrMetaKey && key.toLowerCase() === "k";
}

/**
 * Resolves the ordered, filtered list of conversations the quick-switcher
 * modal should display: starts from the same pinned-first sidebar order
 * (`sortConversationsForSidebar`) and then narrows it by the same
 * title/preview substring match the sidebar's own text filter already
 * uses (`filterConversations`), so a conversation found here sorts the
 * same way it would if the sidebar filter box had been used instead. An
 * empty/blank query returns every conversation in pinned-first order
 * rather than an empty list, matching a freshly-opened, not-yet-typed-in
 * command palette convention (Slack/Linear/VS Code all list recent/all
 * items before a query narrows them).
 */
export function buildQuickSwitcherResults(
  conversations: ConversationDto[],
  query: string,
  currentUserId: string,
  pinnedIds: string[]
): ConversationDto[] {
  const ordered = sortConversationsForSidebar(conversations, pinnedIds);
  return filterConversations(ordered, query, currentUserId);
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

/**
 * Filters a contact list (the group drawer's "Select Contacts"/"Add
 * Contacts" lists) by a case-insensitive, whitespace-trimmed substring
 * match against the contact's display name or `@username` — same filter
 * convention as the sidebar's conversation filter (`filterConversations`)
 * and the Pinned-messages subtab filter (`filterPinnedMessages`), so a
 * large contact list can be narrowed without scrolling. An empty/blank
 * query returns every contact unchanged (including order).
 */
export function filterContacts(contacts: ContactDto[], query: string): ContactDto[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return contacts;
  return contacts.filter((c) => {
    const displayName = c.display_name.toLowerCase();
    const username = c.username.toLowerCase();
    return displayName.includes(needle) || username.includes(needle);
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

export interface MentionTriggerState {
  /** The in-progress "@query" text typed so far (without the leading "@"). */
  query: string;
  /** Index of the triggering "@" within the full composer text. */
  start: number;
}

/**
 * Detects an in-progress "@mention" token at the caret (Slack/Discord
 * autocomplete convention), so the composer can show a live suggestion
 * dropdown instead of requiring a whole `@username` to be typed blind.
 * Only triggers when the "@" sits at the very start of the text or is
 * preceded by whitespace (so an email-like `foo@bar` or a mid-word "@"
 * never fires it) and the span between that "@" and the caret contains no
 * whitespace (so the token ends the moment a space is typed, same as
 * Slack). Returns `null` when no such token is open.
 */
export function detectMentionQuery(text: string, cursor: number): MentionTriggerState | null {
  const upToCursor = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const at = upToCursor.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upToCursor[at - 1])) return null;
  const token = upToCursor.slice(at + 1);
  if (/\s/.test(token)) return null;
  return { query: token, start: at };
}

export interface MentionCandidate {
  user_id: string;
  username: string;
  display_name: string;
}

const MAX_MENTION_SUGGESTIONS = 6;

/**
 * Narrows a group conversation's member list to mention-autocomplete
 * candidates matching `query` (case-insensitive substring against
 * `username` or `display_name`), same filter convention as
 * `filterContacts`. A match at the very start of either field ranks ahead
 * of one only found mid-string, then ties break alphabetically by display
 * name; results are capped at `MAX_MENTION_SUGGESTIONS` so a large group
 * doesn't render an unbounded dropdown. An empty query matches everyone
 * (so typing a bare "@" immediately shows the full member list, up to the
 * cap), ordered the same way.
 */
export function filterMentionCandidates<T extends MentionCandidate>(
  members: T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  const ranked = members
    .map((member) => {
      const username = member.username.toLowerCase();
      const displayName = member.display_name.toLowerCase();
      if (needle && !username.includes(needle) && !displayName.includes(needle)) return null;
      const prefixRank = username.startsWith(needle) || displayName.startsWith(needle) ? 0 : 1;
      return { member, prefixRank };
    })
    .filter((entry): entry is { member: T; prefixRank: number } => entry !== null)
    .sort(
      (a, b) =>
        a.prefixRank - b.prefixRank || a.member.display_name.localeCompare(b.member.display_name)
    );
  return ranked.slice(0, MAX_MENTION_SUGGESTIONS).map((entry) => entry.member);
}

/**
 * Replaces the in-progress "@query" token — from `start` (the triggering
 * "@") through `cursor` (the caret) — with the chosen member's
 * "@username " (trailing space so typing can continue immediately without
 * the mention running into the next word), mirroring
 * `insertTextAtCursor`'s splice-and-reposition-caret pattern.
 */
export function applyMentionSelection(
  text: string,
  start: number,
  cursor: number,
  username: string
): TextInsertionResult {
  const before = text.slice(0, Math.max(0, Math.min(start, text.length)));
  const after = text.slice(Math.max(0, Math.min(cursor, text.length)));
  const inserted = `@${username} `;
  return { text: before + inserted + after, cursor: before.length + inserted.length };
}

/**
 * Decides whether a global keydown should switch the selected conversation,
 * and in which direction (issue #70) — `Alt + ArrowDown` steps to the next
 * conversation in the sidebar's current order, `Alt + ArrowUp` to the
 * previous one, matching the Slack/Discord "switch channel" convention
 * instead of the sidebar only being reachable by clicking. Returns `null`
 * for every other key/modifier combination, including a bare arrow key
 * without Alt held (so normal text-field cursor movement is untouched).
 */
export function getConversationSwitchDirection(
  key: string,
  altKey: boolean
): 1 | -1 | null {
  if (!altKey) return null;
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return null;
}

/**
 * Returns the conversation id to select when stepping `direction` (`1` for
 * next, `-1` for previous) through `orderedIds` relative to `currentId`
 * (issue #70), wrapping around at either end so stepping past the last
 * conversation lands back on the first (and vice versa) rather than
 * dead-ending. `orderedIds` is expected to already be in the sidebar's
 * current display order (pinned-first, filtered or not) — this helper is
 * agnostic to how that order was produced. Falls back to the first entry
 * (stepping forward) or last entry (stepping backward) when `currentId`
 * isn't found in `orderedIds` (e.g. nothing was selected yet), and returns
 * `null` only when `orderedIds` is empty.
 */
export function getAdjacentConversationId(
  orderedIds: string[],
  currentId: string | null,
  direction: 1 | -1
): string | null {
  if (orderedIds.length === 0) return null;
  const currentIndex = currentId ? orderedIds.indexOf(currentId) : -1;
  if (currentIndex === -1) {
    return direction === 1 ? orderedIds[0] : orderedIds[orderedIds.length - 1];
  }
  const nextIndex = (currentIndex + direction + orderedIds.length) % orderedIds.length;
  return orderedIds[nextIndex];
}

/**
 * Decides whether a global keydown should jump to the next/previous
 * conversation considered UNREAD specifically (issue #100) —
 * `Alt+Shift+ArrowDown` for the next unread, `Alt+Shift+ArrowUp` for the
 * previous, mirroring the Gmail/Outlook "go to next unread" convention.
 * Requires Shift in addition to Alt so it never fires alongside the
 * existing "step to any adjacent conversation" shortcut (issue #70),
 * which only checks Alt and would otherwise also match.
 */
export function getUnreadConversationJumpDirection(
  key: string,
  altKey: boolean,
  shiftKey: boolean
): 1 | -1 | null {
  if (!altKey || !shiftKey) return null;
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return null;
}

/**
 * Returns the IDs of every conversation considered unread for display
 * purposes (issue #100) — the same definition the sidebar's existing
 * "Unread only" filter (issue #76) and unread badge count use: a real
 * server-tracked `unread_count` OR the client-side manually-marked-unread
 * flag (issue #86). Preserves `conversations`' input order.
 */
export function getUnreadForDisplayConversationIds(
  conversations: ConversationDto[],
  manuallyUnreadIds: string[]
): string[] {
  return conversations
    .filter((conv) => isConversationUnreadForDisplay(conv, manuallyUnreadIds))
    .map((conv) => conv.id);
}

/**
 * Returns the conversation id to select when jumping `direction` (`1` for
 * next, `-1` for previous) to the nearest UNREAD conversation in
 * `orderedIds` relative to `currentId` (issue #100), wrapping around at
 * either end — including wrapping back to `currentId` itself when it is
 * the only unread conversation in the list. Unlike
 * `getAdjacentConversationId`, this skips every read conversation in
 * between rather than stopping one step away, and returns `null` (doing
 * nothing) when `unreadIds` is empty — there is nothing to jump to — or
 * when `orderedIds` is empty.
 */
export function getNextUnreadConversationId(
  orderedIds: string[],
  currentId: string | null,
  direction: 1 | -1,
  unreadIds: string[]
): string | null {
  const n = orderedIds.length;
  if (n === 0 || unreadIds.length === 0) return null;
  const unreadSet = new Set(unreadIds);
  const currentIndex = currentId ? orderedIds.indexOf(currentId) : -1;
  for (let step = 1; step <= n; step++) {
    const idx = (((currentIndex + direction * step) % n) + n) % n;
    const candidateId = orderedIds[idx];
    if (unreadSet.has(candidateId)) return candidateId;
  }
  return null;
}

export type PasswordStrengthLabel = "Too short" | "Weak" | "Fair" | "Good" | "Strong";

export interface PasswordStrengthResult {
  label: PasswordStrengthLabel;
  /** 0 when below the 8-char minimum, otherwise 1 (weakest) to 4 (strongest) — number of meter segments to fill. */
  score: 0 | 1 | 2 | 3 | 4;
}

/**
 * Scores a candidate password for the registration form's strength meter
 * (issue #74) — purely client-side guidance based on length and
 * character-class variety, never an actual entropy calculation and never
 * transmitted anywhere. This is independent of (and does not relax) the
 * existing 8-character minimum validation, and has no bearing on the
 * split-credential auth derivation that already keeps the raw password off
 * the wire (see AGENTS.md) — the server never sees it either way.
 *
 * Below 8 characters always scores "Too short" (0), matching the form's
 * existing hard minimum. From there, length milestones (10, 14 chars) and
 * character-class count (lowercase/uppercase/digit/symbol, out of 4) each
 * contribute a point; the total (0-4) maps directly to the 1-4 score so a
 * short single-class password still floors at "Weak" rather than 0.
 */
export function assessPasswordStrength(password: string): PasswordStrengthResult {
  if (password.length < 8) {
    return { label: "Too short", score: 0 };
  }
  const classCount =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(password) ? 1 : 0);

  let points = 0;
  if (password.length >= 10) points += 1;
  if (password.length >= 14) points += 1;
  if (classCount >= 2) points += 1;
  if (classCount >= 3) points += 1;

  const score = Math.min(4, Math.max(1, points)) as 1 | 2 | 3 | 4;
  const labelsByScore: Record<1 | 2 | 3 | 4, PasswordStrengthLabel> = {
    1: "Weak",
    2: "Fair",
    3: "Good",
    4: "Strong",
  };
  return { label: labelsByScore[score], score };
}

/**
 * Resolves the auth screen's password `<input>` `type` attribute from the
 * "reveal" toggle's boolean state (issue #80) — a small pure wrapper purely
 * so the show/hide behavior is unit-testable without mounting the
 * component. `visible: true` reveals the typed characters (`type="text"`);
 * the default, `false`, masks them (`type="password"`).
 */
export function resolvePasswordInputType(visible: boolean): "text" | "password" {
  return visible ? "text" : "password";
}

/**
 * Accessible label for the auth screen's password-reveal toggle button,
 * describing the action the next click performs (not the current state) —
 * matches how the composer's own icon-button titles ("Insert emoji",
 * "Remove attachment") are phrased.
 */
export function getPasswordVisibilityToggleLabel(visible: boolean): string {
  return visible ? "Hide password" : "Show password";
}

/** A single in-app "new message arrived elsewhere" toast (issue #82). */
export interface MessageNotificationToast {
  /** The triggering message's ID — used as the React key and for de-duplication. */
  id: string;
  conversationId: string;
  conversationTitle: string;
  senderDisplayName: string;
  preview: string;
}

/** Max simultaneous toasts kept on screen; oldest is dropped first once exceeded. */
export const MAX_MESSAGE_TOASTS = 4;

/** How long a toast stays visible before auto-dismissing, in milliseconds. */
export const MESSAGE_TOAST_AUTO_DISMISS_MS = 6000;

/** Soft cap on how much message text a toast preview shows before truncating. */
const TOAST_PREVIEW_MAX_CHARS = 120;

/**
 * Decides whether an incoming realtime message upsert should surface a
 * background-conversation toast (issue #82) — Slack/Discord/Telegram's
 * convention of calling out *which* conversation and *what* (briefly)
 * just arrived, instead of only the sidebar's unread badge ticking up
 * silently. A toast only makes sense when all of the following hold:
 * the message wasn't sent by the viewer themself (own sends/echoes never
 * toast), it isn't for the conversation already open on screen (already
 * visible there), it passed envelope verification and wasn't removed
 * (mirrors the fail-closed `getMessageCopyText` eligibility rule — never
 * surface a preview of content that failed to verify), and its
 * conversation isn't in the viewer's locally muted set (same mute
 * semantics as `sumUnreadExcludingMuted`: a muted chat stays silent
 * everywhere outside its own timeline).
 */
export function shouldShowMessageNotificationToast(
  message: MessageDto,
  currentUserId: string,
  selectedConversationId: string | null,
  mutedConversationIds: string[]
): boolean {
  if (message.sender_id === currentUserId) return false;
  if (message.is_removed || message.status !== "verified") return false;
  if (message.conversation_id === selectedConversationId) return false;
  if (mutedConversationIds.includes(message.conversation_id)) return false;
  return true;
}

/**
 * Builds the short preview line for a message notification toast (issue
 * #82): the message's own text, truncated past `TOAST_PREVIEW_MAX_CHARS`
 * with an ellipsis so one long message can't stretch the toast off
 * screen; for an attachment-only message, a generic "Sent an attachment"
 * (deliberately not the raw filename, which is viewer-chosen and not
 * worth surfacing before the conversation is even opened); otherwise a
 * generic fallback for the (should-be-impossible, since
 * `shouldShowMessageNotificationToast` already filters to verified
 * messages) case of neither text nor an attachment.
 */
export function buildMessageNotificationPreview(message: MessageDto): string {
  const trimmed = message.text?.trim();
  if (trimmed) {
    return trimmed.length > TOAST_PREVIEW_MAX_CHARS
      ? `${trimmed.slice(0, TOAST_PREVIEW_MAX_CHARS)}…`
      : trimmed;
  }
  if (message.attachment) return "Sent an attachment";
  return "Sent a message";
}

/**
 * Appends a new message notification toast (issue #82), de-duplicating by
 * message ID (a realtime upsert replaying the same message shouldn't
 * stack a second toast for it) and capping the list at
 * `MAX_MESSAGE_TOASTS` — dropping the *oldest* toast once the cap is
 * exceeded, so a burst of background activity surfaces the most recent
 * arrivals rather than piling up unboundedly on screen.
 */
export function appendMessageToast(
  toasts: MessageNotificationToast[],
  toast: MessageNotificationToast
): MessageNotificationToast[] {
  const withoutDuplicate = toasts.filter((t) => t.id !== toast.id);
  return [...withoutDuplicate, toast].slice(-MAX_MESSAGE_TOASTS);
}

/**
 * Removes one toast by message ID — used both by its own auto-dismiss
 * timer and the toast's manual close button (issue #82). Returns `toasts`
 * unchanged (same reference) when `id` isn't present, so callers relying
 * on referential equality can skip a redundant re-render.
 */
export function dismissMessageToast(
  toasts: MessageNotificationToast[],
  id: string
): MessageNotificationToast[] {
  if (!toasts.some((t) => t.id === id)) return toasts;
  return toasts.filter((t) => t.id !== id);
}

/** Narrowest the sidebar can be dragged to (issue #94). */
export const MIN_SIDEBAR_WIDTH = 220;
/** Widest the sidebar can be dragged to (issue #94). */
export const MAX_SIDEBAR_WIDTH = 480;
/** The sidebar's original fixed width, used when nothing has been saved yet. */
export const DEFAULT_SIDEBAR_WIDTH = 280;

const SIDEBAR_WIDTH_STORAGE_KEY = "bloop:sidebar-width";

/**
 * Clamps a candidate sidebar width (issue #94) to the
 * `MIN_SIDEBAR_WIDTH`..`MAX_SIDEBAR_WIDTH` range and rounds it to a whole
 * pixel, so a drag gesture that overshoots past either edge of the window
 * (or a corrupt/out-of-range persisted value) never renders a sidebar
 * narrower or wider than the app can sensibly lay out.
 */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

/**
 * Loads the persisted sidebar width (issue #94) from `localStorage`.
 * Stored globally rather than per-user — same reasoning as the
 * dark/light theme preference (issue #56): a low-stakes layout
 * preference not worth plumbing a user ID through `AppShell` for.
 * Falls back to `DEFAULT_SIDEBAR_WIDTH` when nothing is stored,
 * `localStorage` isn't available (e.g. the Vitest `node` test
 * environment), or the stored value is missing/corrupt/non-numeric —
 * this is a best-effort UI preference, never something that should
 * throw and break the app shell from rendering. Always clamped through
 * `clampSidebarWidth`, so a value saved under a previous, wider min/max
 * range still renders sensibly after a narrower range ships later.
 */
export function loadSidebarWidth(): number {
  if (typeof localStorage === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_SIDEBAR_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
    return clampSidebarWidth(parsed);
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

/**
 * Persists the sidebar's dragged width (issue #94) to `localStorage` so
 * it survives an app restart. A no-op (rather than a thrown error) when
 * `localStorage` is unavailable or writing fails (e.g. storage quota) —
 * losing the width preference for this session is an acceptable
 * degradation, never worth surfacing as a user-facing error.
 */
export function saveSidebarWidth(width: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
  } catch {
    // Storage unavailable or full; the sidebar width just won't persist this session.
  }
}

/**
 * Finds the most recent message in `messages` that the current user sent
 * and can actually edit (issue #98) — matches the same eligibility the
 * message bubble's own hover "Edit message" pencil button already
 * requires: verified, not removed, and has text (an attachment-only
 * message has nothing to edit). Used by the composer's Discord/Slack/
 * Twitter "press Up Arrow in an empty composer to edit your last message"
 * shortcut instead of requiring a hover + click on a message that may
 * have scrolled out of view. Returns `null` when there is no such
 * message — nothing sent yet, or every own message is
 * removed/unverified/attachment-only.
 */
export function findLastEditableOwnMessageId(
  messages: MessageDto[],
  currentUserId: string
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate.sender_id !== currentUserId) continue;
    if (candidate.is_removed || candidate.status !== "verified") continue;
    if (!candidate.text) continue;
    return candidate.id;
  }
  return null;
}

/**
 * Decides whether an ArrowUp keypress inside the message composer should
 * trigger the "edit last message" shortcut (issue #98). Only fires when
 * the composer's text is empty — so normal caret movement through a
 * multi-line in-progress draft is never hijacked — and no "@mention"
 * autocomplete dropdown is currently open, since that already claims
 * ArrowUp/ArrowDown for its own candidate navigation (checked ahead of
 * this in the composer's keydown handler either way, but kept here too
 * so this helper stays correct standalone).
 */
export function shouldTriggerEditLastMessage(
  text: string,
  hasMentionDropdownOpen: boolean
): boolean {
  if (hasMentionDropdownOpen) return false;
  return text.length === 0;
}

/**
 * Detects whether `text` contains an "@username" mention of `username`
 * (issue #102) — so the timeline can call out a message that mentions the
 * current viewer (Slack/Discord "you were mentioned" highlight
 * convention), distinct from the composer's own "@mention" autocomplete
 * (issue #88), which is about *typing* a mention rather than *receiving*
 * one. Matches the same token shape `detectMentionQuery`/
 * `applyMentionSelection` produce: an "@" preceded by start-of-string or
 * whitespace, immediately followed by `username` (case-insensitive), with
 * no further word character directly after it — so `@john` matches
 * "john" but `@johnsmith` does not, and an email-like `me@john.com`
 * (the "@" preceded by a word character) never matches either. Returns
 * `false` for blank/null `text` or a blank/whitespace-only `username`.
 */
export function messageMentionsUser(
  text: string | null | undefined,
  username: string
): boolean {
  const trimmedUsername = username.trim();
  if (!text || !trimmedUsername) return false;
  const escaped = trimmedUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\s)@${escaped}(?!\\w)`, "i");
  return pattern.test(text);
}

const COMPOSER_SEND_SHORTCUT_STORAGE_KEY = "bloop:composer-send-shortcut";

/**
 * Which keypress sends a message from the composer (issue #104). `"enter"`
 * (the app's long-standing default) sends on a bare Enter and inserts a
 * newline on Shift+Enter; `"ctrl_enter"` flips that — a bare Enter (or
 * Shift+Enter) always inserts a newline, and only Ctrl+Enter (Cmd+Enter on
 * macOS) sends — matching Slack's "Send messages with ⌘+Return instead"
 * preference, for anyone who writes multi-line drafts and keeps hitting
 * send by accident.
 */
export type ComposerSendShortcut = "enter" | "ctrl_enter";

/**
 * Loads the persisted composer send-shortcut preference from
 * `localStorage` (issue #104). Stored globally (same convention as the
 * dark/light theme preference) rather than per-user, since it's a bare
 * input-habit setting rather than anything tied to an account. Falls back
 * to `"enter"` — the app's original, unconfigurable behavior — when
 * nothing has been explicitly saved yet, `localStorage` is unavailable
 * (e.g. the Vitest `node` test environment), or the stored value is
 * anything other than the two values this module ever writes, since this
 * is a best-effort UI preference that should never throw.
 */
export function loadComposerSendShortcutPreference(): ComposerSendShortcut {
  if (typeof localStorage === "undefined") return "enter";
  try {
    const raw = localStorage.getItem(COMPOSER_SEND_SHORTCUT_STORAGE_KEY);
    return raw === "ctrl_enter" ? "ctrl_enter" : "enter";
  } catch {
    return "enter";
  }
}

/**
 * Persists the composer send-shortcut preference to `localStorage` so it
 * survives an app restart (issue #104). A no-op (rather than a thrown
 * error) when `localStorage` is unavailable or writing fails (e.g. storage
 * quota) — losing this preference for the session is an acceptable
 * degradation, never worth surfacing as a user-facing error.
 */
export function saveComposerSendShortcutPreference(
  preference: ComposerSendShortcut
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(COMPOSER_SEND_SHORTCUT_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable or full; preference just won't persist this session.
  }
}

/**
 * Decides whether an Enter keypress in the composer textarea should send
 * the message, given the current send-shortcut preference (issue #104).
 *
 * - `"enter"`: sends on a bare Enter; Shift+Enter always inserts a newline
 *   instead (the app's original, unconfigurable behavior).
 * - `"ctrl_enter"`: only Ctrl+Enter or Cmd+Enter sends; a bare Enter (with
 *   or without Shift) always inserts a newline, since the textarea's
 *   native behavior already does that once the caller skips calling
 *   `preventDefault()`.
 *
 * Callers should `preventDefault()` and submit only when this returns
 * `true`; otherwise let the keypress fall through to the textarea's
 * default newline-insertion behavior.
 */
export function shouldSubmitComposerOnEnterKeyPress(
  preference: ComposerSendShortcut,
  shiftKey: boolean,
  ctrlKey: boolean,
  metaKey: boolean
): boolean {
  if (preference === "ctrl_enter") return ctrlKey || metaKey;
  return !shiftKey;
}

/** Lightbox zoom range (issue #117): 100% (fit, unzoomed) up to 400%. */
export const MIN_LIGHTBOX_ZOOM = 1;
export const MAX_LIGHTBOX_ZOOM = 4;
const LIGHTBOX_ZOOM_STEP = 0.25;
/** Scroll-wheel sensitivity: pixels of `deltaY` per 1.0 of zoom change. */
const LIGHTBOX_WHEEL_ZOOM_SENSITIVITY = 0.0015;

/**
 * Clamps a candidate image-lightbox zoom level (issue #117) to the
 * `MIN_LIGHTBOX_ZOOM`..`MAX_LIGHTBOX_ZOOM` range, so repeated zoom-in clicks,
 * a fast scroll-wheel gesture, or a non-finite value never scales the
 * previewed image below its normal fit size or past a sensible maximum.
 */
export function clampLightboxZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_LIGHTBOX_ZOOM;
  return Math.min(MAX_LIGHTBOX_ZOOM, Math.max(MIN_LIGHTBOX_ZOOM, zoom));
}

/**
 * Steps the lightbox zoom level by one increment (issue #117) — `+1` for
 * the zoom-in button / `+`/`=` key, `-1` for the zoom-out button / `-` key —
 * clamped to the supported range via `clampLightboxZoom`.
 */
export function stepLightboxZoom(current: number, direction: 1 | -1): number {
  return clampLightboxZoom(current + direction * LIGHTBOX_ZOOM_STEP);
}

/**
 * Converts a mouse-wheel `deltaY` into a new lightbox zoom level (issue
 * #117), matching the Google Photos/Maps "scroll to zoom" convention —
 * scrolling up (negative `deltaY`) zooms in, scrolling down zooms out.
 * Clamped via `clampLightboxZoom` so a fast trackpad fling can't overshoot
 * past either end of the supported range.
 */
export function zoomFromWheelDelta(current: number, deltaY: number): number {
  return clampLightboxZoom(current - deltaY * LIGHTBOX_WHEEL_ZOOM_SENSITIVITY);
}

/**
 * Double-clicking the lightbox image toggles between the normal fit size
 * and a fixed 2x zoom (issue #117), matching the common image-viewer
 * convention — double-click again (now zoomed in, at any level) always
 * returns to `MIN_LIGHTBOX_ZOOM` rather than zooming in further.
 */
export function toggleDoubleClickZoom(current: number): number {
  return current > MIN_LIGHTBOX_ZOOM ? MIN_LIGHTBOX_ZOOM : 2;
}

const APP_ZOOM_STORAGE_KEY = "bloop:app-zoom-level";

/** App-wide text size range: 80% up to 150%, in 10-point steps, default 100%. */
export const MIN_APP_ZOOM = 80;
export const MAX_APP_ZOOM = 150;
export const DEFAULT_APP_ZOOM = 100;
const APP_ZOOM_STEP = 10;

/**
 * Clamps a candidate app-wide text size percentage to the
 * `MIN_APP_ZOOM`..`MAX_APP_ZOOM` range and rounds it to a whole percent, so
 * repeated zoom-in/out clicks, the `Ctrl`/`Cmd` +`=`/`-` keyboard shortcut,
 * or a corrupt/out-of-range persisted value never scales the whole app's
 * text below a legible floor or past a layout-breaking ceiling.
 */
export function clampAppZoomLevel(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_APP_ZOOM;
  return Math.round(Math.min(MAX_APP_ZOOM, Math.max(MIN_APP_ZOOM, zoom)));
}

/**
 * Steps the app-wide text size by one `APP_ZOOM_STEP` increment — `+1` for
 * zoom-in (the "+" control / `Ctrl`/`Cmd`+`=`), `-1` for zoom-out (the "-"
 * control / `Ctrl`/`Cmd`+`-`) — clamped via `clampAppZoomLevel`.
 */
export function stepAppZoomLevel(current: number, direction: 1 | -1): number {
  return clampAppZoomLevel(current + direction * APP_ZOOM_STEP);
}

/**
 * Loads the persisted app-wide text size preference from `localStorage`.
 * Stored globally rather than per-user — same reasoning as the dark/light
 * theme preference (issue #56): a low-stakes display preference not worth
 * plumbing a user ID through `App` for. Falls back to `DEFAULT_APP_ZOOM`
 * when nothing is stored, `localStorage` isn't available (e.g. the Vitest
 * `node` test environment), or the stored value is missing/corrupt/
 * non-numeric — this is a best-effort UI preference, never something that
 * should throw and break the app shell from rendering. Always clamped
 * through `clampAppZoomLevel`, so a value saved under a previous, wider
 * min/max range still renders sensibly after a narrower range ships later.
 */
export function loadAppZoomPreference(): number {
  if (typeof localStorage === "undefined") return DEFAULT_APP_ZOOM;
  try {
    const raw = localStorage.getItem(APP_ZOOM_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_ZOOM;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_APP_ZOOM;
    return clampAppZoomLevel(parsed);
  } catch {
    return DEFAULT_APP_ZOOM;
  }
}

/**
 * Persists the app-wide text size preference to `localStorage` so it
 * survives an app restart. A no-op (rather than a thrown error) when
 * `localStorage` is unavailable or writing fails (e.g. storage quota) —
 * losing the zoom preference for this session is an acceptable
 * degradation, never worth surfacing as a user-facing error.
 */
export function saveAppZoomPreference(zoom: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(APP_ZOOM_STORAGE_KEY, String(clampAppZoomLevel(zoom)));
  } catch {
    // Storage unavailable or full; the zoom preference just won't persist this session.
  }
}

/**
 * Decides what the app-wide text size shortcut should do for a given
 * keydown, matching the browser's own `Ctrl`/`Cmd` + `=` / `-` / `0` page
 * zoom convention (there is nothing for a real browser zoom to act on
 * inside a desktop webview shell, so the app claims the combo for its own
 * text-size preference instead). Requires `Ctrl`/`Cmd` to be held — never
 * suppressed while typing in an editable field, since holding that
 * modifier means the browser would not insert a literal "="/"-"/"0"
 * character into the field anyway, so there's nothing to protect by
 * checking the active element. Returns `null` for every other key
 * combination.
 */
export function resolveAppZoomShortcutAction(
  key: string,
  ctrlOrMetaKey: boolean
): "zoom_in" | "zoom_out" | "reset" | null {
  if (!ctrlOrMetaKey) return null;
  if (key === "=" || key === "+") return "zoom_in";
  if (key === "-" || key === "_") return "zoom_out";
  if (key === "0") return "reset";
  return null;
}

/**
 * The lightweight-Markdown inline format markers already rendered by
 * message bubbles (issue #113), keyed by the format name used by
 * `resolveComposerFormatShortcut`/`toggleInlineFormatMarker`.
 */
export const INLINE_FORMAT_MARKERS = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
} as const;

export type ComposerFormatShortcut = keyof typeof INLINE_FORMAT_MARKERS;

/**
 * Decides which inline-format marker (if any) a composer keydown should
 * toggle — `Ctrl`/`Cmd` + `B` (bold), `Ctrl`/`Cmd` + `I` (italic), or
 * `Ctrl`/`Cmd` + `Shift` + `X` (strikethrough) — matching the Word/Google
 * Docs/Slack text-editor convention, so the three inline markers the
 * message bubble already renders (issue #113) no longer have to be typed
 * blind by hand. Returns `null` for every other key combination so the
 * caller lets the keystroke fall through untouched (e.g. a bare "b"
 * still types a letter).
 */
export function resolveComposerFormatShortcut(
  key: string,
  ctrlOrMetaKey: boolean,
  shiftKey: boolean
): ComposerFormatShortcut | null {
  if (!ctrlOrMetaKey) return null;
  const lowerKey = key.toLowerCase();
  if (!shiftKey && lowerKey === "b") return "bold";
  if (!shiftKey && lowerKey === "i") return "italic";
  if (shiftKey && lowerKey === "x") return "strikethrough";
  return null;
}

/** Result of `toggleInlineFormatMarker`: the new text plus the selection to restore. */
export interface FormatToggleResult {
  /** The full text after toggling the marker around the selected range. */
  text: string;
  /** Selection start to restore after the toggle. */
  selectionStart: number;
  /** Selection end to restore after the toggle (equals `selectionStart` when nothing was/is selected). */
  selectionEnd: number;
}

/**
 * Toggles a lightweight-Markdown inline format marker (`**bold**`,
 * `*italic*`, or `~~strikethrough~~` — the same markers the message
 * bubble already renders, issue #113) around the composer's current
 * selection (`selectionStart`..`selectionEnd`, clamped to the text's
 * bounds and swapped if given out of order). With a non-empty selection,
 * wraps it in the marker — or, if the selection is already wrapped by
 * exactly that marker on both sides, un-wraps it (toggle back off,
 * matching the Docs/Word convention of pressing the same combo twice).
 * With an empty selection, inserts an empty marker pair and leaves the
 * caret between them, ready to type. Pure text manipulation — the
 * composer only ever holds plain text, so this never touches encryption
 * or the wire format.
 */
export function toggleInlineFormatMarker(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string
): FormatToggleResult {
  const length = text.length;
  const start = Math.max(0, Math.min(length, selectionStart, selectionEnd));
  const end = Math.max(0, Math.min(length, Math.max(selectionStart, selectionEnd)));
  const markerLen = marker.length;

  const hasSelection = end > start;
  const alreadyWrapped =
    hasSelection &&
    text.slice(Math.max(0, start - markerLen), start) === marker &&
    text.slice(end, end + markerLen) === marker;

  if (alreadyWrapped) {
    const nextText =
      text.slice(0, start - markerLen) + text.slice(start, end) + text.slice(end + markerLen);
    return { text: nextText, selectionStart: start - markerLen, selectionEnd: end - markerLen };
  }

  const nextText = text.slice(0, start) + marker + text.slice(start, end) + marker + text.slice(end);
  const newStart = start + markerLen;
  const newEnd = hasSelection ? end + markerLen : newStart;
  return { text: nextText, selectionStart: newStart, selectionEnd: newEnd };
}
