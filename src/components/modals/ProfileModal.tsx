import { useState } from "react";
import { Upload, X } from "lucide-react";
import type { UserProfileDto } from "../../lib/types";

interface ProfileModalProps {
  user: UserProfileDto;
  onClose: () => void;
  onSave: (displayName?: string, avatarFilePath?: string) => Promise<void>;
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function ProfileModal({ user, onClose, onSave }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [avatarFilePath, setAvatarFilePath] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(user.avatar_url);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Avatar must be PNG, JPEG, or WEBP.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Avatar image exceeds the 5 MB limit.");
      return;
    }

    const tauriPath = (file as File & { path?: string }).path;
    if (tauriPath) {
      setAvatarFilePath(tauriPath);
    }
    setPreviewUrl(URL.createObjectURL(file));
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Profile Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={displayName}
                className="w-16 h-16 rounded-full object-cover ring-2 ring-[#6366F1]/50"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[#6366F1] text-white font-semibold flex items-center justify-center">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="flex-1 space-y-1.5">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-hairline)] text-xs font-medium cursor-pointer hover:border-[#6366F1]">
                <Upload className="w-3.5 h-3.5" />
                Choose Avatar (≤ 5 MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <p className="text-[11px] text-[var(--text-muted)]">
                @{user.username} • PNG, JPEG, or WEBP
              </p>
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

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              Local Avatar Path (optional override)
            </label>
            <input
              type="text"
              value={avatarFilePath}
              onChange={(e) => setAvatarFilePath(e.target.value)}
              placeholder="C:\Users\...\avatar.png"
              className="w-full px-3 py-2 text-xs rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
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
              className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:bg-white/5"
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
      </div>
    </div>
  );
}
