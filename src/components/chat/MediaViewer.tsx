import { useEffect, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import type { MediaAttachmentDto } from "../../lib/types";
import {
  MAX_LIGHTBOX_ZOOM,
  MIN_LIGHTBOX_ZOOM,
  shouldOpenMediaLightbox,
  stepLightboxZoom,
  toggleDoubleClickZoom,
  zoomFromWheelDelta,
} from "../../lib/ui-polish";

interface MediaViewerProps {
  attachment: MediaAttachmentDto;
  isOwn?: boolean;
}

export function MediaViewer({ attachment, isOwn = false }: MediaViewerProps) {
  const isVideo = attachment.mime_type.startsWith("video/");
  const isExpandable = shouldOpenMediaLightbox(attachment.mime_type);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(MIN_LIGHTBOX_ZOOM);

  // Always reopen the lightbox at the normal fit size (issue #117) rather
  // than remembering the zoom level from a previous viewing.
  useEffect(() => {
    if (!lightboxOpen) setZoom(MIN_LIGHTBOX_ZOOM);
  }, [lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
      else if (e.key === "+" || e.key === "=") setZoom((z) => stepLightboxZoom(z, 1));
      else if (e.key === "-" || e.key === "_") setZoom((z) => stepLightboxZoom(z, -1));
      else if (e.key === "0") setZoom(MIN_LIGHTBOX_ZOOM);
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
          onWheel={(e) => {
            e.preventDefault();
            setZoom((z) => zoomFromWheelDelta(z, e.deltaY));
          }}
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
            onDoubleClick={(e) => {
              e.stopPropagation();
              setZoom((z) => toggleDoubleClickZoom(z));
            }}
            style={{ transform: `scale(${zoom})` }}
            title="Double-click to zoom"
            className={`animate-scale-in max-w-full max-h-full object-contain rounded-lg transition-transform duration-150 ${
              zoom > MIN_LIGHTBOX_ZOOM ? "cursor-zoom-out" : "cursor-zoom-in"
            }`}
          />
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-lg bg-black/40 p-1 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setZoom((z) => stepLightboxZoom(z, -1))}
              disabled={zoom <= MIN_LIGHTBOX_ZOOM}
              className="p-1.5 rounded-md hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              title="Zoom out (-)"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(MIN_LIGHTBOX_ZOOM)}
              className="px-2 py-1 text-xs font-medium rounded-md hover:bg-white/15 transition-colors tabular-nums"
              title="Reset zoom (0)"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => stepLightboxZoom(z, 1))}
              disabled={zoom >= MAX_LIGHTBOX_ZOOM}
              className="p-1.5 rounded-md hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              title="Zoom in (+)"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
