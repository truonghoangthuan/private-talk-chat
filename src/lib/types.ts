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

export interface MessageReplyPreviewDto {
  message_id: string;
  sender_id: string;
  sender_display_name: string;
  status: DecryptionStatus;
  text: string | null;
  has_attachment: boolean;
  attachment_mime: string | null;
  is_edited: boolean;
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
  reply_to: MessageReplyPreviewDto | null;
  is_pinned: boolean;
  pinned_at: string | null;
  pinned_by_display_name: string | null;
  is_edited: boolean;
  edited_at: string | null;
  is_removed: boolean;
  removed_at: string | null;
  created_at: string;
  seen_by: SeenReceiptDto[];
}

export interface PinnedMessageDto {
  conversation_id: string;
  message_id: string;
  pinned_by_id: string;
  pinned_by_display_name: string;
  pinned_at: string;
  message: MessageDto;
}

export interface TypingUserDto {
  user_id: string;
  display_name: string;
}

export interface AppError {
  code: string;
  message: string;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "installing"
  | "verification_failed"
  | "error";

export interface UpdateStatusDto {
  phase: UpdatePhase;
  current_version: string;
  latest_version: string | null;
  release_notes: string | null;
  published_at: string | null;
  progress_percent: number | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  error_code: string | null;
  error_message: string | null;
}
