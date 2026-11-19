import { LogOut, Moon, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import type { UserProfileDto } from "../../lib/types";

interface NavRailProps {
  user: UserProfileDto;
  totalUnread: number;
  darkMode: boolean;
  onToggleTheme: () => void;
  onOpenProfile: () => void;
  onOpenCreateGroup: () => void;
  onLogout: () => void;
}

export function NavRail({
  user,
  totalUnread,
  darkMode,
  onToggleTheme,
  onOpenProfile,
  onOpenCreateGroup,
  onLogout,
}: NavRailProps) {
  const initials = user.display_name.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center justify-between h-full w-full">
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-xl bg-[#6366F1]/15 text-[#6366F1] flex items-center justify-center"
          title="Private Talk — End-to-End Encrypted"
        >
          <ShieldCheck className="w-5 h-5" />
        </div>

        <button
          onClick={onOpenProfile}
          className="relative group focus:outline-none"
          title={`${user.display_name} (@${user.username})`}
        >
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.display_name}
              className="w-10 h-10 rounded-full object-cover ring-2 ring-[#10B981]/60 transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#6366F1] text-white text-xs font-semibold flex items-center justify-center ring-2 ring-[#10B981]/60 transition-transform group-hover:scale-105">
              {initials}
            </div>
          )}
          <span
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#10B981] ring-2 ring-[var(--bg-surface)]"
            title="Online"
          />
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </button>

        <button
          onClick={onOpenCreateGroup}
          className="w-10 h-10 rounded-xl hover:bg-[#6366F1]/10 text-[var(--text-muted)] hover:text-[#6366F1] flex items-center justify-center transition-colors"
          title="New Group Chat"
        >
          <Users className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          onClick={onToggleTheme}
          className="w-10 h-10 rounded-xl hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
          title={darkMode ? "Switch to light theme" : "Switch to dark theme"}
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          onClick={onOpenProfile}
          className="w-10 h-10 rounded-xl hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
          title="Profile Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={onLogout}
          className="w-10 h-10 rounded-xl hover:bg-[#EF4444]/10 text-[var(--text-muted)] hover:text-[#EF4444] flex items-center justify-center transition-colors"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
