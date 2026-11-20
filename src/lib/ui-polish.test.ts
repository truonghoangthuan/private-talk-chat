import { describe, expect, it } from "vitest";
import {
  getMessageCopyText,
  syncPinnedMessage,
  upsertMessageWithReplySync,
} from "./ui-polish";
import type { MessageDto, PinnedMessageDto } from "./types";

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
