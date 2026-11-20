import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";
import { KEYBOARD_SHORTCUTS } from "../../lib/ui-polish";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

/**
 * Lists the composer/timeline/search keyboard shortcuts already supported
 * across the app (issue #48). Opened via a NavRail button or the `?` key
 * (see `shouldOpenShortcutsHelp` in `lib/ui-polish.ts`); previously these
 * were only discoverable by accident. Client-side only, no Tauri IPC.
 */
export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold inline-flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-[#6366F1]" />
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ul className="space-y-2.5">
          {KEYBOARD_SHORTCUTS.map((entry) => (
            <li
              key={entry.keys}
              className="flex items-start justify-between gap-4 text-xs"
            >
              <span className="text-[var(--text-muted)] leading-5">{entry.description}</span>
              <kbd className="shrink-0 px-2 py-1 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-hairline)] font-mono font-medium text-[var(--text-primary)] whitespace-nowrap">
                {entry.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
