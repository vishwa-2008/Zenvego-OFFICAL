// Real QR / barcode scanner using the device camera.
// Uses html5-qrcode library (zero-cost, works in browser & PWA).
import { Html5Qrcode } from 'html5-qrcode';

let scanner: Html5Qrcode | null = null;

export async function startScanner(
  containerId: string,
  onResult: (decodedText: string) => void,
  onError?: (err: string) => void
): Promise<void> {
  stopScanner();
  scanner = new Html5Qrcode(containerId);
  await scanner.start(
    { facingMode: 'environment' },
    {
      fps: 10,
      qrbox: { width: 250, height: 250 },
    },
    (decodedText) => {
      onResult(decodedText);
    },
    () => {
      // ignore per-frame errors
    }
  );
}

export async function stopScanner(): Promise<void> {
  if (scanner) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      // ignore
    }
    scanner = null;
  }
}

export function isScannerSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
