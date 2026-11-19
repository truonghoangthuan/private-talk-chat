import type { MediaAttachmentDto } from "../../lib/types";

interface MediaViewerProps {
  attachment: MediaAttachmentDto;
}

export function MediaViewer({ attachment }: MediaViewerProps) {
  const isVideo = attachment.mime_type.startsWith("video/");

  return (
    <div className="mt-1.5 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-black/20 max-w-sm">
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
      <div className="px-2.5 py-1 text-[10px] text-[var(--text-muted)] flex items-center justify-between gap-2">
        <span className="truncate">{attachment.file_name}</span>
        <span>{(attachment.size_bytes / 1024).toFixed(0)} KB</span>
      </div>
    </div>
  );
}
