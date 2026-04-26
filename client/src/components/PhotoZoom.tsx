import { X } from 'lucide-react';
import type { KitchenPhoto } from '@/store/types';

// Full-screen photo overlay. Tap anywhere outside the image (or the X button)
// to close. Used wherever Brenda needs to confirm "is this the right roll" by
// looking at the label photo.
export function PhotoZoom({ photo, onClose }: { photo: KitchenPhoto; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Roll photo"
      data-testid="photo-zoom"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-foreground"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={photo.data_url}
        alt={photo.caption ?? ''}
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={e => e.stopPropagation()}
      />
      {photo.caption && (
        <p className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-background/80 px-4 py-1 font-mono text-sm">
          {photo.caption}
        </p>
      )}
    </div>
  );
}
