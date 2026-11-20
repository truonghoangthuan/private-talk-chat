// Mock implementation of `@tauri-apps/api/core`'s `invoke`, swapped in via a
// Vite alias ONLY when E2E_MOCK=1 (see vite.config.ts) — never in the real
// app build. Backs the frontend-only e2e suite (no Rust/Tauri runtime
// available to drive the real app end-to-end here).
//
// Scope: enough fidelity to exercise real App.tsx state management (auth,
// conversation list, message send/receive, drafts) against deterministic
// in-memory fixtures. Not a crypto/security simulation.

interface UserProfileDto {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

interface MessageDto {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_username: string;
  sender_display_name: string;
  sender_avatar_url: string | null;
  epoch: number;
  status: "verified" | "verification_failed" | "removed";
  text: string | null;
  attachment: unknown;
  reply_to: unknown;
  is_pinned: boolean;
  pinned_at: string | null;
  pinned_by_display_name: string | null;
  is_edited: boolean;
  edited_at: string | null;
  is_removed: boolean;
  removed_at: string | null;
  created_at: string;
  seen_by: unknown[];
}

const ALICE: UserProfileDto = {
  id: "u-alice",
  username: "alice",
  display_name: "Alice Vance",
  avatar_url: null,
};

const BOB_MEMBER = {
  user_id: "u-bob",
  username: "bob",
  display_name: "Bob",
  avatar_url: null,
  is_online: true,
  is_host: false,
  joined_at: "2026-01-01T00:00:00.000Z",
};

const ALICE_MEMBER = {
  user_id: ALICE.id,
  username: ALICE.username,
  display_name: ALICE.display_name,
  avatar_url: null,
  is_online: true,
  is_host: true,
  joined_at: "2026-01-01T00:00:00.000Z",
};

const CONVERSATION_ID = "c-bob";
const CONVERSATION_ID_2 = "c-carol";

const conversation = {
  id: CONVERSATION_ID,
  is_group: false,
  name: null as string | null,
  host_id: ALICE.id,
  current_epoch: 1,
  members: [ALICE_MEMBER, BOB_MEMBER],
  latest_preview: "Hey, are we still on for tomorrow?",
  latest_timestamp: "2026-11-20T08:00:00.000Z",
  unread_count: 1,
  updated_at: "2026-11-20T08:00:00.000Z",
};

const CAROL_MEMBER = {
  user_id: "u-carol",
  username: "carol",
  display_name: "Carol",
  avatar_url: null,
  is_online: false,
  is_host: false,
  joined_at: "2026-01-01T00:00:00.000Z",
};

const conversation2 = {
  id: CONVERSATION_ID_2,
  is_group: false,
  name: null as string | null,
  host_id: ALICE.id,
  current_epoch: 1,
  members: [ALICE_MEMBER, CAROL_MEMBER],
  latest_preview: "Sounds good!",
  latest_timestamp: "2026-11-19T10:00:00.000Z",
  unread_count: 0,
  updated_at: "2026-11-19T10:00:00.000Z",
};

let seq = 100;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function makeMessage(overrides: Partial<MessageDto>): MessageDto {
  return {
    id: nextId("m"),
    conversation_id: CONVERSATION_ID,
    sender_id: BOB_MEMBER.user_id,
    sender_username: BOB_MEMBER.username,
    sender_display_name: BOB_MEMBER.display_name,
    sender_avatar_url: null,
    epoch: 1,
    status: "verified",
    text: null,
    attachment: null,
    reply_to: null,
    is_pinned: false,
    pinned_at: null,
    pinned_by_display_name: null,
    is_edited: false,
    edited_at: null,
    is_removed: false,
    removed_at: null,
    created_at: new Date().toISOString(),
    seen_by: [],
    ...overrides,
  };
}

const messagesByConversation: Record<string, MessageDto[]> = {
  [CONVERSATION_ID]: [
    makeMessage({ text: "Hey Alice!", created_at: "2026-11-20T07:58:00.000Z" }),
    makeMessage({
      text: "Hey, are we still on for tomorrow?",
      created_at: "2026-11-20T08:00:00.000Z",
    }),
  ],
  [CONVERSATION_ID_2]: [
    makeMessage({
      conversation_id: CONVERSATION_ID_2,
      sender_id: CAROL_MEMBER.user_id,
      sender_username: CAROL_MEMBER.username,
      sender_display_name: CAROL_MEMBER.display_name,
      text: "Sounds good!",
      created_at: "2026-11-19T10:00:00.000Z",
    }),
  ],
};

let currentUser: UserProfileDto | null = null;
const registeredUsers = new Map<string, { password: string; profile: UserProfileDto }>([
  ["alice", { password: "password123", profile: ALICE }],
]);

function fail(message: string): never {
  // @tauri-apps/api's invoke rejects with the raw string/object the Rust
  // command returned; the app's extractErrorMessage() handles both shapes.
  throw { message };
}

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

const handlers: Handlers = {
  auth_restore_session: () => null,

  auth_login: ({ username, password }) => {
    const entry = registeredUsers.get(String(username));
    if (!entry || entry.password !== password) {
      fail("Invalid username or password.");
    }
    currentUser = entry!.profile;
    return currentUser;
  },

  auth_register: ({ username, password, displayName }) => {
    const uname = String(username);
    if (registeredUsers.has(uname)) {
      fail("Username is already taken.");
    }
    const profile: UserProfileDto = {
      id: nextId("u"),
      username: uname,
      display_name: String(displayName),
      avatar_url: null,
    };
    registeredUsers.set(uname, { password: String(password), profile });
    currentUser = profile;
    return profile;
  },

  auth_logout: () => {
    currentUser = null;
    return null;
  },

  profile_update: ({ displayName }) => {
    if (currentUser && typeof displayName === "string") {
      currentUser = { ...currentUser, display_name: displayName };
    }
    return currentUser;
  },

  contact_list: () => [
    {
      id: BOB_MEMBER.user_id,
      username: BOB_MEMBER.username,
      display_name: BOB_MEMBER.display_name,
      avatar_url: null,
      is_online: true,
    },
  ],

  contact_add_by_username: ({ username }) => {
    if (username === "nobody") fail("No user found with that username.");
    return {
      id: nextId("u"),
      username: String(username),
      display_name: String(username),
      avatar_url: null,
      is_online: false,
    };
  },

  conversation_list: () => [conversation, conversation2],

  conversation_start_direct: () => conversation,
  conversation_create_group: ({ name }) => ({
    ...conversation,
    id: nextId("c"),
    is_group: true,
    name: String(name),
  }),
  conversation_rename_group: ({ conversationId, name }) => ({
    ...conversation,
    id: conversationId,
    name: String(name),
  }),
  conversation_add_group_member: () => conversation,
  conversation_remove_group_member: () => conversation,
  conversation_leave_group: () => null,

  message_list: ({ conversationId }) => messagesByConversation[String(conversationId)] ?? [],

  message_send: ({ conversationId, text, replyToMessageId }) => {
    const msg = makeMessage({
      conversation_id: String(conversationId),
      sender_id: currentUser?.id ?? ALICE.id,
      sender_username: currentUser?.username ?? ALICE.username,
      sender_display_name: currentUser?.display_name ?? ALICE.display_name,
      text: text != null ? String(text) : null,
      reply_to: replyToMessageId ? { message_id: replyToMessageId } : null,
    });
    const list = messagesByConversation[String(conversationId)] ?? [];
    list.push(msg);
    messagesByConversation[String(conversationId)] = list;
    return msg;
  },

  message_edit: ({ messageId, newText }) => {
    for (const list of Object.values(messagesByConversation)) {
      const m = list.find((x) => x.id === messageId);
      if (m) {
        m.text = String(newText);
        m.is_edited = true;
        m.edited_at = new Date().toISOString();
        return m;
      }
    }
    fail("Message not found.");
  },

  message_remove: ({ messageId }) => {
    for (const list of Object.values(messagesByConversation)) {
      const m = list.find((x) => x.id === messageId);
      if (m) {
        m.is_removed = true;
        m.removed_at = new Date().toISOString();
        m.text = null;
        return m;
      }
    }
    fail("Message not found.");
  },

  message_pin: ({ conversationId, messageId }) => {
    const list = messagesByConversation[String(conversationId)] ?? [];
    const m = list.find((x) => x.id === messageId);
    if (m) {
      m.is_pinned = true;
      m.pinned_at = new Date().toISOString();
      m.pinned_by_display_name = currentUser?.display_name ?? ALICE.display_name;
    }
    return {
      conversation_id: conversationId,
      message_id: messageId,
      pinned_by_id: currentUser?.id ?? ALICE.id,
      pinned_by_display_name: currentUser?.display_name ?? ALICE.display_name,
      pinned_at: new Date().toISOString(),
      message: m,
    };
  },
  message_unpin: ({ conversationId, messageId }) => {
    const list = messagesByConversation[String(conversationId)] ?? [];
    const m = list.find((x) => x.id === messageId);
    if (m) {
      m.is_pinned = false;
      m.pinned_at = null;
      m.pinned_by_display_name = null;
    }
    return null;
  },
  message_list_pinned: ({ conversationId }) => {
    const list = messagesByConversation[String(conversationId)] ?? [];
    return list
      .filter((m) => m.is_pinned)
      .map((m) => ({
        conversation_id: conversationId,
        message_id: m.id,
        pinned_by_id: currentUser?.id ?? ALICE.id,
        pinned_by_display_name: m.pinned_by_display_name,
        pinned_at: m.pinned_at,
        message: m,
      }));
  },
  message_mark_seen: () => null,
  typing_set_status: () => null,

  update_get_status: () => ({
    phase: "up_to_date",
    current_version: "0.3.0",
    latest_version: null,
    release_notes: null,
    published_at: null,
    progress_percent: null,
    downloaded_bytes: null,
    total_bytes: null,
    error_code: null,
    error_message: null,
  }),
  update_check: () => handlers.update_get_status({}),
  update_install: () => handlers.update_get_status({}),
};

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const handler = handlers[cmd];
  if (!handler) {
    throw { message: `[e2e mock] no handler registered for Tauri command "${cmd}"` };
  }
  // Mirror a real IPC round trip so React effects/awaits behave realistically.
  await new Promise((r) => setTimeout(r, 0));
  return handler(args) as T;
}
