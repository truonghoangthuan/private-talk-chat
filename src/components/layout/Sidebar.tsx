import { useState } from "react";
import { MessageSquarePlus, Search, UserPlus, Users } from "lucide-react";
import type { ContactDto, ConversationDto, TypingUserDto } from "../../lib/types";

interface SidebarProps {
  currentUserId: string;
  contacts: ContactDto[];
  conversations: ConversationDto[];
  selectedConversationId: string | null;
  onlineUserIds: Set<string>;
  typingByConversation: Record<string, TypingUserDto[]>;
  onAddContactByUsername: (username: string) => Promise<void>;
  onStartDirectChat: (contactUserId: string) => Promise<void>;
  onSelectConversation: (conversationId: string) => void;
  onOpenCreateGroup: () => void;
}

export function Sidebar({
  currentUserId,
  contacts,
  conversations,
  selectedConversationId,
  onlineUserIds,
  typingByConversation,
  onAddContactByUsername,
  onStartDirectChat,
  onSelectConversation,
  onOpenCreateGroup,
}: SidebarProps) {
  const [usernameInput, setUsernameInput] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = usernameInput.trim();
    if (!trimmed) return;
    setSearchError(null);
    setSearching(true);
    try {
      await onAddContactByUsername(trimmed);
      setUsernameInput("");
    } catch (err) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setSearchError(msg);
    } finally {
      setSearching(false);
    }
  };

  const getConversationTitle = (conv: ConversationDto) => {
    if (conv.is_group) return conv.name || "Untitled Group";
    const peer = conv.members.find((m) => m.user_id !== currentUserId);
    return peer?.display_name || peer?.username || "Direct Chat";
  };

  const isConversationOnline = (conv: ConversationDto) => {
    if (conv.is_group) {
      return conv.members.some(
        (m) => m.user_id !== currentUserId && (m.is_online || onlineUserIds.has(m.user_id))
      );
    }
    const peer = conv.members.find((m) => m.user_id !== currentUserId);
    return peer ? peer.is_online || onlineUserIds.has(peer.user_id) : false;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--border-hairline)]">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-sm font-semibold tracking-tight">Private Talk</h1>
          <button
            onClick={onOpenCreateGroup}
            className="p-1.5 rounded-lg hover:bg-[#6366F1]/10 text-[var(--text-muted)] hover:text-[#6366F1] transition-colors"
            title="Create group chat"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAddContact} className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="Exact username..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !usernameInput.trim()}
            className="px-2.5 py-1.5 rounded-lg bg-[#6366F1] text-white text-xs font-medium hover:bg-[#6366F1]/90 disabled:opacity-40 flex items-center gap-1 transition-colors"
            title="Add Contact"
          >
            <UserPlus className="w-3.5 h-3.5" />
          </button>
        </form>
        {searchError && (
          <p className="mt-1.5 text-[11px] text-[#EF4444]">{searchError}</p>
        )}
      </div>

      {/* Contacts row */}
      <div className="px-4 py-3 border-b border-[var(--border-hairline)]">
        <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Contacts ({contacts.length})
        </div>
        {contacts.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            Search an exact username above to add a mutual contact.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {contacts.map((c) => {
              const online = c.is_online || onlineUserIds.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => onStartDirectChat(c.id)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--bg-canvas)] border border-[var(--border-hairline)] hover:border-[#6366F1]/50 transition-colors text-xs"
                  title={`Chat with ${c.display_name} (@${c.username})`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      online ? "bg-[#10B981]" : "bg-slate-500"
                    }`}
                  />
                  <span className="max-w-[100px] truncate">{c.display_name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Conversations
        </div>
        {conversations.length === 0 ? (
          <div className="px-3 py-6 text-xs text-center text-[var(--text-muted)]">
            No conversations yet. Select a contact or create a group.
          </div>
        ) : (
          conversations.map((conv) => {
            const active = conv.id === selectedConversationId;
            const online = isConversationOnline(conv);
            const typing = (typingByConversation[conv.id] || []).filter(
              (t) => t.user_id !== currentUserId
            );
            const title = getConversationTitle(conv);

            return (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-colors ${
                  active
                    ? "bg-[#6366F1]/15 text-[var(--text-primary)]"
                    : "hover:bg-white/5 text-[var(--text-primary)]"
                }`}
              >
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-[#6366F1]/20 text-[#6366F1] text-xs font-semibold flex items-center justify-center">
                    {conv.is_group ? (
                      <Users className="w-4 h-4" />
                    ) : (
                      title.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--bg-surface)] ${
                      online ? "bg-[#10B981]" : "bg-slate-500"
                    }`}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate">{title}</span>
                    {conv.unread_count > 0 && (
                      <span className="shrink-0 min-w-4 h-4 px-1 rounded-full bg-[#6366F1] text-white text-[10px] font-bold flex items-center justify-center">
                        {conv.unread_count > 99 ? "99+" : conv.unread_count}
                      </span>
                    )}
                  </div>

                  {typing.length > 0 ? (
                    <p className="text-[11px] italic text-[#10B981] truncate">
                      {typing.map((t) => t.display_name).join(", ")} typing...
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {conv.latest_preview || "Encrypted channel ready"}
                    </p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
