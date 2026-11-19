import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { AppShell } from "./components/layout/AppShell";
import { NavRail } from "./components/layout/NavRail";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatHeader } from "./components/chat/ChatHeader";
import { MessageTimeline } from "./components/chat/MessageTimeline";
import { TypingIndicator } from "./components/chat/TypingIndicator";
import { MessageComposer } from "./components/chat/MessageComposer";
import { AuthScreen } from "./components/modals/AuthScreen";
import { ProfileModal } from "./components/modals/ProfileModal";
import { GroupManageDrawer } from "./components/modals/GroupManageDrawer";
import { tauriClient } from "./lib/tauri-client";
import type {
  ContactDto,
  ConversationDto,
  MessageDto,
  TypingUserDto,
  UserProfileDto,
} from "./lib/types";

export function App() {
  const [user, setUser] = useState<UserProfileDto | null>(null);
  const [booting, setBooting] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [typingByConv, setTypingByConv] = useState<
    Record<string, TypingUserDto[]>
  >({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [groupDrawerMode, setGroupDrawerMode] = useState<
    "create" | "manage" | null
  >(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  const refreshContactsAndConversations = useCallback(async () => {
    const [cList, convList] = await Promise.all([
      tauriClient.contactList(),
      tauriClient.conversationList(),
    ]);
    setContacts(cList);
    setConversations(convList);
  }, []);

  useEffect(() => {
    tauriClient
      .authRestoreSession()
      .then((restored) => {
        if (restored) {
          setUser(restored);
        }
      })
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshContactsAndConversations();
  }, [user, refreshContactsAndConversations]);

  useEffect(() => {
    if (!user || !selectedConversationId) {
      setMessages([]);
      return;
    }
    tauriClient.messageList(selectedConversationId, 50).then((list) => {
      setMessages(list);
      const lastIncoming = [...list]
        .reverse()
        .find((m) => m.sender_id !== user.id && !m.is_removed);
      if (lastIncoming) {
        tauriClient
          .messageMarkSeen(selectedConversationId, lastIncoming.id)
          .then(refreshContactsAndConversations);
      }
    });
  }, [user, selectedConversationId, refreshContactsAndConversations]);

  useEffect(() => {
    if (!user) return;

    const unlisteners = Promise.all([
      tauriClient.onPresenceChanged(({ online_user_ids }) => {
        setOnlineUserIds(new Set(online_user_ids));
      }),
      tauriClient.onTypingChanged(({ conversation_id, typing_users }) => {
        setTypingByConv((prev) => ({
          ...prev,
          [conversation_id]: typing_users,
        }));
      }),
      tauriClient.onMessageUpsert((msg) => {
        if (msg.conversation_id === selectedConversationId) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === msg.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg;
              return next;
            }
            return [...prev, msg];
          });
          if (msg.sender_id !== user.id && !msg.is_removed) {
            tauriClient.messageMarkSeen(msg.conversation_id, msg.id);
          }
        }
        refreshContactsAndConversations();
      }),
      tauriClient.onMessageSeen(({ conversation_id, message_id, seen_by }) => {
        if (conversation_id === selectedConversationId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === message_id ? { ...m, seen_by } : m))
          );
        }
      }),
      tauriClient.onConversationUpdated(() => {
        refreshContactsAndConversations();
      }),
      tauriClient.onContactAdded(() => {
        refreshContactsAndConversations();
      }),
      tauriClient.onNavigateConversation(({ conversation_id }) => {
        setSelectedConversationId(conversation_id);
      }),
    ]);

    return () => {
      unlisteners.then((fns) => fns.forEach((fn) => fn()));
    };
  }, [user, selectedConversationId, refreshContactsAndConversations]);

  if (booting) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-canvas)] text-xs text-[var(--text-muted)]">
        Restoring Windows DPAPI session...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        onLogin={async (u, p) => {
          const prof = await tauriClient.authLogin(u, p);
          setUser(prof);
        }}
        onRegister={async (u, p, dn) => {
          const prof = await tauriClient.authRegister(u, p, dn);
          setUser(prof);
        }}
      />
    );
  }

  const activeConversation =
    conversations.find((c) => c.id === selectedConversationId) || null;
  const totalUnread = conversations.reduce((acc, c) => acc + c.unread_count, 0);
  const activeTypingUsers = activeConversation
    ? (typingByConv[activeConversation.id] || []).filter(
        (t) => t.user_id !== user.id
      )
    : [];

  return (
    <>
      <AppShell
        rail={
          <NavRail
            user={user}
            totalUnread={totalUnread}
            darkMode={darkMode}
            onToggleTheme={() => setDarkMode((d) => !d)}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenCreateGroup={() => setGroupDrawerMode("create")}
            onLogout={async () => {
              await tauriClient.authLogout();
              setUser(null);
              setSelectedConversationId(null);
            }}
          />
        }
        sidebar={
          <Sidebar
            currentUserId={user.id}
            contacts={contacts}
            conversations={conversations}
            selectedConversationId={selectedConversationId}
            onlineUserIds={onlineUserIds}
            typingByConversation={typingByConv}
            onAddContactByUsername={async (uname) => {
              await tauriClient.contactAddByUsername(uname);
              await refreshContactsAndConversations();
            }}
            onStartDirectChat={async (contactId) => {
              const conv = await tauriClient.conversationStartDirect(contactId);
              await refreshContactsAndConversations();
              setSelectedConversationId(conv.id);
            }}
            onSelectConversation={setSelectedConversationId}
            onOpenCreateGroup={() => setGroupDrawerMode("create")}
          />
        }
        stage={
          activeConversation ? (
            <>
              <ChatHeader
                conversation={activeConversation}
                currentUserId={user.id}
                onlineUserIds={onlineUserIds}
                onOpenGroupDrawer={() => setGroupDrawerMode("manage")}
              />
              <MessageTimeline
                messages={messages}
                currentUserId={user.id}
                onEditMessage={async (mid, text) => {
                  const updated = await tauriClient.messageEdit(mid, text);
                  setMessages((prev) =>
                    prev.map((m) => (m.id === updated.id ? updated : m))
                  );
                }}
                onRemoveMessage={async (mid) => {
                  const wiped = await tauriClient.messageRemove(mid);
                  setMessages((prev) =>
                    prev.map((m) => (m.id === wiped.id ? wiped : m))
                  );
                }}
              />
              <TypingIndicator typingUsers={activeTypingUsers} />
              <MessageComposer
                onSend={async (text, attachmentPath) => {
                  const sent = await tauriClient.messageSend(
                    activeConversation.id,
                    text,
                    attachmentPath
                  );
                  setMessages((prev) => [...prev, sent]);
                  await refreshContactsAndConversations();
                }}
                onTypingChange={(isTyping) => {
                  tauriClient
                    .typingSetStatus(activeConversation.id, isTyping)
                    .catch(() => {});
                }}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-12 h-12 rounded-2xl bg-[#6366F1]/15 text-[#6366F1] flex items-center justify-center mb-3">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h2 className="text-base font-semibold mb-1">
                Private Talk E2EE Workspace
              </h2>
              <p className="text-xs text-[var(--text-muted)] max-w-xs">
                Select a conversation or add a contact by exact username to start
                an encrypted chat.
              </p>
            </div>
          )
        }
      />

      {profileOpen && (
        <ProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onSave={async (dn, avatarPath) => {
            const updated = await tauriClient.profileUpdate(dn, avatarPath);
            setUser(updated);
          }}
        />
      )}

      {groupDrawerMode && (
        <GroupManageDrawer
          mode={groupDrawerMode}
          currentUserId={user.id}
          contacts={contacts}
          conversation={activeConversation}
          onClose={() => setGroupDrawerMode(null)}
          onCreateGroup={async (name, memberIds) => {
            const created = await tauriClient.conversationCreateGroup(
              name,
              memberIds
            );
            await refreshContactsAndConversations();
            setSelectedConversationId(created.id);
          }}
          onRenameGroup={async (cid, name) => {
            await tauriClient.conversationRenameGroup(cid, name);
            await refreshContactsAndConversations();
          }}
          onAddMember={async (cid, uid) => {
            await tauriClient.conversationAddGroupMember(cid, uid);
            await refreshContactsAndConversations();
          }}
          onRemoveMember={async (cid, uid) => {
            await tauriClient.conversationRemoveGroupMember(cid, uid);
            await refreshContactsAndConversations();
          }}
          onLeaveGroup={async (cid) => {
            await tauriClient.conversationLeaveGroup(cid);
            setSelectedConversationId(null);
            await refreshContactsAndConversations();
          }}
        />
      )}
    </>
  );
}

export default App;
