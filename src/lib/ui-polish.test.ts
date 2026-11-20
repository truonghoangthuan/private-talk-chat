import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assessPasswordStrength,
  getPasswordVisibilityToggleLabel,
  resolvePasswordInputType,
  buildConversationPreviewLabel,
  buildEmojiPickerOrder,
  buildTimelineItems,
  computeComposerCharacterState,
  computeDocumentTitle,
  computeScrollFollowState,
  filterContacts,
  filterConversations,
  filterPinnedMessages,
  filterUnreadOnlyConversations,
  findMessageSearchMatches,
  findUnreadDividerMessageId,
  formatFullMessageTimestamp,
  formatMessageTimestamp,
  formatOfflineDuration,
  getAdjacentConversationId,
  getAttachmentPreviewKind,
  getConversationSwitchDirection,
  getConversationTitle,
  getDraft,
  getMessageCopyText,
  insertTextAtCursor,
  isScrolledNearBottom,
  KEYBOARD_SHORTCUTS,
  loadRecentEmojis,
  loadMutedConversationIds,
  loadThemePreference,
  QUICK_EMOJIS,
  recordRecentEmoji,
  resolveComposerEscapeAction,
  resolveMessageBubbleEscapeAction,
  saveMutedConversationIds,
  saveRecentEmojis,
  saveThemePreference,
  shouldOpenConversationSearch,
  shouldOpenMediaLightbox,
  shouldOpenShortcutsHelp,
  shouldFocusConversationFilter,
  shouldSubmitMessageEditOnKeyDown,
  sortConversationsForSidebar,
  splitMessageTextIntoLinkSegments,
  splitTextForSearchHighlight,
  sumUnreadExcludingMuted,
  syncPinnedMessage,
  toggleMutedConversationId,
  togglePinnedConversationId,
  updateDraft,
  upsertMessageWithReplySync,
  validateAttachmentFile,
  shouldShowMessageNotificationToast,
  buildMessageNotificationPreview,
  appendMessageToast,
  dismissMessageToast,
  MAX_MESSAGE_TOASTS,
} from "./ui-polish";
import type { ContactDto, ConversationDto, MessageDto, PinnedMessageDto } from "./types";
import type { MessageNotificationToast } from "./ui-polish";

function makeMsg(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "m1",
    conversation_id: "c1",
    sender_id: "u1",
    sender_username: "alice",
    sender_display_name: "Alice",
    sender_avatar_url: null,
    epoch: 1,
    status: "verified",
    text: "hello",
    attachment: null,
    reply_to: null,
    is_pinned: false,
    pinned_at: null,
    pinned_by_display_name: null,
    is_edited: false,
    edited_at: null,
    is_removed: false,
    removed_at: null,
    created_at: "2026-11-20T00:00:00Z",
    seen_by: [],
    ...overrides,
  };
}

describe("upsertMessageWithReplySync & syncPinnedMessage", () => {
  it("propagates parent edit and removal to reply_to previews", () => {
    const parent = makeMsg({ id: "m1", text: "original" });
    const reply = makeMsg({
      id: "m2",
      text: "reply",
      reply_to: {
        message_id: "m1",
        sender_id: "u1",
        sender_display_name: "Alice",
        status: "verified",
        text: "original",
        has_attachment: false,
        attachment_mime: null,
        is_edited: false,
      },
    });

    const afterEdit = upsertMessageWithReplySync(
      [parent, reply],
      makeMsg({ id: "m1", text: "edited text", is_edited: true })
    );
    expect(afterEdit[1].reply_to?.text).toBe("edited text");
    expect(afterEdit[1].reply_to?.is_edited).toBe(true);

    const afterRemove = upsertMessageWithReplySync(
      afterEdit,
      makeMsg({ id: "m1", status: "removed", is_removed: true, text: null })
    );
    expect(afterRemove[1].reply_to?.status).toBe("removed");
    expect(afterRemove[1].reply_to?.text).toBeNull();
    expect(afterRemove[1].reply_to?.has_attachment).toBe(false);
  });

  it("updates edited pinned messages and prunes removed ones", () => {
    const pin: PinnedMessageDto = {
      conversation_id: "c1",
      message_id: "m1",
      pinned_by_id: "u1",
      pinned_by_display_name: "Alice",
      pinned_at: "2026-11-20T00:01:00Z",
      message: makeMsg({ id: "m1", text: "original", is_pinned: true }),
    };

    const edited = syncPinnedMessage(
      [pin],
      makeMsg({ id: "m1", text: "updated", is_edited: true, is_pinned: true })
    );
    expect(edited).toHaveLength(1);
    expect(edited[0].message.text).toBe("updated");
    expect(edited[0].message.is_edited).toBe(true);

    const removed = syncPinnedMessage(
      edited,
      makeMsg({ id: "m1", status: "removed", is_removed: true, text: null })
    );
    expect(removed).toHaveLength(0);
  });
});

describe("getMessageCopyText", () => {
  it("returns trimmed text for a verified text message", () => {
    expect(getMessageCopyText(makeMsg({ text: "  hello world  " }))).toBe("hello world");
  });

  it("returns null for removed messages", () => {
    expect(
      getMessageCopyText(makeMsg({ is_removed: true, status: "removed", text: null }))
    ).toBeNull();
  });

  it("returns null for messages that failed verification", () => {
    expect(
      getMessageCopyText(makeMsg({ status: "verification_failed", text: null }))
    ).toBeNull();
  });

  it("returns null for attachment-only messages with no caption text", () => {
    expect(
      getMessageCopyText(
        makeMsg({
          text: null,
          attachment: {
            mime_type: "image/png",
            file_name: "photo.png",
            size_bytes: 1024,
            media_url: "privatetalk-media://localhost/c1/m1",
          },
        })
      )
    ).toBeNull();
  });

  it("returns null for blank/whitespace-only text", () => {
    expect(getMessageCopyText(makeMsg({ text: "   " }))).toBeNull();
  });
});

function makeConv(overrides: Partial<ConversationDto> = {}): ConversationDto {
  return {
    id: "c1",
    is_group: false,
    name: null,
    host_id: null,
    current_epoch: 1,
    members: [
      {
        user_id: "u1",
        username: "me",
        display_name: "Me",
        avatar_url: null,
        is_online: true,
        is_host: false,
        joined_at: "2026-11-20T00:00:00Z",
      },
      {
        user_id: "u2",
        username: "bob_builder",
        display_name: "Bob Builder",
        avatar_url: null,
        is_online: false,
        is_host: false,
        joined_at: "2026-11-20T00:00:00Z",
      },
    ],
    latest_preview: "See you tomorrow",
    latest_timestamp: "2026-11-20T00:00:00Z",
    unread_count: 0,
    updated_at: "2026-11-20T00:00:00Z",
    ...overrides,
  };
}

describe("getConversationTitle", () => {
  it("uses the group name for groups, falling back to Untitled Group", () => {
    expect(
      getConversationTitle(makeConv({ is_group: true, name: "Weekend Trip" }), "u1")
    ).toBe("Weekend Trip");
    expect(getConversationTitle(makeConv({ is_group: true, name: null }), "u1")).toBe(
      "Untitled Group"
    );
  });

  it("uses the peer's display name for direct chats, falling back to username then Direct Chat", () => {
    expect(getConversationTitle(makeConv(), "u1")).toBe("Bob Builder");

    const noDisplayName = makeConv();
    noDisplayName.members[1] = { ...noDisplayName.members[1], display_name: "" };
    expect(getConversationTitle(noDisplayName, "u1")).toBe("bob_builder");

    expect(getConversationTitle(makeConv({ members: [] }), "u1")).toBe("Direct Chat");
  });
});

