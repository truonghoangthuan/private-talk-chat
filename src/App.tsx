import { useCallback, useEffect, useState } from "react";
import { Download, Wifi, WifiOff, X } from "lucide-react";
import appIcon from "./assets/app-icon.png";
import { AppShell } from "./components/layout/AppShell";
import { NavRail } from "./components/layout/NavRail";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatHeader } from "./components/chat/ChatHeader";
import { MessageTimeline } from "./components/chat/MessageTimeline";
import { PinnedMessagesView } from "./components/chat/PinnedMessagesView";
import { TypingIndicator } from "./components/chat/TypingIndicator";
import { MessageComposer } from "./components/chat/MessageComposer";
import { MessageSearchBar } from "./components/chat/MessageSearchBar";
import { AuthScreen } from "./components/modals/AuthScreen";
import { ProfileModal } from "./components/modals/ProfileModal";
import { GroupManageDrawer } from "./components/modals/GroupManageDrawer";
import { KeyboardShortcutsModal } from "./components/modals/KeyboardShortcutsModal";
import { tauriClient } from "./lib/tauri-client";
import {
  syncPinnedMessage,
  upsertMessageWithReplySync,
  getDraft,
  updateDraft,
  findUnreadDividerMessageId,
  computeDocumentTitle,
  formatOfflineDuration,
  loadMutedConversationIds,
  saveMutedConversationIds,
  loadThemePreference,
  saveThemePreference,
  shouldOpenConversationSearch,
  shouldOpenShortcutsHelp,
  sumUnreadExcludingMuted,
  toggleMutedConversationId,
} from "./lib/ui-polish";
import type {
  ContactDto,
  ConversationDto,
  MessageDto,
  PinnedMessageDto,
  TypingUserDto,
  UpdateStatusDto,
  UserProfileDto,
} from "./lib/types";

const INITIAL_UPDATE_STATUS: UpdateStatusDto = {
  phase: "idle",
  current_version: "0.1.0",
  latest_version: null,
  release_notes: null,
  published_at: null,
  progress_percent: null,
  downloaded_bytes: null,
  total_bytes: null,
  error_code: null,
  error_message: null,
};

