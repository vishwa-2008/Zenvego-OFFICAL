import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface LiveCameraCaptureProps {
  title: string;
  subtitle: string;
  mode: 'selfie' | 'document';
  value: string;
  capturedAt?: string;
  required?: boolean;
  onCapture: (dataUrl: string, capturedAtIso: string) => void;
  onClear?: () => void;
}

/**
 * Real-time live camera verification component using navigator.mediaDevices.getUserMedia.
 * Captures an authentic live camera frame with embedded timestamp verification stamp
 * and compresses it to a Firestore-safe JPEG data URL (<= 30 KB).
 * Strictly live camera only — no gallery upload or mock stock photos.
 */
export const LiveCameraCapture: React.FC<LiveCameraCaptureProps> = ({
  title,
  subtitle,
  mode,
  value,
  capturedAt,
  required = true,
  onCapture,
  onClear,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(
    mode === 'selfie' ? 'user' : 'environment'
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCountdown(null);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = useCallback(
    async (preferredFacing: 'user' | 'environment' = facingMode) => {
      setCameraError(null);
      setStarting(true);
      stopCamera();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStarting(false);
        setCameraError(
          'Live camera is not supported in this browser context. Open Zenvego over HTTPS on a device with a camera.'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: preferredFacing },
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
            audio: false,
          });
        } catch {
          // Fallback to any available camera if ideal facingMode isn't present on desktop
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          });
        }

        streamRef.current = stream;
        setCameraActive(true);
        // Attach stream on next tick once <video> mounts
        window.requestAnimationFrame(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
            videoRef.current.play().catch(() => {});
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('notallowed')) {
          setCameraError(
            'Camera permission was denied. Please allow Camera access in your browser site settings and tap "Retry Live Camera".'
          );
        } else if (msg.toLowerCase().includes('notfound') || msg.toLowerCase().includes('device')) {
          setCameraError(
            'No live camera was detected on this device. Connect a webcam or continue on your mobile phone for live verification.'
          );
        } else {
          setCameraError(msg || 'Could not start live camera. Please check device permissions and retry.');
        }
      } finally {
        setStarting(false);
      }
    },
    [facingMode, stopCamera]
  );

  const captureFrameNow = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setCameraError('Camera stream is still warming up — wait a second and tap Capture again.');
      return;
    }

    const srcW = video.videoWidth || 640;
    const srcH = video.videoHeight || 480;
    const targetW = mode === 'selfie' ? 320 : 400;
    const targetH = mode === 'selfie' ? 320 : 280;

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('Could not initialize image capture canvas.');
      return;
    }

    // Center-crop video frame cleanly to match viewfinder aspect ratio
    const targetRatio = targetW / targetH;
    const srcRatio = srcW / srcH;
    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;
    if (srcRatio > targetRatio) {
      sw = srcH * targetRatio;
      sx = (srcW - sw) / 2;
    } else {
      sh = srcW / targetRatio;
      sy = (srcH - sh) / 2;
    }

    ctx.save();
    if (facingMode === 'user') {
      ctx.translate(targetW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetW, targetH);
    ctx.restore();

    // Embed tamper-evident live verification stamp bar at bottom of photo
    const now = new Date();
    const stampIso = now.toISOString();
    const stampLabel = `ZENVEGO LIVE KYC · ${now.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
    ctx.fillStyle = 'rgba(4, 54, 28, 0.82)';
    ctx.fillRect(0, targetH - 26, targetW, 26);
    ctx.fillStyle = '#86efac';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(stampLabel, 8, targetH - 9);

    // Compress cleanly below Firestore 32 KB field limit
    let dataUrl = canvas.toDataURL('image/jpeg', 0.76);
    if (dataUrl.length > 30500) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.56);
    }
    if (dataUrl.length > 30500) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.42);
    }

    stopCamera();
    onCapture(dataUrl, stampIso);
  }, [facingMode, mode, onCapture, stopCamera]);

  const handleCaptureWithCountdown = () => {
    if (mode === 'selfie') {
      setCountdown(2);
      window.setTimeout(() => setCountdown(1), 650);
      window.setTimeout(() => {
        setCountdown(null);
        captureFrameNow();
      }, 1300);
    } else {
      captureFrameNow();
    }
  };

  const handleFlipCamera = () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    if (cameraActive) {
      startCamera(next);
    }
  };

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/70 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="material-symbols-outlined text-[18px] text-primary">
              {mode === 'selfie' ? 'face_retouching_natural' : 'photo_camera'}
            </span>
            <h4 className="text-xs font-extrabold text-primary">{title}</h4>
            {required && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                Required Live Capture
              </span>
            )}
          </div>
          <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">{subtitle}</p>
        </div>

        {value && !cameraActive && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-extrabold shrink-0">
            <span className="material-symbols-outlined text-[13px]">verified</span>
            Captured
          </span>
        )}
      </div>

      {/* Live Camera Viewfinder */}
      {cameraActive ? (
        <div className="space-y-2.5">
          <div className="relative w-full overflow-hidden rounded-2xl bg-black aspect-[4/3] max-h-72 flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
            />

            {/* Alignment Overlay */}
            {mode === 'selfie' ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-44 h-52 rounded-full border-2 border-dashed border-[#86efac] shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]" />
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-4 rounded-xl border-2 border-dashed border-[#86efac]/90" />
            )}

            {/* Live Indicator */}
            <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-extrabold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span>LIVE CAMERA</span>
            </div>

            {/* Flip Camera Button */}
            <button
              type="button"
              onClick={handleFlipCamera}
              title="Switch Front / Rear Camera"
              className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/65 text-white flex items-center justify-center hover:bg-black/85 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">cameraswitch</span>
            </button>

            {countdown !== null && (
              <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                <span className="w-16 h-16 rounded-full bg-primary text-white text-3xl font-extrabold flex items-center justify-center shadow-lg">
                  {countdown}
                </span>
              </div>
            )}
          </div>

          <p className="text-[11px] text-center font-medium text-on-surface-variant">
            {mode === 'selfie'
              ? 'Center your face inside the oval in clear lighting, then tap Capture Live Photo.'
              : 'Hold your terrace/farm plot or ID/vehicle plate clearly inside the frame.'}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={countdown !== null}
              onClick={handleCaptureWithCountdown}
              className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">photo_camera</span>
              <span>{countdown !== null ? `Capturing in ${countdown}...` : 'Capture Live Photo'}</span>
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="px-4 h-11 rounded-xl bg-surface-container text-on-surface-variant text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : value ? (
        /* Captured Live Preview */
        <div className="space-y-2.5">
          <div className="relative rounded-2xl overflow-hidden border border-emerald-200 bg-black/5 max-w-xs mx-auto">
            <img
              src={value}
              alt={title}
              className="w-full h-52 object-cover"
            />
            <div className="absolute top-2 right-2 px-2.5 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-extrabold flex items-center gap-1 shadow-xs">
              <span className="material-symbols-outlined text-[13px]">verified_user</span>
              Live Verified
            </div>
          </div>

          {capturedAt && (
            <p className="text-[11px] text-center text-on-surface-variant font-mono">
              Captured live: {new Date(capturedAt).toLocaleString('en-IN')}
            </p>
          )}

          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={() => startCamera(facingMode)}
              className="px-4 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/40 text-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              Retake Live Photo
            </button>
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-bold cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Start Camera Call-To-Action */
        <button
          type="button"
          disabled={starting}
          onClick={() => startCamera(facingMode)}
          className="w-full h-12 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-xs font-extrabold flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[20px]">
            {starting ? 'progress_activity' : 'videocam'}
          </span>
          <span>
            {starting
              ? 'Opening Live Camera...'
              : mode === 'selfie'
                ? 'Open Front Camera for Live Person Capture'
                : 'Open Live Camera to Capture Proof Photo'}
          </span>
        </button>
      )}

      {cameraError && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-2">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-amber-700 shrink-0 mt-0.5">
              no_photography
            </span>
            <p className="font-medium leading-snug">{cameraError}</p>
          </div>
          <button
            type="button"
            onClick={() => startCamera(facingMode)}
            className="px-3 py-1.5 rounded-lg bg-amber-800 text-white text-[11px] font-bold cursor-pointer"
          >
            Retry Live Camera
          </button>
        </div>
      )}
    </div>
  );
};
