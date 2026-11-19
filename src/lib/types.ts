export type DecryptionStatus = "verified" | "verification_failed" | "removed";

export interface UserProfileDto {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface ContactDto {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
}

export interface ConversationMemberDto {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
  is_host: boolean;
  joined_at: string;
}

export interface ConversationDto {
  id: string;
  is_group: boolean;
  name: string | null;
  host_id: string | null;
  current_epoch: number;
  members: ConversationMemberDto[];
  latest_preview: string | null;
  latest_timestamp: string | null;
  unread_count: number;
  updated_at: string;
}

export interface MediaAttachmentDto {
  mime_type: string;
  file_name: string;
  size_bytes: number;
  media_url: string;
}

export interface SeenReceiptDto {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  seen_at: string;
}

export interface MessageDto {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_username: string;
  sender_display_name: string;
  sender_avatar_url: string | null;
  epoch: number;
  status: DecryptionStatus;
  text: string | null;
  attachment: MediaAttachmentDto | null;
  is_edited: boolean;
  edited_at: string | null;
  is_removed: boolean;
  removed_at: string | null;
  created_at: string;
  seen_by: SeenReceiptDto[];
}

export interface TypingUserDto {
  user_id: string;
  display_name: string;
}

export interface AppError {
  code: string;
  message: string;
}
