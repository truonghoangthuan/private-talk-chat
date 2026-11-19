import type { MediaAttachmentDto } from "../../lib/types";

interface MediaViewerProps {
  attachment: MediaAttachmentDto;
  isOwn?: boolean;
}

export function MediaViewer({ attachment, isOwn = false }: MediaViewerProps) {
  const isVideo = attachment.mime_type.startsWith("video/");

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
        <img
          src={attachment.media_url}
          alt={attachment.file_name}
          className="w-full max-h-72 object-cover"
          loading="lazy"
        />
      )}
      <div
        className={`px-2.5 py-1 text-xs flex items-center justify-between gap-2 ${
          isOwn ? "text-white/90" : "text-[var(--text-muted)]"
        }`}
      >
        <span className="truncate">{attachment.file_name}</span>
        <span className="shrink-0">{(attachment.size_bytes / 1024).toFixed(0)} KB</span>
      </div>
    </div>
  );
}
