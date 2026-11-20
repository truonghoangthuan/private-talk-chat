import { useEffect, useState } from "react";
import { Download, Lock, Pin, Search, Settings2, Users } from "lucide-react";
import type { ConversationDto } from "../../lib/types";
import { formatCryptoFingerprint } from "../../lib/ui-polish";

interface ChatHeaderProps {
  conversation: ConversationDto;
  currentUserId: string;
  onlineUserIds: Set<string>;
  activeTab: "messages" | "pinned";
  pinnedCount: number;
  searchOpen: boolean;
  onTabChange: (tab: "messages" | "pinned") => void;
  onToggleSearch: () => void;
  onOpenGroupDrawer: () => void;
  /** Exports the currently-loaded message history to a local .txt file (issue #106). */
  onExportConversation?: () => void;
}

export function ChatHeader({
  conversation,
  currentUserId,
  onlineUserIds,
  activeTab,
  pinnedCount,
  searchOpen,
  onTabChange,
  onToggleSearch,
  onOpenGroupDrawer,
  onExportConversation,
}: ChatHeaderProps) {
  const peer = !conversation.is_group
    ? conversation.members.find((m) => m.user_id !== currentUserId)
    : undefined;
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [conversation.id, peer?.avatar_url]);

  const title = conversation.is_group
    ? conversation.name || "Untitled Group"
    : peer?.display_name || peer?.username || "Direct Chat";

  const isOnline = conversation.is_group
    ? conversation.members.some(
        (m) => m.user_id !== currentUserId && (m.is_online || onlineUserIds.has(m.user_id))
      )
    : peer
    ? peer.is_online || onlineUserIds.has(peer.user_id)
    : false;

  const subtitle = conversation.is_group
    ? `${conversation.members.length} members • Epoch ${conversation.current_epoch}`
    : isOnline
    ? "Online"
    : "Offline";

  const channelFingerprint = formatCryptoFingerprint(
    `${conversation.id}:epoch-${conversation.current_epoch}`
  );

  return (
    <header className="h-14 shrink-0 px-5 border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]/70 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative">
          {!conversation.is_group && peer?.avatar_url && !avatarFailed ? (
            <img
              src={peer.avatar_url}
              alt={title}
              onError={() => setAvatarFailed(true)}
              className="w-9 h-9 rounded-full object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#6366F1]/15 text-[#6366F1] text-xs font-semibold flex items-center justify-center">
              {conversation.is_group ? (
                <Users className="w-4 h-4" />
              ) : (
                title.slice(0, 2).toUpperCase()
              )}
            </div>
          )}
          <span
            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--bg-surface)] ${
              isOnline ? "bg-[#10B981]" : "bg-slate-500"
            }`}
          />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold truncate">{title}</h2>
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#10B981]/10 text-[#10B981] text-xs font-medium"
              title="End-to-End Encrypted with ChaCha20-Poly1305 & Ed25519"
            >
              <Lock className="w-3 h-3" />
              E2EE
            </span>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[var(--bg-canvas)] border border-[var(--border-hairline)] font-mono text-xs text-[var(--text-muted)]"
              title={`Channel fingerprint for Epoch ${conversation.current_epoch}`}
            >
              {channelFingerprint}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {onExportConversation && (
          <button
            type="button"
            onClick={onExportConversation}
            title="Export conversation to a .txt file"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={onToggleSearch}
          aria-pressed={searchOpen}
          title="Search in conversation"
          className={`p-1.5 rounded-lg transition-colors ${
            searchOpen
              ? "bg-[#6366F1] text-white"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          <Search className="w-3.5 h-3.5" />
        </button>

        <div
          role="tablist"
          aria-label="Conversation view"
          className="inline-flex items-center p-0.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-hairline)] text-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "messages"}
            onClick={() => onTabChange("messages")}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
              activeTab === "messages"
                ? "bg-[#6366F1] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Messages
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pinned"}
            onClick={() => onTabChange("pinned")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors ${
              activeTab === "pinned"
                ? "bg-[#6366F1] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Pin className="w-3 h-3" />
            <span>Pinned</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[11px] font-semibold ${
                activeTab === "pinned"
                  ? "bg-white/20 text-white"
                  : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
              }`}
            >
              {pinnedCount}
            </span>
          </button>
        </div>

        {conversation.is_group && (
          <button
            onClick={onOpenGroupDrawer}
            className="px-2.5 py-1.5 rounded-lg border border-[var(--border-hairline)] hover:border-[#6366F1]/50 hover:bg-[var(--bg-hover)] text-xs font-medium flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Group
          </button>
        )}
      </div>
    </header>
  );
}