describe("filterConversations", () => {
  const direct = makeConv({ id: "c1" });
  const group = makeConv({
    id: "c2",
    is_group: true,
    name: "Engineering Team",
    latest_preview: "Deploy is green",
    members: [],
  });

  it("returns every conversation unchanged for a blank query", () => {
    expect(filterConversations([direct, group], "", "u1")).toEqual([direct, group]);
    expect(filterConversations([direct, group], "   ", "u1")).toEqual([direct, group]);
  });

  it("matches case-insensitively against the resolved title", () => {
    expect(filterConversations([direct, group], "bob", "u1")).toEqual([direct]);
    expect(filterConversations([direct, group], "ENGINEERING", "u1")).toEqual([group]);
  });

  it("matches against the latest message preview", () => {
    expect(filterConversations([direct, group], "deploy", "u1")).toEqual([group]);
    expect(filterConversations([direct, group], "see you", "u1")).toEqual([direct]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterConversations([direct, group], "nonexistent", "u1")).toEqual([]);
  });
});

describe("filterUnreadOnlyConversations", () => {
  const read = makeConv({ id: "c1", unread_count: 0 });
  const unread = makeConv({ id: "c2", unread_count: 3 });

  it("returns every conversation unchanged (same reference) when unreadOnly is false", () => {
    const input = [read, unread];
    expect(filterUnreadOnlyConversations(input, false)).toBe(input);
  });

  it("keeps only conversations with unread_count > 0 when unreadOnly is true", () => {
    expect(filterUnreadOnlyConversations([read, unread], true)).toEqual([unread]);
  });

  it("returns an empty list when nothing is unread", () => {
    expect(filterUnreadOnlyConversations([read], true)).toEqual([]);
  });
});

describe("togglePinnedConversationId", () => {
  it("pins an unpinned conversation by appending its ID", () => {
    expect(togglePinnedConversationId([], "c1")).toEqual(["c1"]);
    expect(togglePinnedConversationId(["c1"], "c2")).toEqual(["c1", "c2"]);
  });

  it("unpins an already-pinned conversation by removing its ID", () => {
    expect(togglePinnedConversationId(["c1", "c2"], "c1")).toEqual(["c2"]);
    expect(togglePinnedConversationId(["c1"], "c1")).toEqual([]);
  });

  it("always returns a new array (never mutates the input)", () => {
    const original = ["c1"];
    const result = togglePinnedConversationId(original, "c2");
    expect(result).not.toBe(original);
    expect(original).toEqual(["c1"]);
  });
});

describe("sortConversationsForSidebar", () => {
  const c1 = makeConv({ id: "c1" });
  const c2 = makeConv({ id: "c2" });
  const c3 = makeConv({ id: "c3" });

  it("returns the list unchanged when nothing is pinned", () => {
    const list = [c1, c2, c3];
    expect(sortConversationsForSidebar(list, [])).toBe(list);
  });

  it("moves pinned conversations to the top, preserving relative order within each group", () => {
    expect(sortConversationsForSidebar([c1, c2, c3], ["c3"])).toEqual([c3, c1, c2]);
    expect(sortConversationsForSidebar([c1, c2, c3], ["c3", "c1"])).toEqual([c1, c3, c2]);
  });

  it("ignores pinned IDs that no longer match any conversation in the list", () => {
    expect(sortConversationsForSidebar([c1, c2], ["gone"])).toEqual([c1, c2]);
  });
});

describe("toggleMutedConversationId", () => {
  it("mutes an unmuted conversation by appending its ID", () => {
    expect(toggleMutedConversationId([], "c1")).toEqual(["c1"]);
    expect(toggleMutedConversationId(["c1"], "c2")).toEqual(["c1", "c2"]);
  });

  it("unmutes an already-muted conversation by removing its ID", () => {
    expect(toggleMutedConversationId(["c1", "c2"], "c1")).toEqual(["c2"]);
    expect(toggleMutedConversationId(["c1"], "c1")).toEqual([]);
  });

  it("always returns a new array (never mutates the input)", () => {
    const original = ["c1"];
    const result = toggleMutedConversationId(original, "c2");
    expect(result).not.toBe(original);
    expect(original).toEqual(["c1"]);
  });
});

describe("loadMutedConversationIds / saveMutedConversationIds", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
    } as Storage;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("returns an empty array when nothing is stored", () => {
    expect(loadMutedConversationIds("u1")).toEqual([]);
  });

  it("round-trips a saved muted set", () => {
    saveMutedConversationIds("u1", ["c1", "c2"]);
    expect(loadMutedConversationIds("u1")).toEqual(["c1", "c2"]);
  });

  it("scopes the muted set per user", () => {
    saveMutedConversationIds("u1", ["c1"]);
    saveMutedConversationIds("u2", ["c2"]);
    expect(loadMutedConversationIds("u1")).toEqual(["c1"]);
    expect(loadMutedConversationIds("u2")).toEqual(["c2"]);
  });

  it("returns an empty array for a corrupt/unexpected stored value", () => {
    store["bloop:muted-conversations:u1"] = "not-an-array";
    expect(loadMutedConversationIds("u1")).toEqual([]);
  });

  it("returns an empty array when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadMutedConversationIds("u1")).toEqual([]);
    expect(() => saveMutedConversationIds("u1", ["c1"])).not.toThrow();
  });
});

describe("sumUnreadExcludingMuted", () => {
  const c1 = makeConv({ id: "c1", unread_count: 3 });
  const c2 = makeConv({ id: "c2", unread_count: 5 });
  const c3 = makeConv({ id: "c3", unread_count: 0 });

  it("sums every conversation's unread_count when nothing is muted", () => {
    expect(sumUnreadExcludingMuted([c1, c2, c3], [])).toBe(8);
  });

  it("excludes muted conversations from the total", () => {
    expect(sumUnreadExcludingMuted([c1, c2, c3], ["c2"])).toBe(3);
    expect(sumUnreadExcludingMuted([c1, c2, c3], ["c1", "c2"])).toBe(0);
  });

  it("ignores muted IDs that don't match any conversation in the list", () => {
    expect(sumUnreadExcludingMuted([c1, c2], ["gone"])).toBe(8);
  });
});

describe("loadThemePreference / saveThemePreference", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
    } as Storage;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("falls back to the system preference when nothing has been saved yet", () => {
    expect(loadThemePreference(true)).toBe(true);
    expect(loadThemePreference(false)).toBe(false);
  });

  it("round-trips an explicitly saved preference, overriding the system default", () => {
    saveThemePreference(false);
    expect(loadThemePreference(true)).toBe(false);

    saveThemePreference(true);
    expect(loadThemePreference(false)).toBe(true);
  });

  it("falls back to the system preference when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadThemePreference(true)).toBe(true);
    expect(() => saveThemePreference(false)).not.toThrow();
  });

  it("falls back to the system preference on a corrupt/unexpected stored value", () => {
    store["bloop:dark-mode"] = "not-a-valid-theme";
    expect(loadThemePreference(false)).toBe(false);
  });
});

describe("isScrolledNearBottom", () => {
  it("is true when flush against the bottom edge", () => {
    expect(isScrolledNearBottom(880, 1000, 120, 120)).toBe(true);
  });

  it("is true within the default 120px threshold", () => {
    expect(isScrolledNearBottom(800, 1000, 120, 120)).toBe(true);
  });

  it("is false once scrolled past the threshold", () => {
    expect(isScrolledNearBottom(400, 1000, 120, 120)).toBe(false);
  });

  it("is true for a short list that doesn't overflow the viewport", () => {
    expect(isScrolledNearBottom(0, 100, 400, 120)).toBe(true);
  });

  it("honors a custom threshold", () => {
    expect(isScrolledNearBottom(700, 1000, 120, 200)).toBe(true);
    expect(isScrolledNearBottom(700, 1000, 120, 150)).toBe(false);
  });
});

