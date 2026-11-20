import { useMemo, useState } from "react";
import { AlertTriangle, Download, Lock, RefreshCw } from "lucide-react";
import appIcon from "../../assets/app-icon.png";
import type { UpdateStatusDto } from "../../lib/types";
import { assessPasswordStrength } from "../../lib/ui-polish";

interface AuthScreenProps {
  updateStatus: UpdateStatusDto;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (
    username: string,
    password: string,
    displayName: string
  ) => Promise<void>;
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

// Score 0 ("Too short") is never rendered by the meter (see password.length
// check at the call site), so these maps only need to cover 1-4.
const PASSWORD_STRENGTH_BAR_COLOR: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-[#EF4444]",
  2: "bg-[#F59E0B]",
  3: "bg-[#6366F1]",
  4: "bg-[#10B981]",
};
const PASSWORD_STRENGTH_TEXT_COLOR: Record<1 | 2 | 3 | 4, string> = {
  1: "text-[#EF4444]",
  2: "text-[#F59E0B]",
  3: "text-[#6366F1]",
  4: "text-[#10B981]",
};

export function AuthScreen({
  updateStatus,
  onCheckUpdate,
  onInstallUpdate,
  onLogin,
  onRegister,
}: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordStrength = useMemo(
    () => assessPasswordStrength(password),
    [password]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!USERNAME_RE.test(username.trim())) {
      setError("Username must be 3–32 ASCII letters, numbers, or underscores.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (mode === "register") {
      const dn = displayName.trim();
      if (dn.length < 1 || dn.length > 64) {
        setError("Display name must be between 1 and 64 characters.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await onLogin(username.trim(), password);
      } else {
        await onRegister(username.trim(), password, displayName.trim());
      }
    } catch (err) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-primary)] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-7 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <img
            src={appIcon}
            alt="Bloop"
            className="w-10 h-10 rounded-xl object-cover shadow-sm"
          />
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Bloop</h1>
            <p className="text-xs text-[var(--text-muted)]">
              Zero-knowledge Windows encrypted chat
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] mb-5">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${
              mode === "login"
                ? "bg-[#6366F1] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${
              mode === "register"
                ? "bg-[#6366F1] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="alice_vance"
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alice Vance"
                className="w-full px-3 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3 py-2 text-sm rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)] focus:outline-none focus:border-[#6366F1]"
            />
            {mode === "register" && password.length > 0 && (
              <div className="mt-1.5" aria-live="polite">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((segment) => (
                    <div
                      key={segment}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        segment <= passwordStrength.score
                          ? PASSWORD_STRENGTH_BAR_COLOR[passwordStrength.score as 1 | 2 | 3 | 4]
                          : "bg-[var(--border-hairline)]"
                      }`}
                    />
                  ))}
                </div>
                <p
                  className={`mt-1 text-[11px] font-medium ${PASSWORD_STRENGTH_TEXT_COLOR[passwordStrength.score as 1 | 2 | 3 | 4]}`}
                >
                  {passwordStrength.label}
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-xl bg-[#6366F1] hover:bg-[#6366F1]/90 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Lock className="w-4 h-4" />
            {submitting
              ? "Deriving Keys..."
              : mode === "login"
              ? "Unlock & Sign In"
              : "Generate Keys & Register"}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-[var(--border-hairline)] space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
            <span>
              v{updateStatus.current_version}
              {updateStatus.phase === "up_to_date" && " • Up to date"}
              {updateStatus.phase === "checking" && " • Checking..."}
              {updateStatus.phase === "available" &&
                updateStatus.latest_version &&
                ` • v${updateStatus.latest_version} ready`}
              {updateStatus.phase === "downloading" &&
                ` • ${updateStatus.progress_percent ?? 0}%`}
              {updateStatus.phase === "installing" && " • Installing..."}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCheckUpdate}
                disabled={
                  updateStatus.phase === "checking" ||
                  updateStatus.phase === "downloading" ||
                  updateStatus.phase === "installing"
                }
                className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3 h-3 ${
                    updateStatus.phase === "checking" ? "animate-spin" : ""
                  }`}
                />
                Check for update
              </button>
              {updateStatus.phase === "available" && (
                <button
                  type="button"
                  onClick={onInstallUpdate}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#6366F1] text-white font-medium hover:bg-[#6366F1]/90"
                >
                  <Download className="w-3 h-3" />
                  Update
                </button>
              )}
            </div>
          </div>

          {updateStatus.phase === "downloading" && (
            <div className="w-full h-1 rounded-full bg-[var(--bg-canvas)] overflow-hidden">
              <div
                className="h-full bg-[#6366F1] transition-all"
                style={{ width: `${updateStatus.progress_percent ?? 0}%` }}
              />
            </div>
          )}

          {updateStatus.phase === "verification_failed" && (
            <div className="p-2 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444] flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Update verification failed; installation blocked.
              </span>
            </div>
          )}

          {updateStatus.phase === "error" && updateStatus.error_message && (
            <div className="p-2 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
              {updateStatus.error_message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
