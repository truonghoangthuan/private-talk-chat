import { useState } from "react";
import { AlertTriangle, Download, RefreshCw, ShieldCheck, Upload, X } from "lucide-react";
import { extractErrorMessage, tauriClient } from "../../lib/tauri-client";
import type { UpdateStatusDto, UserProfileDto } from "../../lib/types";
import {
  extractFileName,
  formatCryptoFingerprint,
  validateAvatarPath,
} from "../../lib/ui-polish";

interface ProfileModalProps {
  user: UserProfileDto;
  updateStatus: UpdateStatusDto;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onClose: () => void;
  onSave: (displayName?: string, avatarFilePath?: string) => Promise<void>;
}

export function ProfileModal({
  user,
  updateStatus,
  onCheckUpdate,
  onInstallUpdate,
  onClose,
  onSave,
}: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [avatarFilePath, setAvatarFilePath] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handlePickAvatar = async () => {
    setError(null);
    try {
      const selectedPath = await tauriClient.pickAvatarFile();
      if (!selectedPath) return;
      const validation = validateAvatarPath(selectedPath);
      if (!validation.ok) {
        setError(validation.error);
        return;
      }
      setAvatarFilePath(selectedPath);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const dn = displayName.trim();
    if (dn.length < 1 || dn.length > 64) {
      setError("Display name must be between 1 and 64 characters.");
      return;
    }

    setSaving(true);
    try {
      await onSave(
        dn !== user.display_name ? dn : undefined,
        avatarFilePath.trim() || undefined
      );
      onClose();
    } catch (err) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="animate-scale-in w-full max-w-md rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Profile Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={displayName}
                className="w-16 h-16 rounded-full object-cover ring-2 ring-[#6366F1]/50"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[#6366F1] text-white font-semibold flex items-center justify-center">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="flex-1 space-y-1.5">
              <button
                type="button"
                onClick={() => void handlePickAvatar()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-hairline)] text-xs font-medium hover:border-[#6366F1] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                {avatarFilePath
                  ? `Selected: ${extractFileName(avatarFilePath)}`
                  : "Choose Avatar (≤ 5 MB)"}
              </button>
              <p className="text-xs text-[var(--text-muted)]">
                @{user.username} • PNG, JPEG, or WEBP
              </p>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-canvas)] border border-[var(--border-hairline)] text-xs text-[var(--text-muted)]">
                <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
                <span>Identity</span>
                <span className="font-mono font-medium text-[var(--text-primary)]">
                  {formatCryptoFingerprint(`${user.id}:${user.username}`)}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              Display Name (1–64 chars)
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-[#6366F1] text-white text-xs font-medium hover:bg-[#6366F1]/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </form>

        <div className="mt-5 pt-4 border-t border-[var(--border-hairline)] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold">Application Update</h3>
              <p className="text-xs text-[var(--text-muted)]">
                Installed v{updateStatus.current_version}
                {updateStatus.phase === "up_to_date" && " • Up to date"}
                {updateStatus.phase === "checking" && " • Checking..."}
                {updateStatus.phase === "available" &&
                  updateStatus.latest_version &&
                  ` • v${updateStatus.latest_version} available`}
                {updateStatus.phase === "downloading" &&
                  ` • Downloading ${updateStatus.progress_percent ?? 0}%`}
                {updateStatus.phase === "installing" && " • Launching installer..."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCheckUpdate}
                disabled={
                  updateStatus.phase === "checking" ||
                  updateStatus.phase === "downloading" ||
                  updateStatus.phase === "installing"
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-xs font-medium hover:border-[#6366F1] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    updateStatus.phase === "checking" ? "animate-spin" : ""
                  }`}
                />
                Check for update
              </button>
              {updateStatus.phase === "available" && (
                <button
                  type="button"
                  onClick={onInstallUpdate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366F1] text-white text-xs font-medium hover:bg-[#6366F1]/90"
                >
                  <Download className="w-3.5 h-3.5" />
                  Update
                </button>
              )}
            </div>
          </div>

          {updateStatus.release_notes &&
            (updateStatus.phase === "available" ||
              updateStatus.phase === "downloading" ||
              updateStatus.phase === "installing") && (
              <p className="text-xs text-[var(--text-muted)] bg-[var(--bg-canvas)] border border-[var(--border-hairline)] rounded-xl p-2.5 whitespace-pre-wrap max-h-24 overflow-y-auto">
                {updateStatus.release_notes}
              </p>
            )}

          {updateStatus.phase === "downloading" && (
            <div className="w-full h-1.5 rounded-full bg-[var(--bg-canvas)] overflow-hidden">
              <div
                className="h-full bg-[#6366F1] transition-all"
                style={{ width: `${updateStatus.progress_percent ?? 0}%` }}
              />
            </div>
          )}

          {updateStatus.phase === "verification_failed" && (
            <div className="p-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Security Warning: Update signature or integrity check failed and
                installation was blocked.
                {updateStatus.error_message
                  ? ` (${updateStatus.error_message})`
                  : ""}
              </span>
            </div>
          )}

          {updateStatus.phase === "error" && updateStatus.error_message && (
            <div className="p-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
              {updateStatus.error_message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