describe("computeScrollFollowState", () => {
  it("auto-scrolls and clears unseen when already near the bottom", () => {
    expect(computeScrollFollowState(10, 11, true, 0)).toEqual({
      shouldAutoScroll: true,
      unseenCount: 0,
    });
  });

  it("auto-scrolls when nothing was actually added (edit/removal), even scrolled up", () => {
    expect(computeScrollFollowState(10, 10, false, 3)).toEqual({
      shouldAutoScroll: true,
      unseenCount: 0,
    });
  });

  it("accumulates unseen count instead of scrolling when reading history", () => {
    expect(computeScrollFollowState(10, 11, false, 0)).toEqual({
      shouldAutoScroll: false,
      unseenCount: 1,
    });
  });

  it("keeps accumulating unseen count across repeated updates while scrolled up", () => {
    const first = computeScrollFollowState(10, 11, false, 0);
    const second = computeScrollFollowState(11, 13, false, first.unseenCount);
    expect(second).toEqual({ shouldAutoScroll: false, unseenCount: 3 });
  });

  it("resets unseen count back to zero once the viewer scrolls back near the bottom", () => {
    expect(computeScrollFollowState(13, 14, true, 3)).toEqual({
      shouldAutoScroll: true,
      unseenCount: 0,
    });
  });
});

describe("updateDraft & getDraft", () => {
  it("stores a draft and reads it back for the right conversation only", () => {
    let drafts = updateDraft({}, "c1", "hello there");
    expect(getDraft(drafts, "c1")).toBe("hello there");
    expect(getDraft(drafts, "c2")).toBe("");

    drafts = updateDraft(drafts, "c2", "second conversation draft");
    expect(getDraft(drafts, "c1")).toBe("hello there");
    expect(getDraft(drafts, "c2")).toBe("second conversation draft");
  });

  it("returns an empty string for a null conversation id", () => {
    expect(getDraft({ c1: "leftover" }, null)).toBe("");
  });

  it("clears the entry when text is blank or whitespace-only", () => {
    const withDraft = updateDraft({}, "c1", "draft text");
    const cleared = updateDraft(withDraft, "c1", "   ");
    expect(getDraft(cleared, "c1")).toBe("");
    expect(Object.keys(cleared)).not.toContain("c1");
  });

  it("returns the same map reference when the update is a no-op", () => {
    const empty: Record<string, string> = {};
    expect(updateDraft(empty, "c1", "")).toBe(empty);

    const withDraft = updateDraft({}, "c1", "same text");
    expect(updateDraft(withDraft, "c1", "same text")).toBe(withDraft);
  });

  it("never leaks one conversation's draft into another's", () => {
    const afterTypingInC1 = updateDraft({}, "c1", "draft for c1");
    // Switching to c2 should read an empty draft, not c1's leftover text.
    expect(getDraft(afterTypingInC1, "c2")).toBe("");
  });
});

describe("buildConversationPreviewLabel", () => {
  it("prefixes a non-empty draft with 'Draft: ' and flags it as a draft", () => {
    expect(buildConversationPreviewLabel("their last message", "hey there")).toEqual({
      text: "Draft: hey there",
      isDraft: true,
    });
  });

  it("falls back to the latest message preview when there is no draft", () => {
    expect(buildConversationPreviewLabel("their last message", "")).toEqual({
      text: "their last message",
      isDraft: false,
    });
  });

  it("falls back to the empty-channel placeholder when both are blank", () => {
    expect(buildConversationPreviewLabel(null, "   ")).toEqual({
      text: "Encrypted channel ready",
      isDraft: false,
    });
    expect(buildConversationPreviewLabel(undefined, "")).toEqual({
      text: "Encrypted channel ready",
      isDraft: false,
    });
  });

  it("treats a whitespace-only draft as no draft at all", () => {
    expect(buildConversationPreviewLabel("their last message", "   ")).toEqual({
      text: "their last message",
      isDraft: false,
    });
  });

  it("trims the draft text before prefixing it", () => {
    expect(buildConversationPreviewLabel(null, "  padded draft  ")).toEqual({
      text: "Draft: padded draft",
      isDraft: true,
    });
  });

  it("accepts a custom empty-channel placeholder", () => {
    expect(buildConversationPreviewLabel(null, "", "No messages yet")).toEqual({
      text: "No messages yet",
      isDraft: false,
    });
  });
});

describe("formatMessageTimestamp", () => {
  const referenceNow = new Date(2026, 10, 20, 15, 30); // Nov 20, 2026, 15:30 local

  it("returns no date label for a message sent earlier the same day", () => {
    const sentToday = new Date(2026, 10, 20, 9, 5).toISOString();
    const { dateLabel } = formatMessageTimestamp(sentToday, referenceNow);
    expect(dateLabel).toBeNull();
  });

  it('labels a message sent the previous calendar day as "Yesterday"', () => {
    const sentYesterday = new Date(2026, 10, 19, 23, 59).toISOString();
    const { dateLabel } = formatMessageTimestamp(sentYesterday, referenceNow);
    expect(dateLabel).toBe("Yesterday");
  });

  it("uses a short date without a year for an older message in the same year", () => {
    const sentEarlierThisYear = new Date(2026, 10, 18, 12, 0).toISOString();
    const { dateLabel } = formatMessageTimestamp(sentEarlierThisYear, referenceNow);
    expect(dateLabel).not.toBeNull();
    expect(dateLabel).not.toContain("2026");
  });

  it("includes the year for a message sent in a prior year", () => {
    const sentLastYear = new Date(2025, 10, 18, 12, 0).toISOString();
    const { dateLabel } = formatMessageTimestamp(sentLastYear, referenceNow);
    expect(dateLabel).toContain("2025");
  });

  it("treats a future-dated message (clock skew) the same as today: no date label", () => {
    const sentInFuture = new Date(2026, 10, 21, 8, 0).toISOString();
    const { dateLabel } = formatMessageTimestamp(sentInFuture, referenceNow);
    expect(dateLabel).toBeNull();
  });

  it("always returns a non-empty time label regardless of date bucket", () => {
    const sentLongAgo = new Date(2024, 0, 1, 7, 45).toISOString();
    const { timeLabel } = formatMessageTimestamp(sentLongAgo, referenceNow);
    expect(timeLabel.length).toBeGreaterThan(0);
  });
});

describe("formatFullMessageTimestamp", () => {
  it("includes the full weekday, month, day, and year", () => {
    const sent = new Date(2025, 10, 20, 14, 32, 45).toISOString();
    const full = formatFullMessageTimestamp(sent);
    expect(full).toContain("Thursday");
    expect(full).toContain("November");
    expect(full).toContain("20");
    expect(full).toContain("2025");
  });

  it("includes seconds, unlike the compact formatMessageTimestamp time label", () => {
    const sent = new Date(2025, 10, 20, 14, 32, 45).toISOString();
    const full = formatFullMessageTimestamp(sent);
    const { timeLabel } = formatMessageTimestamp(sent);
    expect(full.length).toBeGreaterThan(timeLabel.length);
    expect(full).not.toBe(timeLabel);
  });

  it("joins the date and time with a connecting word", () => {
    const sent = new Date(2025, 0, 1, 0, 0, 0).toISOString();
    expect(formatFullMessageTimestamp(sent)).toContain(" at ");
  });

  it("produces a different full timestamp for messages on different days", () => {
    const first = formatFullMessageTimestamp(new Date(2025, 10, 20, 9, 0).toISOString());
    const second = formatFullMessageTimestamp(new Date(2025, 10, 21, 9, 0).toISOString());
    expect(first).not.toBe(second);
  });
});

