import type { ReactNode } from "react";

interface AppShellProps {
  rail: ReactNode;
  sidebar: ReactNode;
  stage: ReactNode;
}

export function AppShell({ rail, sidebar, stage }: AppShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      <aside className="w-16 shrink-0 border-r border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-col items-center py-4">
        {rail}
      </aside>
      <aside className="w-[280px] shrink-0 border-r border-[var(--border-hairline)] bg-[var(--bg-surface)]/80 flex flex-col">
        {sidebar}
      </aside>
      <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-canvas)]">
        {stage}
      </main>
    </div>
  );
}
