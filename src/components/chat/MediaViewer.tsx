import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { MediaAttachmentDto } from "../../lib/types";
import { shouldOpenMediaLightbox } from "../../lib/ui-polish";

interface MediaViewerProps {
  attachment: MediaAttachmentDto;
  isOwn?: boolean;
}

export function MediaViewer({ attachment, isOwn = false }: MediaViewerProps) {
  const isVideo = attachment.mime_type.startsWith("video/");
  const isExpandable = shouldOpenMediaLightbox(attachment.mime_type);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  return (
    <div
      className={`mt-1.5 overflow-hidden rounded-xl border border-[var(--border-hairline)] max-w-sm ${
        isOwn ? "bg-black/20" : "bg-[var(--bg-surface)]/80"
      }`}
    >
      {isVideo ? (
        <video
          src={attachment.media_url}
          controls
          preload="metadata"
          className="w-full max-h-72 object-contain bg-black"
        />
      ) : (
        <button
          type="button"
          onClick={() => isExpandable && setLightboxOpen(true)}
          className={`block w-full ${isExpandable ? "cursor-zoom-in" : ""}`}
          title={isExpandable ? "Click to view full size" : undefined}
        >
          <img
            src={attachment.media_url}
            alt={attachment.file_name}
            className="w-full max-h-72 object-cover"
            loading="lazy"
          />
        </button>
      )}
      <div
        className={`px-2.5 py-1 text-xs flex items-center justify-between gap-2 ${
          isOwn ? "text-white/90" : "text-[var(--text-muted)]"
        }`}
      >
        <span className="truncate">{attachment.file_name}</span>
        <span className="shrink-0">{(attachment.size_bytes / 1024).toFixed(0)} KB</span>
      </div>

      {lightboxOpen && (
        <div
          className="animate-fade-in fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-6"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-black/40 text-white hover:bg-black/60 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={attachment.media_url}
            alt={attachment.file_name}
            onClick={(e) => e.stopPropagation()}
            className="animate-scale-in max-w-full max-h-full object-contain rounded-lg"
          />
        </div>
      )}
    </div>
  );
}
