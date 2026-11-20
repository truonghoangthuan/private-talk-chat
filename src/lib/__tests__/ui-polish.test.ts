import { describe, expect, it } from "vitest";
import type { MessageDto } from "../types";
import {
  buildTimelineItems,
  formatCryptoFingerprint,
  getTimelineScrollBehavior,
  upsertMessageWithReplySync,
  validateAttachmentPath,
  validateAvatarPath,
} from "../ui-polish";

function makeMessage(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    sender_id: "user-a",
    sender_username: "alice",
    sender_display_name: "Alice",
    sender_avatar_url: null,
    epoch: 1,
    status: "verified",
    text: "Hello",
    attachment: null,
    reply_to: null,
    is_pinned: false,
    pinned_at: null,
    pinned_by_display_name: null,
    is_edited: false,
    edited_at: null,
    is_removed: false,
    removed_at: null,
    created_at: "2026-11-20T00:00:00.000Z",
    seen_by: [],
    ...overrides,
  };
}

describe("formatCryptoFingerprint", () => {
  it("produces deterministic XXXX • XXXX uppercase hex format", () => {
    const first = formatCryptoFingerprint("user-123:alice");
    const second = formatCryptoFingerprint("user-123:alice");

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9A-F]{4} • [0-9A-F]{4}$/);
  });

  it("changes output when conversation epoch increments", () => {
    const epoch1 = formatCryptoFingerprint("conv-1:epoch-1");
    const epoch2 = formatCryptoFingerprint("conv-1:epoch-2");

    expect(epoch1).not.toBe(epoch2);
  });
});

describe("buildTimelineItems", () => {
  it("groups consecutive verified same-sender messages within 120s in the same epoch", () => {
    const m1 = makeMessage({ id: "m1", created_at: "2026-11-20T00:00:00.000Z" });
    const m2 = makeMessage({ id: "m2", created_at: "2026-11-20T00:01:59.000Z" });
    const m3 = makeMessage({ id: "m3", created_at: "2026-11-20T00:04:01.000Z" });

    const items = buildTimelineItems([m1, m2, m3]);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: "message", isGroupedWithPrev: false });
    expect(items[1]).toMatchObject({ kind: "message", isGroupedWithPrev: true });
    expect(items[2]).toMatchObject({ kind: "message", isGroupedWithPrev: false });
  });

  it("inserts Epoch N • Key rotated divider and prevents grouping across epoch boundaries", () => {
    const m1 = makeMessage({ id: "m1", epoch: 1, created_at: "2026-11-20T00:00:00.000Z" });
    const m2 = makeMessage({ id: "m2", epoch: 2, created_at: "2026-11-20T00:00:10.000Z" });

    const items = buildTimelineItems([m1, m2]);

    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({
      kind: "epoch_divider",
      epoch: 2,
      label: "Epoch 2 • Key rotated",
    });
    expect(items[2]).toMatchObject({ kind: "message", isGroupedWithPrev: false });
  });

  it("never groups verification_failed or removed messages", () => {
    const m1 = makeMessage({ id: "m1", created_at: "2026-11-20T00:00:00.000Z" });
    const mFailed = makeMessage({
      id: "m2",
      status: "verification_failed",
      text: null,
      created_at: "2026-11-20T00:00:10.000Z",
    });
    const mAfterFailed = makeMessage({ id: "m3", created_at: "2026-11-20T00:00:20.000Z" });
    const mRemoved = makeMessage({
      id: "m4",
      is_removed: true,
      status: "removed",
      text: null,
      created_at: "2026-11-20T00:00:30.000Z",
    });

    const items = buildTimelineItems([m1, mFailed, mAfterFailed, mRemoved]);

    expect(items.every((item) => item.kind === "message" && !item.isGroupedWithPrev)).toBe(true);
  });
});

describe("upsertMessageWithReplySync", () => {
  it("deduplicates when realtime:message_upsert and messageSend return the same id", () => {
    const sent = makeMessage({ id: "msg-dup", text: "Test 3" });
    const afterRealtime = upsertMessageWithReplySync([], sent);
    const afterSendResolve = upsertMessageWithReplySync(afterRealtime, sent);

    expect(afterSendResolve).toHaveLength(1);
    expect(afterSendResolve[0].id).toBe("msg-dup");
  });
});

describe("validateAttachmentPath", () => {
  it("accepts allowed image and video extensions case-insensitively", () => {
    expect(validateAttachmentPath("C:\\Users\\alice\\Pictures\\photo.PNG")).toEqual({
      ok: true,
      fileName: "photo.PNG",
      previewKind: "image",
    });
    expect(validateAttachmentPath("/tmp/clip.WebM")).toEqual({
      ok: true,
      fileName: "clip.WebM",
      previewKind: "video",
    });
  });

  it("rejects disallowed extensions", () => {
    expect(validateAttachmentPath("C:\\Users\\alice\\payload.exe")).toEqual({
      ok: false,
      error: "Allowed formats: PNG, JPG, WEBP, GIF, MP4, WEBM.",
    });
  });
});

describe("validateAvatarPath", () => {
  it("accepts png/jpg/jpeg/webp and rejects other extensions", () => {
    expect(validateAvatarPath("C:\\avatars\\me.JPEG")).toEqual({ ok: true });
    expect(validateAvatarPath("C:\\avatars\\anim.gif")).toEqual({
      ok: false,
      error: "Avatar must be PNG, JPEG, or WEBP.",
    });
  });
});

describe("getTimelineScrollBehavior", () => {
  it("uses auto on initial conversation load and smooth on incremental messages", () => {
    expect(getTimelineScrollBehavior(0, 50)).toBe("auto");
    expect(getTimelineScrollBehavior(50, 51)).toBe("smooth");
    expect(getTimelineScrollBehavior(0, 0)).toBe("smooth");
  });
});
