import type { TypingUserDto } from "../../lib/types";

interface TypingIndicatorProps {
  typingUsers: TypingUserDto[];
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const label =
    typingUsers.length === 1
      ? `${typingUsers[0].display_name} is typing...`
      : `${typingUsers.map((u) => u.display_name).join(", ")} are typing...`;

  return (
    <div className="px-5 pb-1.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border-hairline)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] typing-dot-1" />
        <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] typing-dot-2" />
        <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] typing-dot-3" />
      </span>
      <span className="italic">{label}</span>
    </div>
  );
}
