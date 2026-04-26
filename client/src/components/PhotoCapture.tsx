import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, X } from 'lucide-react';

// Captures a photo from the device camera (rear camera on iPhone via
// capture="environment") and downscales it to a JPEG data URL around 200KB.
// Returns the data URL via onCapture so the parent can preview + submit.
//
// Why downscale on the phone: a raw iPhone photo is 4-6 MB. The kitchen has
// imperfect cell signal. Sending 200 KB instead of 5 MB is the difference
// between "save" working in 1 second vs 30 seconds.

interface Props {
  label: string;
  onCapture: (dataUrl: string) => void;
  value?: string | null;
  testIdPrefix?: string;
}

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.75;

async function downscale(file: File): Promise<string> {
  const img = await readAsImage(file);
  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function readAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

export function PhotoCapture({ label, onCapture, value, testIdPrefix = 'photo' }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const dataUrl = await downscale(file);
      onCapture(dataUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Photo failed');
    } finally {
      setBusy(false);
      // Reset so re-selecting the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
        data-testid={`${testIdPrefix}-input`}
      />
      {value ? (
        <div className="relative w-full max-w-sm">
          <img
            src={value}
            alt="Captured"
            className="w-full rounded-md border"
            data-testid={`${testIdPrefix}-preview`}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute top-2 right-2"
            onClick={() => onCapture('')}
            data-testid={`${testIdPrefix}-clear`}
          >
            <X className="w-4 h-4 mr-1" />
            Retake
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full max-w-sm h-16"
          data-testid={`${testIdPrefix}-button`}
        >
          <Camera className="w-5 h-5 mr-2" />
          {busy ? 'Processing...' : label}
        </Button>
      )}
      {err && <p className="text-sm text-destructive" data-testid={`${testIdPrefix}-error`}>{err}</p>}
    </div>
  );
}