describe("computeComposerCharacterState", () => {
  it("hides the counter while comfortably under the limit", () => {
    expect(computeComposerCharacterState(10, 100)).toEqual({
      show: false,
      remaining: 90,
      isNearLimit: false,
      isOverLimit: false,
    });
  });

  it("keeps the counter hidden right up to the 80% threshold", () => {
    expect(computeComposerCharacterState(79, 100)).toEqual({
      show: false,
      remaining: 21,
      isNearLimit: false,
      isOverLimit: false,
    });
  });

  it("shows an amber near-limit counter once within the last 20% of the limit", () => {
    expect(computeComposerCharacterState(80, 100)).toEqual({
      show: true,
      remaining: 20,
      isNearLimit: true,
      isOverLimit: false,
    });
  });

  it("shows exactly at the limit as near-limit, not yet over", () => {
    expect(computeComposerCharacterState(100, 100)).toEqual({
      show: true,
      remaining: 0,
      isNearLimit: true,
      isOverLimit: false,
    });
  });

  it("flips to the over-limit state once length exceeds the limit", () => {
    expect(computeComposerCharacterState(101, 100)).toEqual({
      show: true,
      remaining: -1,
      isNearLimit: true,
      isOverLimit: true,
    });
  });

  it("reports a larger negative remaining count the further over the limit it goes", () => {
    const state = computeComposerCharacterState(150, 100);
    expect(state.isOverLimit).toBe(true);
    expect(state.remaining).toBe(-50);
  });

  it("defaults to the shared soft limit when none is passed", () => {
    const farState = computeComposerCharacterState(1000);
    expect(farState.show).toBe(false);
    const nearState = computeComposerCharacterState(3300);
    expect(nearState.show).toBe(true);
  });
});

describe("resolveComposerEscapeAction", () => {
  it("cancels the reply when a reply is active, regardless of attachment state", () => {
    expect(resolveComposerEscapeAction(true, false)).toBe("cancel_reply");
    expect(resolveComposerEscapeAction(true, true)).toBe("cancel_reply");
  });

  it("clears the attachment when there's no reply but an attachment is staged", () => {
    expect(resolveComposerEscapeAction(false, true)).toBe("clear_attachment");
  });

  it("does nothing when there's neither a reply nor an attachment", () => {
    expect(resolveComposerEscapeAction(false, false)).toBe("none");
  });

  it("closes an open emoji picker before anything else", () => {
    expect(resolveComposerEscapeAction(true, true, true)).toBe("close_emoji_picker");
    expect(resolveComposerEscapeAction(false, false, true)).toBe("close_emoji_picker");
  });

  it("defaults the emoji picker flag to closed when omitted", () => {
    expect(resolveComposerEscapeAction(false, true)).toBe("clear_attachment");
  });
});

describe("insertTextAtCursor", () => {
  it("inserts at the caret when there's no selection", () => {
    expect(insertTextAtCursor("hi !", 3, 3, "👍")).toEqual({ text: "hi 👍!", cursor: 5 });
  });

  it("replaces a selected range like typing over it", () => {
    expect(insertTextAtCursor("hello world", 6, 11, "there")).toEqual({
      text: "hello there",
      cursor: 11,
    });
  });

  it("appends when the cursor is at the end of the text", () => {
    // Emoji outside the Basic Multilingual Plane are UTF-16 surrogate pairs,
    // so the cursor advances by the emoji's UTF-16 length, not 1.
    expect(insertTextAtCursor("gg", 2, 2, "🎉")).toEqual({ text: "gg🎉", cursor: 4 });
  });

  it("inserts into empty text", () => {
    expect(insertTextAtCursor("", 0, 0, "🔥")).toEqual({ text: "🔥", cursor: 2 });
  });

  it("clamps out-of-bounds selection to the text length", () => {
    expect(insertTextAtCursor("abc", 10, 20, "!")).toEqual({ text: "abc!", cursor: 4 });
  });

  it("handles a reversed selection (end before start) the same as a forward one", () => {
    expect(insertTextAtCursor("hello world", 11, 6, "there")).toEqual({
      text: "hello there",
      cursor: 11,
    });
  });
});

