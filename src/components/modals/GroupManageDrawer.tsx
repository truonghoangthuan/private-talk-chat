import { useState } from "react";
import { Crown, LogOut, UserMinus, UserPlus, X } from "lucide-react";
import type { ContactDto, ConversationDto } from "../../lib/types";

interface GroupManageDrawerProps {
  mode: "create" | "manage";
  currentUserId: string;
  contacts: ContactDto[];
  conversation: ConversationDto | null;
  onClose: () => void;
  onCreateGroup: (name: string, memberUserIds: string[]) => Promise<void>;
  onRenameGroup: (conversationId: string, name: string) => Promise<void>;
  onAddMember: (conversationId: string, contactUserId: string) => Promise<void>;
  onRemoveMember: (conversationId: string, targetUserId: string) => Promise<void>;
  onLeaveGroup: (conversationId: string) => Promise<void>;
}

export function GroupManageDrawer({
  mode,
  currentUserId,
  contacts,
  conversation,
  onClose,
  onCreateGroup,
  onRenameGroup,
  onAddMember,
  onRemoveMember,
  onLeaveGroup,
}: GroupManageDrawerProps) {
  const [groupName, setGroupName] = useState(
    mode === "manage" && conversation?.name ? conversation.name : ""
  );
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingRemoveUserId, setConfirmingRemoveUserId] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const isHost = conversation?.host_id === currentUserId;
  const existingMemberIds = new Set(
    conversation?.members.map((m) => m.user_id) || []
  );
  const addableContacts = contacts.filter((c) => !existingMemberIds.has(c.id));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = groupName.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setError("Group name must be 1–80 characters.");
      return;
    }
    setBusy(true);
    try {
      await onCreateGroup(trimmed, selectedContactIds);
      onClose();
    } catch (err) {
      setError(String((err as { message?: string }).message || err));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversation) return;
    setError(null);
    const trimmed = groupName.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setError("Group name must be 1–80 characters.");
      return;
    }
    setBusy(true);
    try {
      await onRenameGroup(conversation.id, trimmed);
    } catch (err) {
      setError(String((err as { message?: string }).message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-sm h-full bg-[var(--bg-surface)] border-l border-[var(--border-hairline)] p-5 flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">
            {mode === "create" ? "New Group Chat" : "Group Settings"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-3 p-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
            {error}
          </div>
        )}

        {mode === "create" ? (
          <form onSubmit={handleCreate} className="flex-1 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                Group Name (1–80 chars)
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Project Vault"
                className="w-full px-3 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="text-xs font-medium text-[var(--text-muted)] mb-2">
                Select Contacts
              </div>
              <div className="space-y-1.5">
                {contacts.map((c) => {
                  const checked = selectedContactIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2.5 p-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedContactIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== c.id)
                              : [...prev, c.id]
                          )
                        }
                      />
                      <span className="flex-1 truncate font-medium">
                        {c.display_name} (@{c.username})
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-[#6366F1] text-white text-xs font-medium hover:bg-[#6366F1]/90 disabled:opacity-50"
            >
              {busy ? "Creating Group..." : "Create Encrypted Group"}
            </button>
          </form>
        ) : (
          conversation && (
            <div className="flex-1 flex flex-col gap-5 overflow-y-auto">
              <form onSubmit={handleRename} className="flex gap-2">
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="px-3 py-2 rounded-xl bg-[#6366F1] text-white text-xs font-medium"
                >
                  Rename
                </button>
              </form>

              <div>
                <div className="text-xs font-medium text-[var(--text-muted)] mb-2">
                  Members ({conversation.members.length}) • Epoch{" "}
                  {conversation.current_epoch}
                </div>
                <div className="space-y-1.5">
                  {conversation.members.map((m) => (
                    <div
                      key={m.user_id}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            m.is_online ? "bg-[#10B981]" : "bg-slate-500"
                          }`}
                        />
                        <span className="text-xs font-medium truncate">
                          {m.display_name}
                        </span>
                        {m.is_host && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#6366F1]/15 text-[#6366F1] text-xs">
                            <Crown className="w-3 h-3" />
                            Host
                          </span>
                        )}
                      </div>
                      {isHost && m.user_id !== currentUserId && (
                        confirmingRemoveUserId === m.user_id ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await onRemoveMember(conversation.id, m.user_id);
                                  setConfirmingRemoveUserId(null);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              disabled={busy}
                              className="px-2 py-0.5 rounded-md bg-[#EF4444] text-white text-xs font-medium hover:bg-[#EF4444]/90 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingRemoveUserId(null)}
                              disabled={busy}
                              className="px-2 py-0.5 rounded-md hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingRemoveUserId(m.user_id)}
                            disabled={busy}
                            className="p-1 rounded-lg hover:bg-[#EF4444]/15 text-[#EF4444]"
                            title="Remove member & rotate group key"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {addableContacts.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-[var(--text-muted)] mb-2">
                    Add Contacts (shares full history)
                  </div>
                  <div className="space-y-1.5">
                    {addableContacts.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)]"
                      >
                        <span className="text-xs truncate">
                          {c.display_name} (@{c.username})
                        </span>
                        <button
                          type="button"
                          onClick={() => onAddMember(conversation.id, c.id)}
                          disabled={busy}
                          className="px-2 py-1 rounded-lg bg-[#6366F1]/15 hover:bg-[var(--bg-hover)] text-[#6366F1] text-xs font-medium flex items-center gap-1"
                        >
                          <UserPlus className="w-3 h-3" />
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {confirmingLeave ? (
                <div className="mt-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onLeaveGroup(conversation.id);
                        setConfirmingLeave(false);
                        onClose();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                    className="flex-1 py-2.5 rounded-xl bg-[#EF4444] hover:bg-[#EF4444]/90 text-white text-xs font-medium disabled:opacity-50"
                  >
                    Confirm Leave
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingLeave(false)}
                    disabled={busy}
                    className="px-4 py-2.5 rounded-xl border border-[var(--border-hairline)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingLeave(true)}
                  disabled={busy}
                  className="mt-auto w-full py-2.5 rounded-xl bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#EF4444] text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Leave Group
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
