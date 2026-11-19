import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ContactDto,
  ConversationDto,
  MessageDto,
  PinnedMessageDto,
  SeenReceiptDto,
  TypingUserDto,
  UpdateStatusDto,
  UserProfileDto,
} from "./types";

export const tauriClient = {
  // Auth & Profile
  authRegister: (username: string, password: string, displayName: string) =>
    invoke<UserProfileDto>("auth_register", {
      username,
      password,
      displayName,
    }),

  authLogin: (username: string, password: string) =>
    invoke<UserProfileDto>("auth_login", { username, password }),

  authRestoreSession: () =>
    invoke<UserProfileDto | null>("auth_restore_session"),

  authLogout: () => invoke<void>("auth_logout"),

  profileUpdate: (displayName?: string, avatarFilePath?: string) =>
    invoke<UserProfileDto>("profile_update", {
      displayName,
      avatarFilePath,
    }),

  // Contacts
  contactAddByUsername: (username: string) =>
    invoke<ContactDto>("contact_add_by_username", { username }),

  contactList: () => invoke<ContactDto[]>("contact_list"),

  // Conversations
  conversationList: () => invoke<ConversationDto[]>("conversation_list"),

  conversationStartDirect: (contactUserId: string) =>
    invoke<ConversationDto>("conversation_start_direct", { contactUserId }),

  conversationCreateGroup: (name: string, memberUserIds: string[]) =>
    invoke<ConversationDto>("conversation_create_group", {
      name,
      memberUserIds,
    }),

  conversationRenameGroup: (conversationId: string, name: string) =>
    invoke<ConversationDto>("conversation_rename_group", {
      conversationId,
      name,
    }),

  conversationAddGroupMember: (conversationId: string, contactUserId: string) =>
    invoke<ConversationDto>("conversation_add_group_member", {
      conversationId,
      contactUserId,
    }),

  conversationRemoveGroupMember: (
    conversationId: string,
    targetUserId: string
  ) =>
    invoke<ConversationDto>("conversation_remove_group_member", {
      conversationId,
      targetUserId,
    }),

  conversationLeaveGroup: (conversationId: string) =>
    invoke<void>("conversation_leave_group", { conversationId }),

  // Messaging, Typing, Seen Receipts
  messageList: (conversationId: string, limit = 50, before?: string) =>
    invoke<MessageDto[]>("message_list", {
      conversationId,
      limit,
      before,
    }),

  messageSend: (
    conversationId: string,
    text?: string,
    attachmentPath?: string,
    replyToMessageId?: string
  ) =>
    invoke<MessageDto>("message_send", {
      conversationId,
      text,
      attachmentPath,
      replyToMessageId,
    }),

  messageEdit: (messageId: string, newText: string) =>
    invoke<MessageDto>("message_edit", { messageId, newText }),

  messageRemove: (messageId: string) =>
    invoke<MessageDto>("message_remove", { messageId }),

  messagePin: (conversationId: string, messageId: string) =>
    invoke<PinnedMessageDto>("message_pin", { conversationId, messageId }),

  messageUnpin: (conversationId: string, messageId: string) =>
    invoke<void>("message_unpin", { conversationId, messageId }),

  messageListPinned: (conversationId: string) =>
    invoke<PinnedMessageDto[]>("message_list_pinned", { conversationId }),

  messageMarkSeen: (conversationId: string, upToMessageId: string) =>
    invoke<void>("message_mark_seen", {
      conversationId,
      upToMessageId,
    }),

  typingSetStatus: (conversationId: string, isTyping: boolean) =>
    invoke<void>("typing_set_status", { conversationId, isTyping }),

  // Application Updater
  updateGetStatus: () => invoke<UpdateStatusDto>("update_get_status"),

  updateCheck: (silent = false) =>
    invoke<UpdateStatusDto>("update_check", { silent }),

  updateInstall: () => invoke<UpdateStatusDto>("update_install"),

  // Event listeners
  onPresenceChanged: (
    cb: (payload: { online_user_ids: string[] }) => void
  ): Promise<UnlistenFn> =>
    listen("realtime:presence_changed", (e) => cb(e.payload as { online_user_ids: string[] })),

  onTypingChanged: (
    cb: (payload: {
      conversation_id: string;
      typing_users: TypingUserDto[];
    }) => void
  ): Promise<UnlistenFn> =>
    listen("realtime:typing_changed", (e) =>
      cb(e.payload as { conversation_id: string; typing_users: TypingUserDto[] })
    ),

  onMessageUpsert: (cb: (msg: MessageDto) => void): Promise<UnlistenFn> =>
    listen("realtime:message_upsert", (e) => cb(e.payload as MessageDto)),

  onMessageSeen: (
    cb: (payload: {
      conversation_id: string;
      message_id: string;
      seen_by: SeenReceiptDto[];
    }) => void
  ): Promise<UnlistenFn> =>
    listen("realtime:message_seen", (e) =>
      cb(
        e.payload as {
          conversation_id: string;
          message_id: string;
          seen_by: SeenReceiptDto[];
        }
      )
    ),

  onConversationUpdated: (
    cb: (conv: ConversationDto) => void
  ): Promise<UnlistenFn> =>
    listen("realtime:conversation_updated", (e) =>
      cb(e.payload as ConversationDto)
    ),

  onContactAdded: (cb: (contact: ContactDto) => void): Promise<UnlistenFn> =>
    listen("realtime:contact_added", (e) => cb(e.payload as ContactDto)),

  onNavigateConversation: (
    cb: (payload: { conversation_id: string }) => void
  ): Promise<UnlistenFn> =>
    listen("window:navigate_conversation", (e) =>
      cb(e.payload as { conversation_id: string })
    ),

  onUpdateStateChanged: (
    cb: (status: UpdateStatusDto) => void
  ): Promise<UnlistenFn> =>
    listen("updater:state_changed", (e) => cb(e.payload as UpdateStatusDto)),

  onWindowFocusChanged: (
    cb: (payload: { focused: boolean }) => void
  ): Promise<UnlistenFn> =>
    listen("window:focus_changed", (e) =>
      cb(e.payload as { focused: boolean })
    ),

  onPinsChanged: (
    cb: (payload: { conversation_id: string }) => void
  ): Promise<UnlistenFn> =>
    listen("realtime:pins_changed", (e) =>
      cb(e.payload as { conversation_id: string })
    ),
};

export function extractErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