describe("QUICK_EMOJIS", () => {
  it("is a non-empty list of unique, non-blank emoji", () => {
    expect(QUICK_EMOJIS.length).toBeGreaterThan(0);
    expect(new Set(QUICK_EMOJIS).size).toBe(QUICK_EMOJIS.length);
    for (const emoji of QUICK_EMOJIS) {
      expect(emoji.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("recordRecentEmoji", () => {
  it("adds a newly-used emoji to the front of an empty list", () => {
    expect(recordRecentEmoji([], "🔥")).toEqual(["🔥"]);
  });

  it("moves an already-recorded emoji to the front instead of duplicating it", () => {
    expect(recordRecentEmoji(["🔥", "👍", "🎉"], "👍")).toEqual(["👍", "🔥", "🎉"]);
  });

  it("caps the list at 8 entries, dropping the oldest", () => {
    const eightOldest = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(recordRecentEmoji(eightOldest, "new")).toEqual([
      "new", "a", "b", "c", "d", "e", "f", "g",
    ]);
  });
});

describe("buildEmojiPickerOrder", () => {
  it("returns the curated list unchanged when nothing has been used yet", () => {
    expect(buildEmojiPickerOrder(QUICK_EMOJIS, [])).toBe(QUICK_EMOJIS);
  });

  it("floats recently-used emoji to the front, most recent first", () => {
    expect(buildEmojiPickerOrder(["😀", "😂", "👍", "🔥"], ["🔥", "👍"])).toEqual([
      "🔥", "👍", "😀", "😂",
    ]);
  });

  it("ignores recent entries that aren't part of the curated list", () => {
    expect(buildEmojiPickerOrder(["😀", "😂"], ["🛑", "😂"])).toEqual(["😂", "😀"]);
  });
});

describe("loadRecentEmojis / saveRecentEmojis", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
    } as Storage;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("returns an empty array when nothing has been saved yet", () => {
    expect(loadRecentEmojis()).toEqual([]);
  });

  it("round-trips a saved recent-emoji list", () => {
    saveRecentEmojis(["🔥", "👍"]);
    expect(loadRecentEmojis()).toEqual(["🔥", "👍"]);
  });

  it("returns an empty array when localStorage is unavailable", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadRecentEmojis()).toEqual([]);
    expect(() => saveRecentEmojis(["🔥"])).not.toThrow();
  });

  it("returns an empty array on a corrupt/unexpected stored value", () => {
    store["bloop:recent-emoji"] = JSON.stringify({ not: "an array" });
    expect(loadRecentEmojis()).toEqual([]);
  });

  it("filters out non-string entries from a malformed stored array", () => {
    store["bloop:recent-emoji"] = JSON.stringify(["🔥", 42, null, "👍"]);
    expect(loadRecentEmojis()).toEqual(["🔥", "👍"]);
  });
});

describe("resolveMessageBubbleEscapeAction", () => {
  it("cancels an in-progress edit, regardless of remove-confirm state", () => {
    expect(resolveMessageBubbleEscapeAction(true, false)).toBe("cancel_edit");
    expect(resolveMessageBubbleEscapeAction(true, true)).toBe("cancel_edit");
  });

  it("dismisses the remove-confirmation prompt when not editing", () => {
    expect(resolveMessageBubbleEscapeAction(false, true)).toBe("cancel_remove_confirm");
  });

  it("does nothing when neither editing nor confirming a remove", () => {
    expect(resolveMessageBubbleEscapeAction(false, false)).toBe("none");
  });
});

describe("shouldOpenMediaLightbox", () => {
  it("opens the lightbox for any image mime type", () => {
    expect(shouldOpenMediaLightbox("image/png")).toBe(true);
    expect(shouldOpenMediaLightbox("image/jpeg")).toBe(true);
    expect(shouldOpenMediaLightbox("image/webp")).toBe(true);
    expect(shouldOpenMediaLightbox("image/gif")).toBe(true);
  });

  it("does not open the lightbox for video, since <video controls> already has its own fullscreen", () => {
    expect(shouldOpenMediaLightbox("video/mp4")).toBe(false);
    expect(shouldOpenMediaLightbox("video/webm")).toBe(false);
  });

  it("does not open the lightbox for an unrecognized or empty mime type", () => {
    expect(shouldOpenMediaLightbox("application/octet-stream")).toBe(false);
    expect(shouldOpenMediaLightbox("")).toBe(false);
  });
});

describe("getAttachmentPreviewKind", () => {
  it("previews any image mime type as a real thumbnail", () => {
    expect(getAttachmentPreviewKind("image/png")).toBe("image");
    expect(getAttachmentPreviewKind("image/jpeg")).toBe("image");
    expect(getAttachmentPreviewKind("image/webp")).toBe("image");
    expect(getAttachmentPreviewKind("image/gif")).toBe("image");
  });

  it("previews any video mime type as a generic video badge", () => {
    expect(getAttachmentPreviewKind("video/mp4")).toBe("video");
    expect(getAttachmentPreviewKind("video/webm")).toBe("video");
  });

  it("falls back to a generic file badge for an unrecognized or empty mime type", () => {
    expect(getAttachmentPreviewKind("application/octet-stream")).toBe("file");
    expect(getAttachmentPreviewKind("")).toBe("file");
  });
});

describe("validateAttachmentFile", () => {
  it("accepts every allowed mime type under the size limit", () => {
    for (const mime of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/webm",
    ]) {
      expect(validateAttachmentFile(mime, 1024)).toEqual({ ok: true });
    }
  });

  it("rejects a disallowed mime type regardless of size", () => {
    expect(validateAttachmentFile("application/pdf", 1024)).toEqual({
      ok: false,
      error: "Allowed formats: PNG, JPG, WEBP, GIF, MP4, WEBM.",
    });
    expect(validateAttachmentFile("", 1024)).toEqual({
      ok: false,
      error: "Allowed formats: PNG, JPG, WEBP, GIF, MP4, WEBM.",
    });
  });

  it("rejects an allowed mime type once it exceeds the 50 MB cap", () => {
    const fiftyMb = 50 * 1024 * 1024;
    expect(validateAttachmentFile("image/png", fiftyMb)).toEqual({ ok: true });
    expect(validateAttachmentFile("image/png", fiftyMb + 1)).toEqual({
      ok: false,
      error: "Attachment exceeds the 50 MB limit.",
    });
  });

  it("checks mime type before size, so an over-size disallowed file reports the format error", () => {
    expect(validateAttachmentFile("application/pdf", 100 * 1024 * 1024)).toEqual({
      ok: false,
      error: "Allowed formats: PNG, JPG, WEBP, GIF, MP4, WEBM.",
    });
  });
});

describe("findMessageSearchMatches", () => {
  it("returns message IDs matching a case-insensitive substring, in original order", () => {
    const messages = [
      makeMsg({ id: "m1", text: "Hello there" }),
      makeMsg({ id: "m2", text: "unrelated message" }),
      makeMsg({ id: "m3", text: "say HELLO world" }),
    ];
    expect(findMessageSearchMatches(messages, "hello")).toEqual(["m1", "m3"]);
  });

  it("returns an empty array for a blank or whitespace-only query", () => {
    const messages = [makeMsg({ id: "m1", text: "Hello there" })];
    expect(findMessageSearchMatches(messages, "")).toEqual([]);
    expect(findMessageSearchMatches(messages, "   ")).toEqual([]);
  });

  it("excludes removed, unverified, and attachment-only (textless) messages", () => {
    const messages = [
      makeMsg({ id: "m1", text: "secret plan", is_removed: true }),
      makeMsg({ id: "m2", text: "secret plan", status: "verification_failed" }),
      makeMsg({ id: "m3", text: null }),
      makeMsg({ id: "m4", text: "the secret plan" }),
    ];
    expect(findMessageSearchMatches(messages, "secret")).toEqual(["m4"]);
  });

  it("trims surrounding whitespace from the query before matching", () => {
    const messages = [makeMsg({ id: "m1", text: "Hello there" })];
    expect(findMessageSearchMatches(messages, "  hello  ")).toEqual(["m1"]);
  });
});

describe("shouldSubmitMessageEditOnKeyDown", () => {
  it("submits on a plain Enter", () => {
    expect(shouldSubmitMessageEditOnKeyDown("Enter", false)).toBe(true);
  });

  it("does not submit on Shift+Enter, leaving the default newline insert", () => {
    expect(shouldSubmitMessageEditOnKeyDown("Enter", true)).toBe(false);
  });

  it("does not submit on any other key", () => {
    expect(shouldSubmitMessageEditOnKeyDown("a", false)).toBe(false);
    expect(shouldSubmitMessageEditOnKeyDown("Escape", false)).toBe(false);
  });
});

describe("findUnreadDividerMessageId", () => {
  const msgs = [
    makeMsg({ id: "m1", sender_id: "u1" }),
    makeMsg({ id: "m2", sender_id: "u1" }),
    makeMsg({ id: "m3", sender_id: "u2" }),
    makeMsg({ id: "m4", sender_id: "u1" }),
    makeMsg({ id: "m5", sender_id: "u2" }),
  ];

  it("returns null when there is nothing unread", () => {
    expect(findUnreadDividerMessageId(msgs, 0, "u1")).toBeNull();
    expect(findUnreadDividerMessageId(msgs, -1, "u1")).toBeNull();
  });

  it("returns null for an empty message list", () => {
    expect(findUnreadDividerMessageId([], 3, "u1")).toBeNull();
  });

  it("anchors at the earliest message in the unread streak, counting only other senders", () => {
    // Viewer is u1; unreadCount=1 should land on the last message from someone else (m5).
    expect(findUnreadDividerMessageId(msgs, 1, "u1")).toBe("m5");
    // unreadCount=2 must skip the viewer's own m4 and land on the next other-sender message (m3).
    expect(findUnreadDividerMessageId(msgs, 2, "u1")).toBe("m3");
  });

  it("anchors at the oldest loaded other-sender message when unreadCount exceeds what's loaded", () => {
    expect(findUnreadDividerMessageId(msgs, 99, "u1")).toBe("m3");
  });

  it("returns null when every loaded message is the viewer's own", () => {
    const ownOnly = [makeMsg({ id: "a", sender_id: "u1" }), makeMsg({ id: "b", sender_id: "u1" })];
    expect(findUnreadDividerMessageId(ownOnly, 5, "u1")).toBeNull();
  });
});

describe("buildTimelineItems unread divider", () => {
  it("inserts an unread_divider item directly above the target message", () => {
    const msgs = [
      makeMsg({ id: "m1", epoch: 1 }),
      makeMsg({ id: "m2", epoch: 1 }),
      makeMsg({ id: "m3", epoch: 1 }),
    ];
    const items = buildTimelineItems(msgs, "m2");
    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(["message", "unread_divider", "message", "message"]);
  });

  it("omits the divider entirely when the target id is null", () => {
    const msgs = [makeMsg({ id: "m1" }), makeMsg({ id: "m2" })];
    const items = buildTimelineItems(msgs, null);
    expect(items.every((i) => i.kind !== "unread_divider")).toBe(true);
  });
});

describe("splitMessageTextIntoLinkSegments", () => {
  it("returns a single plain-text segment when there is no URL", () => {
    expect(splitMessageTextIntoLinkSegments("hello world")).toEqual([
      { text: "hello world", isLink: false },
    ]);
  });

  it("returns an empty array for empty text", () => {
    expect(splitMessageTextIntoLinkSegments("")).toEqual([]);
  });

  it("detects a bare URL as its own link segment", () => {
    expect(splitMessageTextIntoLinkSegments("https://example.com")).toEqual([
      { text: "https://example.com", isLink: true },
    ]);
  });

  it("splits surrounding text around an inline URL", () => {
    expect(splitMessageTextIntoLinkSegments("see https://example.com/path now")).toEqual([
      { text: "see ", isLink: false },
      { text: "https://example.com/path", isLink: true },
      { text: " now", isLink: false },
    ]);
  });

  it("trims a trailing sentence period off the link", () => {
    expect(splitMessageTextIntoLinkSegments("check https://example.com.")).toEqual([
      { text: "check ", isLink: false },
      { text: "https://example.com", isLink: true },
      { text: ".", isLink: false },
    ]);
  });

  it("trims an unmatched wrapping closing paren off the link", () => {
    expect(splitMessageTextIntoLinkSegments("(https://example.com)")).toEqual([
      { text: "(", isLink: false },
      { text: "https://example.com", isLink: true },
      { text: ")", isLink: false },
    ]);
  });

  it("keeps a closing paren that is balanced inside the URL itself", () => {
    const url = "https://en.wikipedia.org/wiki/Cat_(disambiguation)";
    expect(splitMessageTextIntoLinkSegments(url)).toEqual([{ text: url, isLink: true }]);
  });

  it("detects multiple URLs in the same message", () => {
    const text = "a https://one.example then https://two.example b";
    expect(splitMessageTextIntoLinkSegments(text)).toEqual([
      { text: "a ", isLink: false },
      { text: "https://one.example", isLink: true },
      { text: " then ", isLink: false },
      { text: "https://two.example", isLink: true },
      { text: " b", isLink: false },
    ]);
  });

  it("does not treat a bare domain without a scheme as a link", () => {
    expect(splitMessageTextIntoLinkSegments("visit www.example.com please")).toEqual([
      { text: "visit www.example.com please", isLink: false },
    ]);
  });
});

describe("computeDocumentTitle", () => {
  it("returns the plain app name when there are no unread messages", () => {
    expect(computeDocumentTitle("Bloop", 0)).toBe("Bloop");
  });

  it("returns the plain app name for a negative count (defensive)", () => {
    expect(computeDocumentTitle("Bloop", -1)).toBe("Bloop");
  });

  it("prefixes the unread count ahead of the app name", () => {
    expect(computeDocumentTitle("Bloop", 3)).toBe("(3) Bloop");
  });

  it("caps the displayed count at 99+ like the sidebar/nav-rail badges", () => {
    expect(computeDocumentTitle("Bloop", 100)).toBe("(99+) Bloop");
    expect(computeDocumentTitle("Bloop", 99)).toBe("(99) Bloop");
  });
});

describe("formatOfflineDuration", () => {
  it("formats sub-minute durations as whole seconds", () => {
    expect(formatOfflineDuration(0)).toBe("0s");
    expect(formatOfflineDuration(45_000)).toBe("45s");
  });

  it("rounds to the nearest second", () => {
    expect(formatOfflineDuration(1_400)).toBe("1s");
    expect(formatOfflineDuration(1_600)).toBe("2s");
  });

  it("formats minutes with a trailing seconds remainder", () => {
    expect(formatOfflineDuration(90_000)).toBe("1m 30s");
  });

  it("omits a zero seconds remainder", () => {
    expect(formatOfflineDuration(60_000)).toBe("1m");
  });

  it("formats hours with a trailing minutes remainder", () => {
    expect(formatOfflineDuration(3_660_000)).toBe("1h 1m");
  });

  it("omits a zero minutes remainder", () => {
    expect(formatOfflineDuration(3_600_000)).toBe("1h");
  });

  it("clamps negative or non-finite input to zero", () => {
    expect(formatOfflineDuration(-500)).toBe("0s");
    expect(formatOfflineDuration(NaN)).toBe("0s");
  });
});

describe("shouldOpenShortcutsHelp", () => {
  it("opens on a bare '?' press outside any editable field", () => {
    expect(shouldOpenShortcutsHelp("?", null, false)).toBe(true);
    expect(shouldOpenShortcutsHelp("?", "BUTTON", false)).toBe(true);
    expect(shouldOpenShortcutsHelp("?", "DIV", false)).toBe(true);
  });

  it("ignores every other key", () => {
    expect(shouldOpenShortcutsHelp("Enter", null, false)).toBe(false);
    expect(shouldOpenShortcutsHelp("/", null, false)).toBe(false);
    expect(shouldOpenShortcutsHelp("a", null, false)).toBe(false);
  });

  it("is suppressed while typing in an input, textarea, or select", () => {
    expect(shouldOpenShortcutsHelp("?", "INPUT", false)).toBe(false);
    expect(shouldOpenShortcutsHelp("?", "TEXTAREA", false)).toBe(false);
    expect(shouldOpenShortcutsHelp("?", "SELECT", false)).toBe(false);
    // Tag name casing from the DOM is always uppercase, but stay forgiving.
    expect(shouldOpenShortcutsHelp("?", "textarea", false)).toBe(false);
  });

  it("is suppressed inside a contenteditable element regardless of tag", () => {
    expect(shouldOpenShortcutsHelp("?", "DIV", true)).toBe(false);
  });
});

describe("shouldOpenConversationSearch", () => {
  it("opens on Ctrl+F", () => {
    expect(shouldOpenConversationSearch("f", true)).toBe(true);
  });

  it("matches the key case-insensitively", () => {
    expect(shouldOpenConversationSearch("F", true)).toBe(true);
  });

  it("requires the Ctrl/Cmd modifier", () => {
    expect(shouldOpenConversationSearch("f", false)).toBe(false);
  });

  it("ignores every other key even with the modifier held", () => {
    expect(shouldOpenConversationSearch("g", true)).toBe(false);
    expect(shouldOpenConversationSearch("Enter", true)).toBe(false);
  });
});

describe("shouldFocusConversationFilter", () => {
  it("focuses the filter on a bare '/' press outside any editable field", () => {
    expect(shouldFocusConversationFilter("/", null, false)).toBe(true);
    expect(shouldFocusConversationFilter("/", "BUTTON", false)).toBe(true);
    expect(shouldFocusConversationFilter("/", "DIV", false)).toBe(true);
  });

  it("ignores every other key", () => {
    expect(shouldFocusConversationFilter("Enter", null, false)).toBe(false);
    expect(shouldFocusConversationFilter("?", null, false)).toBe(false);
    expect(shouldFocusConversationFilter("a", null, false)).toBe(false);
  });

  it("is suppressed while typing in an input, textarea, or select", () => {
    expect(shouldFocusConversationFilter("/", "INPUT", false)).toBe(false);
    expect(shouldFocusConversationFilter("/", "TEXTAREA", false)).toBe(false);
    expect(shouldFocusConversationFilter("/", "SELECT", false)).toBe(false);
    // Tag name casing from the DOM is always uppercase, but stay forgiving.
    expect(shouldFocusConversationFilter("/", "input", false)).toBe(false);
  });

  it("is suppressed inside a contenteditable element regardless of tag", () => {
    expect(shouldFocusConversationFilter("/", "DIV", true)).toBe(false);
  });
});

describe("KEYBOARD_SHORTCUTS", () => {
  it("has a non-empty, unique list of shortcut entries", () => {
    expect(KEYBOARD_SHORTCUTS.length).toBeGreaterThan(0);
    const keys = KEYBOARD_SHORTCUTS.map((entry) => entry.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of KEYBOARD_SHORTCUTS) {
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

describe("splitTextForSearchHighlight", () => {
  it("returns an empty array for empty text", () => {
    expect(splitTextForSearchHighlight("", "foo")).toEqual([]);
  });

  it("returns the whole text unmatched when the query is blank", () => {
    expect(splitTextForSearchHighlight("Hello world", "")).toEqual([
      { text: "Hello world", isMatch: false },
    ]);
    expect(splitTextForSearchHighlight("Hello world", "   ")).toEqual([
      { text: "Hello world", isMatch: false },
    ]);
  });

  it("returns the whole text unmatched when there is no match", () => {
    expect(splitTextForSearchHighlight("Hello world", "xyz")).toEqual([
      { text: "Hello world", isMatch: false },
    ]);
  });

  it("splits out a single match in the middle of the text", () => {
    expect(splitTextForSearchHighlight("Hello world", "world")).toEqual([
      { text: "Hello ", isMatch: false },
      { text: "world", isMatch: true },
    ]);
  });

  it("matches case-insensitively while preserving original casing", () => {
    expect(splitTextForSearchHighlight("Hello World", "WORLD")).toEqual([
      { text: "Hello ", isMatch: false },
      { text: "World", isMatch: true },
    ]);
  });

  it("finds every non-overlapping occurrence of the query", () => {
    expect(splitTextForSearchHighlight("ba na na", "na")).toEqual([
      { text: "ba ", isMatch: false },
      { text: "na", isMatch: true },
      { text: " ", isMatch: false },
      { text: "na", isMatch: true },
    ]);
  });

  it("treats a query matching the entire text as a single match segment", () => {
    expect(splitTextForSearchHighlight("secret", "secret")).toEqual([
      { text: "secret", isMatch: true },
    ]);
  });

  it("trims surrounding whitespace from the query before matching", () => {
    expect(splitTextForSearchHighlight("Hello world", "  world  ")).toEqual([
      { text: "Hello ", isMatch: false },
      { text: "world", isMatch: true },
    ]);
  });
});

describe("filterPinnedMessages", () => {
  function makePin(overrides: Partial<PinnedMessageDto> = {}): PinnedMessageDto {
    return {
      conversation_id: "c1",
      message_id: "m1",
      pinned_by_id: "u1",
      pinned_by_display_name: "Alice",
      pinned_at: "2026-11-20T00:01:00Z",
      message: makeMsg({ id: "m1", text: "Let's meet at 5pm" }),
      ...overrides,
    };
  }

  it("returns every pin unchanged for a blank/whitespace-only query", () => {
    const pins = [makePin(), makePin({ message_id: "m2" })];
    expect(filterPinnedMessages(pins, "")).toBe(pins);
    expect(filterPinnedMessages(pins, "   ")).toBe(pins);
  });

  it("matches case-insensitively against the message text", () => {
    const pins = [
      makePin({ message_id: "m1", message: makeMsg({ id: "m1", text: "Deploy at noon" }) }),
      makePin({ message_id: "m2", message: makeMsg({ id: "m2", text: "Lunch plans" }) }),
    ];
    expect(filterPinnedMessages(pins, "DEPLOY").map((p) => p.message_id)).toEqual(["m1"]);
  });

  it("matches against the sender's display name", () => {
    const pins = [
      makePin({
        message_id: "m1",
        message: makeMsg({ id: "m1", text: "hi", sender_display_name: "Bob" }),
      }),
      makePin({
        message_id: "m2",
        message: makeMsg({ id: "m2", text: "hey", sender_display_name: "Carol" }),
      }),
    ];
    expect(filterPinnedMessages(pins, "bob").map((p) => p.message_id)).toEqual(["m1"]);
  });

  it("matches an attachment-only pin (no text) by sender name", () => {
    const pins = [
      makePin({
        message_id: "m1",
        message: makeMsg({
          id: "m1",
          text: null,
          sender_display_name: "Dana",
          attachment: {
            file_name: "photo.png",
            mime_type: "image/png",
            size_bytes: 1024,
            media_url: "privatetalk-media://localhost/c1/m1",
          },
        }),
      }),
    ];
    expect(filterPinnedMessages(pins, "dana")).toHaveLength(1);
    expect(filterPinnedMessages(pins, "nonexistent")).toHaveLength(0);
  });

  it("returns an empty array when nothing matches", () => {
    const pins = [makePin()];
    expect(filterPinnedMessages(pins, "no match here")).toEqual([]);
  });
});

describe("getConversationSwitchDirection", () => {
  it("returns null without Alt held, regardless of key", () => {
    expect(getConversationSwitchDirection("ArrowDown", false)).toBeNull();
    expect(getConversationSwitchDirection("ArrowUp", false)).toBeNull();
    expect(getConversationSwitchDirection("a", false)).toBeNull();
  });

  it("returns 1 for Alt+ArrowDown and -1 for Alt+ArrowUp", () => {
    expect(getConversationSwitchDirection("ArrowDown", true)).toBe(1);
    expect(getConversationSwitchDirection("ArrowUp", true)).toBe(-1);
  });

  it("returns null for any other key even with Alt held", () => {
    expect(getConversationSwitchDirection("ArrowLeft", true)).toBeNull();
    expect(getConversationSwitchDirection("f", true)).toBeNull();
    expect(getConversationSwitchDirection("Enter", true)).toBeNull();
  });
});

describe("getAdjacentConversationId", () => {
  const ids = ["a", "b", "c"];

  it("returns null when there are no conversations", () => {
    expect(getAdjacentConversationId([], "a", 1)).toBeNull();
    expect(getAdjacentConversationId([], null, -1)).toBeNull();
  });

  it("steps forward and wraps past the last entry", () => {
    expect(getAdjacentConversationId(ids, "a", 1)).toBe("b");
    expect(getAdjacentConversationId(ids, "b", 1)).toBe("c");
    expect(getAdjacentConversationId(ids, "c", 1)).toBe("a");
  });

  it("steps backward and wraps past the first entry", () => {
    expect(getAdjacentConversationId(ids, "c", -1)).toBe("b");
    expect(getAdjacentConversationId(ids, "b", -1)).toBe("a");
    expect(getAdjacentConversationId(ids, "a", -1)).toBe("c");
  });

  it("falls back to the first entry stepping forward when nothing is selected", () => {
    expect(getAdjacentConversationId(ids, null, 1)).toBe("a");
  });

  it("falls back to the last entry stepping backward when nothing is selected", () => {
    expect(getAdjacentConversationId(ids, null, -1)).toBe("c");
  });

  it("falls back the same way when currentId isn't in the list", () => {
    expect(getAdjacentConversationId(ids, "not-there", 1)).toBe("a");
    expect(getAdjacentConversationId(ids, "not-there", -1)).toBe("c");
  });

  it("wraps correctly for a single-conversation list", () => {
    expect(getAdjacentConversationId(["only"], "only", 1)).toBe("only");
    expect(getAdjacentConversationId(["only"], "only", -1)).toBe("only");
  });
});

describe("filterContacts", () => {
  function makeContact(overrides: Partial<ContactDto> = {}): ContactDto {
    return {
      id: "u1",
      username: "alice",
      display_name: "Alice Nguyen",
      avatar_url: null,
      is_online: true,
      ...overrides,
    };
  }

  it("returns every contact unchanged for a blank/whitespace-only query", () => {
    const contacts = [makeContact(), makeContact({ id: "u2", username: "bob" })];
    expect(filterContacts(contacts, "")).toBe(contacts);
    expect(filterContacts(contacts, "   ")).toBe(contacts);
  });

  it("matches case-insensitively against the display name", () => {
    const contacts = [
      makeContact({ id: "u1", display_name: "Alice Nguyen" }),
      makeContact({ id: "u2", display_name: "Bob Tran", username: "bobt" }),
    ];
    expect(filterContacts(contacts, "ALICE").map((c) => c.id)).toEqual(["u1"]);
  });

  it("matches against the username (with or without the @ the caller types)", () => {
    const contacts = [
      makeContact({ id: "u1", display_name: "Alice Nguyen", username: "alice" }),
      makeContact({ id: "u2", display_name: "Bob Tran", username: "bobt" }),
    ];
    expect(filterContacts(contacts, "bobt").map((c) => c.id)).toEqual(["u2"]);
  });

  it("matches a substring anywhere in the name, not just a prefix", () => {
    const contacts = [makeContact({ id: "u1", display_name: "Alice Nguyen" })];
    expect(filterContacts(contacts, "guye")).toHaveLength(1);
  });

  it("returns an empty array when nothing matches", () => {
    const contacts = [makeContact()];
    expect(filterContacts(contacts, "zzz-nonexistent")).toEqual([]);
  });

  it("trims surrounding whitespace from the query before matching", () => {
    const contacts = [makeContact({ id: "u1", display_name: "Alice Nguyen" })];
    expect(filterContacts(contacts, "  alice  ")).toHaveLength(1);
  });
});

describe("assessPasswordStrength", () => {
  it("scores anything under 8 characters as Too short / 0, regardless of complexity", () => {
    expect(assessPasswordStrength("aB3!")).toEqual({ label: "Too short", score: 0 });
    expect(assessPasswordStrength("")).toEqual({ label: "Too short", score: 0 });
  });

  it("scores an 8-9 char single-class password as Weak", () => {
    expect(assessPasswordStrength("aaaaaaaa")).toEqual({ label: "Weak", score: 1 });
    expect(assessPasswordStrength("password")).toEqual({ label: "Weak", score: 1 });
  });

  it("scores a 14+ char single-class password as Fair via length milestones alone", () => {
    expect(assessPasswordStrength("aaaaaaaaaaaaaa")).toEqual({ label: "Fair", score: 2 });
  });

  it("scores a short password with 3 character classes as Fair", () => {
    expect(assessPasswordStrength("aaaaaaB3")).toEqual({ label: "Fair", score: 2 });
  });

  it("scores a 10+ char password with 3 character classes as Good", () => {
    expect(assessPasswordStrength("aaaaaaaaaaB3")).toEqual({ label: "Good", score: 3 });
  });

  it("scores a long password with 3+ character classes as Strong", () => {
    expect(assessPasswordStrength("Correct9Horse!")).toEqual({ label: "Strong", score: 4 });
  });

  it("never exceeds a score of 4 even with every class and extreme length", () => {
    expect(assessPasswordStrength("Th1s-Is-A-Very-Long-P@ssw0rd-123!")).toEqual({
      label: "Strong",
      score: 4,
    });
  });
});

describe("resolvePasswordInputType", () => {
  it("masks the password by default (visible: false)", () => {
    expect(resolvePasswordInputType(false)).toBe("password");
  });

  it("reveals the password when visible: true", () => {
    expect(resolvePasswordInputType(true)).toBe("text");
  });
});

describe("getPasswordVisibilityToggleLabel", () => {
  it("offers to show the password while it is currently masked", () => {
    expect(getPasswordVisibilityToggleLabel(false)).toBe("Show password");
  });

  it("offers to hide the password while it is currently revealed", () => {
    expect(getPasswordVisibilityToggleLabel(true)).toBe("Hide password");
  });
});

describe("shouldShowMessageNotificationToast", () => {
  it("shows a toast for a verified message from someone else in a background, unmuted conversation", () => {
    const msg = makeMsg({ conversation_id: "c2", sender_id: "u2" });
    expect(shouldShowMessageNotificationToast(msg, "u1", "c1", [])).toBe(true);
  });

  it("suppresses a toast for the viewer's own message", () => {
    const msg = makeMsg({ conversation_id: "c2", sender_id: "u1" });
    expect(shouldShowMessageNotificationToast(msg, "u1", "c1", [])).toBe(false);
  });

  it("suppresses a toast for the conversation already open", () => {
    const msg = makeMsg({ conversation_id: "c1", sender_id: "u2" });
    expect(shouldShowMessageNotificationToast(msg, "u1", "c1", [])).toBe(false);
  });

  it("suppresses a toast for a muted conversation", () => {
    const msg = makeMsg({ conversation_id: "c2", sender_id: "u2" });
    expect(shouldShowMessageNotificationToast(msg, "u1", "c1", ["c2"])).toBe(false);
  });

  it("suppresses a toast for a removed message", () => {
    const msg = makeMsg({
      conversation_id: "c2",
      sender_id: "u2",
      is_removed: true,
      status: "removed",
      text: null,
    });
    expect(shouldShowMessageNotificationToast(msg, "u1", "c1", [])).toBe(false);
  });

  it("suppresses a toast for a message that failed verification", () => {
    const msg = makeMsg({
      conversation_id: "c2",
      sender_id: "u2",
      status: "verification_failed",
      text: null,
    });
    expect(shouldShowMessageNotificationToast(msg, "u1", "c1", [])).toBe(false);
  });

  it("still shows a toast when nothing is selected yet", () => {
    const msg = makeMsg({ conversation_id: "c2", sender_id: "u2" });
    expect(shouldShowMessageNotificationToast(msg, "u1", null, [])).toBe(true);
  });
});

describe("buildMessageNotificationPreview", () => {
  it("returns trimmed message text", () => {
    expect(buildMessageNotificationPreview(makeMsg({ text: "  hey there  " }))).toBe(
      "hey there"
    );
  });

  it("truncates long text with an ellipsis", () => {
    const longText = "a".repeat(200);
    const preview = buildMessageNotificationPreview(makeMsg({ text: longText }));
    expect(preview.length).toBe(121);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("falls back to a generic attachment label when there is no text", () => {
    const msg = makeMsg({
      text: null,
      attachment: {
        mime_type: "image/png",
        file_name: "photo.png",
        size_bytes: 1024,
        media_url: "privatetalk-media://localhost/c1/m1",
      },
    });
    expect(buildMessageNotificationPreview(msg)).toBe("Sent an attachment");
  });

  it("falls back to a generic message label with neither text nor attachment", () => {
    expect(buildMessageNotificationPreview(makeMsg({ text: null }))).toBe("Sent a message");
  });
});

describe("appendMessageToast & dismissMessageToast", () => {
  function makeToast(id: string): MessageNotificationToast {
    return {
      id,
      conversationId: "c2",
      conversationTitle: "Bob Builder",
      senderDisplayName: "Bob",
      preview: "hey",
    };
  }

  it("appends a new toast", () => {
    const result = appendMessageToast([], makeToast("m1"));
    expect(result).toEqual([makeToast("m1")]);
  });

  it("de-duplicates by message id instead of stacking a second toast", () => {
    const result = appendMessageToast([makeToast("m1")], {
      ...makeToast("m1"),
      preview: "updated",
    });
    expect(result).toHaveLength(1);
    expect(result[0].preview).toBe("updated");
  });

  it("caps the list at MAX_MESSAGE_TOASTS, dropping the oldest first", () => {
    let toasts: MessageNotificationToast[] = [];
    for (let i = 0; i < MAX_MESSAGE_TOASTS + 2; i += 1) {
      toasts = appendMessageToast(toasts, makeToast(`m${i}`));
    }
    expect(toasts).toHaveLength(MAX_MESSAGE_TOASTS);
    expect(toasts[0].id).toBe("m2");
    expect(toasts[toasts.length - 1].id).toBe(`m${MAX_MESSAGE_TOASTS + 1}`);
  });

  it("dismisses a toast by id", () => {
    const toasts = [makeToast("m1"), makeToast("m2")];
    const result = dismissMessageToast(toasts, "m1");
    expect(result).toEqual([makeToast("m2")]);
  });

  it("returns the same array reference when the id isn't present", () => {
    const toasts = [makeToast("m1")];
    expect(dismissMessageToast(toasts, "missing")).toBe(toasts);
  });
});
