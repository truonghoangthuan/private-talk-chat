import { describe, expect, it } from "vitest";
import {
  computeComposerCharacterState,
  computeScrollFollowState,
  filterConversations,
  formatMessageTimestamp,
  getAttachmentPreviewKind,
  getConversationTitle,
  getDraft,
  getMessageCopyText,
  isScrolledNearBottom,
  resolveComposerEscapeAction,
  resolveMessageBubbleEscapeAction,
  shouldOpenMediaLightbox,
  syncPinnedMessage,
  updateDraft,
  upsertMessageWithReplySync,
  validateAttachmentFile,
} from "./ui-polish";
import type { ConversationDto, MessageDto, PinnedMessageDto } from "./types";

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
