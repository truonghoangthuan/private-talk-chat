import { useEffect } from "react";
import { MessageSquare, X } from "lucide-react";
import type { MessageNotificationToast } from "../../lib/ui-polish";
import { MESSAGE_TOAST_AUTO_DISMISS_MS } from "../../lib/ui-polish";

interface MessageToastStackProps {
  toasts: MessageNotificationToast[];
  onOpenConversation: (conversationId: string) => void;
  onDismiss: (toastId: string) => void;
}

/**
 * Fixed top-right stack of transient "new message in another conversation"
 * toasts (issue #82) — Slack/Discord/Telegram's convention of calling out
 * which conversation and what briefly arrived, instead of only the
 * sidebar's unread badge ticking up silently. Renders nothing when there's
 * nothing to show. Deliberately mounted inside the app's existing
 * focus-loss privacy-blur container (see `App.tsx`) rather than above it,
 * so a toast's sender/preview text is hidden the same way every other
 * message is while the window is unfocused.
 */
export function MessageToastStack({
  toasts,
  onOpenConversation,
  onDismiss,
}: MessageToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-40 flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map((toast) => (
        <MessageToastCard
          key={toast.id}
          toast={toast}
          onOpenConversation={onOpenConversation}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

function MessageToastCard({
  toast,
  onOpenConversation,
  onDismiss,
}: {
  toast: MessageNotificationToast;
  onOpenConversation: (conversationId: string) => void;
  onDismiss: (toastId: string) => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), MESSAGE_TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id]);

  return (
    <button
      type="button"
      onClick={() => {
        onOpenConversation(toast.conversationId);
        onDismiss(toast.id);
      }}
      className="animate-slide-up-fade pointer-events-auto flex items-start gap-2.5 text-left p-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl hover:border-[#6366F1]/50 transition-colors"
    >
      <span className="w-8 h-8 shrink-0 rounded-lg bg-[#6366F1]/15 text-[#6366F1] flex items-center justify-center">
        <MessageSquare className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
            {toast.senderDisplayName}
            <span className="font-normal text-[var(--text-muted)]"> in {toast.conversationTitle}</span>
          </span>
        </span>
        <span className="block text-xs text-[var(--text-muted)] truncate mt-0.5">
          {toast.preview}
        </span>
      </span>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            onDismiss(toast.id);
          }
        }}
        title="Dismiss"
        className="shrink-0 p-0.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        <X className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}