export function App() {
  const [user, setUser] = useState<UserProfileDto | null>(null);
  const [booting, setBooting] = useState(true);
  const [darkMode, setDarkMode] = useState<boolean>(() =>
    loadThemePreference(
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : true
    )
  );
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [replyingTo, setReplyingTo] = useState<MessageDto | null>(null);
  const [activeTab, setActiveTab] = useState<"messages" | "pinned">("messages");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessageDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(
    null
  );
  const [unreadDividerMessageId, setUnreadDividerMessageId] = useState<string | null>(
    null
  );
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [typingByConv, setTypingByConv] = useState<
    Record<string, TypingUserDto[]>
  >({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [groupDrawerMode, setGroupDrawerMode] = useState<
    "create" | "manage" | null
  >(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusDto>(
    INITIAL_UPDATE_STATUS
  );
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const [isWindowFocused, setIsWindowFocused] = useState<boolean>(() =>
    typeof document !== "undefined" ? document.hasFocus() : true
  );
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [mutedConversationIds, setMutedConversationIds] = useState<string[]>([]);

  const handleCheckUpdate = useCallback(() => {
    setUpdateBannerDismissed(false);
    tauriClient
      .updateCheck(false)
      .then(setUpdateStatus)
      .catch(() => {});
  }, []);

  const handleInstallUpdate = useCallback(() => {
    tauriClient
      .updateInstall()
      .then(setUpdateStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    saveThemePreference(darkMode);
  }, [darkMode]);

  // Reload the muted-conversation set whenever the signed-in user changes
  // (login, logout, or switching accounts without restarting the app), so
  // one user's muted chats never bleed into another's unread badges/title.
  useEffect(() => {
    setMutedConversationIds(user ? loadMutedConversationIds(user.id) : []);
  }, [user?.id]);

  const handleToggleMutedConversation = useCallback(
    (conversationId: string) => {
      if (!user) return;
      setMutedConversationIds((prev) => {
        const next = toggleMutedConversationId(prev, conversationId);
        saveMutedConversationIds(user.id, next);
        return next;
      });
    },
    [user]
  );

  // Mirror the total unread message count into the window/document title
  // (e.g. "(3) Bloop") so there's a way to tell at a glance whether anything
  // new has arrived while minimized, behind other windows, or just not
  // focused — matching the Slack/Discord/Gmail convention (issue #42).
  // Muted conversations (see `mutedConversationIds`) are excluded from the
  // count, same as the nav-rail's `totalUnread` below, so a muted chat
  // never puts a number back in front of the app the viewer just silenced.
  // Computed directly from `conversations` rather than reusing the
  // render-scoped `totalUnread` further down, since this effect must run
  // unconditionally (reverting the title to plain "Bloop" once
  // conversations are cleared on logout, before the authenticated view's
  // early return would even compute that render-scoped value).
  useEffect(() => {
    const totalUnreadForTitle = sumUnreadExcludingMuted(conversations, mutedConversationIds);
    document.title = computeDocumentTitle("Bloop", totalUnreadForTitle);
  }, [conversations, mutedConversationIds]);

  useEffect(() => {
    const onFocus = () => setIsWindowFocused(!document.hidden);
    const onBlur = () => setIsWindowFocused(false);
    const onVisibilityChange = () => {
      setIsWindowFocused(!document.hidden && document.hasFocus());
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);

    let active = true;
    const unlistenPromise = tauriClient
      .onWindowFocusChanged(({ focused }) => {
        if (active) {
          setIsWindowFocused(focused && !document.hidden);
        }
      })
      .catch(() => null);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unlistenPromise.then((fn) => fn?.());
    };
  }, []);

  // Surface OS-level network connectivity loss/recovery (issue #46): the
  // app otherwise gives no feedback when `navigator.onLine` goes false, so
  // sends and realtime updates would silently stop working with no
  // explanation. `offlineSince` is a plain local timestamp (not state) since
  // it only feeds the one-shot duration calculation on reconnect and
  // shouldn't itself trigger a re-render.
  useEffect(() => {
    let offlineSince: number | null =
      typeof navigator !== "undefined" && !navigator.onLine ? Date.now() : null;

    const handleOffline = () => {
      offlineSince = Date.now();
      setIsOnline(false);
      setReconnectNotice(null);
    };
    const handleOnline = () => {
      setIsOnline(true);
      if (offlineSince !== null) {
        setReconnectNotice(formatOfflineDuration(Date.now() - offlineSince));
        offlineSince = null;
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // Auto-dismiss the "Back online" confirmation a few seconds after it
  // appears, same convention as other transient confirmations in the app.
  useEffect(() => {
    if (reconnectNotice === null) return;
    const timer = setTimeout(() => setReconnectNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [reconnectNotice]);

  // Open the keyboard shortcuts help modal on the conventional `?` key
  // (Slack/Discord/Linear), unless the user is actively typing in an
  // editable field — see `shouldOpenShortcutsHelp` (issue #48). Also open
  // the in-conversation search bar on Ctrl+F / Cmd+F — the browser/Slack/
  // Discord "find" convention — as an alternative to the header's search
  // icon, overriding the browser's own native find-in-page since there's
  // nothing for it to search within a desktop webview shell.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (
        shouldOpenShortcutsHelp(
          e.key,
          active?.tagName ?? null,
          active?.isContentEditable ?? false
        )
      ) {
        setShortcutsHelpOpen(true);
        return;
      }
      if (shouldOpenConversationSearch(e.key, e.ctrlKey || e.metaKey) && selectedConversationId) {
        e.preventDefault();
        setActiveTab("messages");
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedConversationId]);

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
    let active = true;
    const unlistenPromise = tauriClient.onUpdateStateChanged((status) => {
      if (active) {
        setUpdateStatus(status);
        if (status.phase === "available") {
          setUpdateBannerDismissed(false);
        }
      }
    });
    tauriClient
      .updateGetStatus()
      .then((status) => {
        if (active) setUpdateStatus(status);
      })
      .catch(() => {});
    tauriClient
      .updateCheck(true)
      .then((status) => {
        if (active) setUpdateStatus(status);
      })
      .catch(() => {});

    return () => {
      active = false;
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshContactsAndConversations();
  }, [user, refreshContactsAndConversations]);

  useEffect(() => {
    setReplyingTo(null);
    setActiveTab("messages");
    setSearchOpen(false);
    setHighlightedMessageId(null);
    setUnreadDividerMessageId(null);
    if (!user || !selectedConversationId) {
      setMessages([]);
      setPinnedMessages([]);
      return;
    }
    // Snapshot the unread count now, before marking anything seen resets it to 0 —
    // the divider anchors to where the viewer left off, not a count that's about
    // to disappear.
    const unreadSnapshot =
      conversations.find((c) => c.id === selectedConversationId)?.unread_count ?? 0;
    tauriClient.messageList(selectedConversationId, 50).then((list) => {
      setMessages(list);
      setUnreadDividerMessageId(
        findUnreadDividerMessageId(list, unreadSnapshot, user.id)
      );
      const lastIncoming = [...list]
        .reverse()
        .find((m) => m.sender_id !== user.id && !m.is_removed);
      if (lastIncoming) {
        tauriClient
          .messageMarkSeen(selectedConversationId, lastIncoming.id)
          .then(refreshContactsAndConversations);
      }
    });
    tauriClient
      .messageListPinned(selectedConversationId)
      .then(setPinnedMessages)
      .catch(() => setPinnedMessages([]));
    // Deliberately excludes `conversations`: it's only read for the snapshot above,
    // and adding it as a dep would re-run this effect (and reset the divider) every
    // time unread_count itself changes right after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedConversationId, refreshContactsAndConversations]);

  const scrollToMessage = useCallback((messageId: string) => {
    setActiveTab("messages");
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.getElementById(`msg-${messageId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setHighlightedMessageId(messageId);
          setTimeout(() => {
            setHighlightedMessageId((cur) => (cur === messageId ? null : cur));
          }, 1800);
        }
      }, 30);
    });
  }, []);

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
          setMessages((prev) => upsertMessageWithReplySync(prev, msg));
          setPinnedMessages((prev) => syncPinnedMessage(prev, msg));
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
      tauriClient.onPinsChanged(({ conversation_id }) => {
        if (conversation_id === selectedConversationId) {
          tauriClient
            .messageListPinned(conversation_id)
            .then(setPinnedMessages)
            .catch(() => {});
        }
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

  const privacyShieldOverlay = !isWindowFocused ? (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 backdrop-blur-2xl bg-[var(--bg-canvas)]/80 flex flex-col items-center justify-center gap-3 select-none"
    >
      <img
        src={appIcon}
        alt="Bloop"
        className="w-14 h-14 rounded-2xl object-cover shadow-lg"
      />
      <p className="text-sm font-medium text-[var(--text-primary)]">
        Window unfocused — content hidden for privacy
      </p>
    </div>
  ) : null;

  if (!user) {
    return (
      <div className="relative h-screen w-screen overflow-hidden">
        <div
          className={
            !isWindowFocused
              ? "h-full w-full blur-xl select-none pointer-events-none"
              : "h-full w-full"
          }
          aria-hidden={!isWindowFocused}
        >
          {updateStatus.phase === "available" && !updateBannerDismissed && (
            <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-xl border border-[#6366F1]/40 bg-[var(--bg-surface)] shadow-xl text-xs">
              <span>
                Update v{updateStatus.latest_version} available
              </span>
              <button
                type="button"
                onClick={handleInstallUpdate}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#6366F1] text-white font-medium hover:bg-[#6366F1]/90"
              >
                <Download className="w-3.5 h-3.5" />
                Update
              </button>
              <button
                type="button"
                onClick={() => setUpdateBannerDismissed(true)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <AuthScreen
            updateStatus={updateStatus}
            onCheckUpdate={handleCheckUpdate}
            onInstallUpdate={handleInstallUpdate}
            onLogin={async (u, p) => {
              const prof = await tauriClient.authLogin(u, p);
              setUser(prof);
            }}
            onRegister={async (u, p, dn) => {
              const prof = await tauriClient.authRegister(u, p, dn);
              setUser(prof);
            }}
          />
        </div>
        {privacyShieldOverlay}
      </div>
    );
  }

  const activeConversation =
    conversations.find((c) => c.id === selectedConversationId) || null;
  const totalUnread = sumUnreadExcludingMuted(conversations, mutedConversationIds);
  const activeTypingUsers = activeConversation
    ? (typingByConv[activeConversation.id] || []).filter(
        (t) => t.user_id !== user.id
      )
    : [];

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div
        className={
          !isWindowFocused
            ? "h-full w-full blur-xl select-none pointer-events-none"
            : "h-full w-full"
        }
        aria-hidden={!isWindowFocused}
      >
        <AppShell
        rail={
          <NavRail
            user={user}
            totalUnread={totalUnread}
            darkMode={darkMode}
            updateStatus={updateStatus}
            onToggleTheme={() => setDarkMode((d) => !d)}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
            onCheckUpdate={handleCheckUpdate}
            onInstallUpdate={handleInstallUpdate}
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
            mutedConversationIds={mutedConversationIds}
            onToggleMuted={handleToggleMutedConversation}
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
          <>
            {!isOnline && (
              <div className="px-4 py-2 border-b border-[var(--border-hairline)] bg-red-500/10 flex items-center gap-2 text-xs">
                <WifiOff className="w-3.5 h-3.5" />
                <span>
                  You&rsquo;re offline. Messages will send once your connection is back.
                </span>
              </div>
            )}
            {isOnline && reconnectNotice && (
              <div className="px-4 py-2 border-b border-[var(--border-hairline)] bg-emerald-500/10 flex items-center justify-between gap-3 text-xs">
                <span className="inline-flex items-center gap-2">
                  <Wifi className="w-3.5 h-3.5" />
                  Back online — you were offline for {reconnectNotice}.
                </span>
                <button
                  type="button"
                  onClick={() => setReconnectNotice(null)}
                  className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                >
                  Dismiss
                </button>
              </div>
            )}
            {updateStatus.phase === "available" && !updateBannerDismissed && (
              <div className="px-4 py-2 border-b border-[var(--border-hairline)] bg-[#6366F1]/10 flex items-center justify-between gap-3 text-xs">
                <span>
                  Bloop v{updateStatus.latest_version} is available.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleInstallUpdate}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#6366F1] text-white font-medium hover:bg-[#6366F1]/90"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Update
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpdateBannerDismissed(true)}
                    className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            {activeConversation ? (
              <>
                <ChatHeader
                  conversation={activeConversation}
                  currentUserId={user.id}
                  onlineUserIds={onlineUserIds}
                  activeTab={activeTab}
                  pinnedCount={pinnedMessages.length}
                  searchOpen={searchOpen}
                  onTabChange={setActiveTab}
                  onToggleSearch={() => {
                    setSearchOpen((v) => !v);
                    setActiveTab("messages");
                  }}
                  onOpenGroupDrawer={() => setGroupDrawerMode("manage")}
                />
                {searchOpen && activeTab === "messages" && (
                  <MessageSearchBar
                    messages={messages}
                    onJumpToMessage={scrollToMessage}
                    onClose={() => setSearchOpen(false)}
                  />
                )}
                {activeTab === "pinned" ? (
                  <PinnedMessagesView
                    pinnedMessages={pinnedMessages}
                    currentUserId={user.id}
                    onJumpToMessage={scrollToMessage}
                    onUnpinMessage={async (mid) => {
                      await tauriClient.messageUnpin(activeConversation.id, mid);
                      const updatedPins = await tauriClient.messageListPinned(
                        activeConversation.id
                      );
                      setPinnedMessages(updatedPins);
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === mid
                            ? {
                                ...m,
                                is_pinned: false,
                                pinned_at: null,
                                pinned_by_display_name: null,
                              }
                            : m
                        )
                      );
                    }}
                  />
                ) : (
                  <>
                    <MessageTimeline
                      messages={messages}
                      currentUserId={user.id}
                      highlightedMessageId={highlightedMessageId}
                      unreadDividerMessageId={unreadDividerMessageId}
                      onEditMessage={async (mid, text) => {
                        const updated = await tauriClient.messageEdit(mid, text);
                        setMessages((prev) =>
                          upsertMessageWithReplySync(prev, updated)
                        );
                        setPinnedMessages((prev) =>
                          syncPinnedMessage(prev, updated)
                        );
                      }}
                      onRemoveMessage={async (mid) => {
                        const wiped = await tauriClient.messageRemove(mid);
                        setMessages((prev) =>
                          upsertMessageWithReplySync(prev, wiped)
                        );
                        setPinnedMessages((prev) =>
                          syncPinnedMessage(prev, wiped)
                        );
                      }}
                      onReplyMessage={(msg) => setReplyingTo(msg)}
                      onTogglePinMessage={async (msg) => {
                        if (msg.is_pinned) {
                          await tauriClient.messageUnpin(
                            activeConversation.id,
                            msg.id
                          );
                          setMessages((prev) =>
                            prev.map((m) =>
                              m.id === msg.id
                                ? {
                                    ...m,
                                    is_pinned: false,
                                    pinned_at: null,
                                    pinned_by_display_name: null,
                                  }
                                : m
                            )
                          );
                        } else {
                          const pinned = await tauriClient.messagePin(
                            activeConversation.id,
                            msg.id
                          );
                          setMessages((prev) =>
                            prev.map((m) =>
                              m.id === msg.id ? pinned.message : m
                            )
                          );
                        }
                        const updatedPins = await tauriClient.messageListPinned(
                          activeConversation.id
                        );
                        setPinnedMessages(updatedPins);
                      }}
                      onJumpToMessage={scrollToMessage}
                    />
                    <TypingIndicator typingUsers={activeTypingUsers} />
                    <MessageComposer
                      key={activeConversation.id}
                      initialText={getDraft(drafts, activeConversation.id)}
                      onDraftChange={(text) =>
                        setDrafts((prev) =>
                          updateDraft(prev, activeConversation.id, text)
                        )
                      }
                      replyingTo={replyingTo}
                      onCancelReply={() => setReplyingTo(null)}
                      onSend={async (text, attachmentPath) => {
                        const sent = await tauriClient.messageSend(
                          activeConversation.id,
                          text,
                          attachmentPath,
                          replyingTo?.id
                        );
                        setReplyingTo(null);
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
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <img
                  src={appIcon}
                  alt="Bloop"
                  className="w-14 h-14 rounded-2xl object-cover shadow-md mb-3"
                />
                <h2 className="text-base font-semibold mb-1">
                  Bloop E2EE Workspace
                </h2>
                <p className="text-xs text-[var(--text-muted)] max-w-xs">
                  Select a conversation or add a contact by exact username to
                  start an encrypted chat.
                </p>
              </div>
            )}
          </>
        }
      />

      {profileOpen && (
        <ProfileModal
          user={user}
          updateStatus={updateStatus}
          onCheckUpdate={handleCheckUpdate}
          onInstallUpdate={handleInstallUpdate}
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
            setDrafts((prev) => updateDraft(prev, cid, ""));
            await refreshContactsAndConversations();
          }}
        />
      )}

      {shortcutsHelpOpen && (
        <KeyboardShortcutsModal onClose={() => setShortcutsHelpOpen(false)} />
      )}
      </div>
      {privacyShieldOverlay}
    </div>
  );
}

export default App;
