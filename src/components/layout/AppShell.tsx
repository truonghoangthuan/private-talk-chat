import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
} from "../../lib/ui-polish";

interface AppShellProps {
  rail: ReactNode;
  sidebar: ReactNode;
  stage: ReactNode;
}

/** Fixed width of the icon rail; the drag handle computes sidebar width relative to it. */
const RAIL_WIDTH_PX = 64;

export function AppShell({ rail, sidebar, stage }: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => loadSidebarWidth());
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(sidebarWidth);
  widthRef.current = sidebarWidth;

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      setSidebarWidth(clampSidebarWidth(e.clientX - RAIL_WIDTH_PX));
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      saveSidebarWidth(widthRef.current);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none ${
        isResizing ? "cursor-col-resize" : ""
      }`}
    >
      <aside className="w-16 shrink-0 border-r border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-col items-center py-4">
        {rail}
      </aside>
      <aside
        style={{ width: sidebarWidth }}
        className="shrink-0 border-r border-[var(--border-hairline)] bg-[var(--bg-surface)]/80 flex flex-col"
      >
        {sidebar}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize sidebar"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        className="w-1 shrink-0 cursor-col-resize hover:bg-[#6366F1]/40 active:bg-[#6366F1]/60 transition-colors"
      />
      <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-canvas)]">
        {stage}
      </main>
    </div>
  );
}
