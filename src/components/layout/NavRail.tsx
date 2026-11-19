import {
  Download,
  LogOut,
  Moon,
  RefreshCw,
  Settings,
  Sun,
} from "lucide-react";
import appIcon from "../../assets/app-icon.png";
import type { UpdateStatusDto, UserProfileDto } from "../../lib/types";

interface NavRailProps {
  user: UserProfileDto;
  totalUnread: number;
  darkMode: boolean;
  updateStatus: UpdateStatusDto;
  onToggleTheme: () => void;
  onOpenProfile: () => void;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onLogout: () => void;
}

export function NavRail({
  user,
  totalUnread,
  darkMode,
  updateStatus,
  onToggleTheme,
  onOpenProfile,
  onCheckUpdate,
  onInstallUpdate,
  onLogout,
}: NavRailProps) {
  const initials = user.display_name.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center justify-between h-full w-full">
      <div className="flex flex-col items-center gap-4">
        <img
          src={appIcon}
          alt="Private Talk"
          className="w-10 h-10 rounded-xl object-cover shadow-sm"
          title="Private Talk — End-to-End Encrypted"
        />

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
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#EF4444] text-white text-xs font-bold flex items-center justify-center">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </button>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          onClick={onToggleTheme}
          className="w-10 h-10 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
          title={darkMode ? "Switch to light theme" : "Switch to dark theme"}
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          onClick={
            updateStatus.phase === "available" ? onInstallUpdate : onCheckUpdate
          }
          disabled={
            updateStatus.phase === "checking" ||
            updateStatus.phase === "downloading" ||
            updateStatus.phase === "installing"
          }
          className="relative w-10 h-10 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors disabled:opacity-50"
          title={
            updateStatus.phase === "available" && updateStatus.latest_version
              ? `Update available: v${updateStatus.latest_version} (click to update)`
              : updateStatus.phase === "downloading"
              ? `Downloading update (${updateStatus.progress_percent ?? 0}%)`
              : updateStatus.phase === "verification_failed"
              ? "Update verification failed — click to re-check"
              : `Check for update (v${updateStatus.current_version})`
          }
        >
          {updateStatus.phase === "available" ? (
            <Download className="w-4 h-4 text-[#6366F1]" />
          ) : (
            <RefreshCw
              className={`w-4 h-4 ${
                updateStatus.phase === "checking" ? "animate-spin" : ""
              }`}
            />
          )}
          {updateStatus.phase === "available" && (
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#10B981]" />
          )}
          {updateStatus.phase === "verification_failed" && (
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#EF4444]" />
          )}
        </button>

        <button
          onClick={onOpenProfile}
          className="w-10 h-10 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
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
