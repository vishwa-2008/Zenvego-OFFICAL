import React, { useEffect, useState } from 'react';
import { ORIGINAL_LOGOS } from '../data/mockData';

type LogoVariant = 'emblem' | 'wordmark';

const processedLogoCache: Partial<Record<LogoVariant, string>> = {};
const processingPromises: Partial<Record<LogoVariant, Promise<string>>> = {};

/**
 * Loads the user's exact original uploaded logo JPEG and cleanly removes the warm
 * off-white paper background into pure alpha transparency via offscreen Canvas,
 * preserving every original logo pixel and crisp anti-aliased edge with zero
 * rectangular background box on any surface.
 */
function processOriginalLogo(variant: LogoVariant): Promise<string> {
  if (processedLogoCache[variant]) {
    return Promise.resolve(processedLogoCache[variant]!);
  }
  if (processingPromises[variant]) {
    return processingPromises[variant]!;
  }

  const src = ORIGINAL_LOGOS[variant];
  const promise = new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Sample average background paper color from the 4 corners
        const corners = [
          [2, 2],
          [w - 3, 2],
          [2, h - 3],
          [w - 3, h - 3],
        ];
        let bgR = 0;
        let bgG = 0;
        let bgB = 0;
        for (const [cx, cy] of corners) {
          const idx = (cy * w + cx) * 4;
          bgR += data[idx];
          bgG += data[idx + 1];
          bgB += data[idx + 2];
        }
        bgR /= corners.length;
        bgG /= corners.length;
        bgB /= corners.length;

        const colorDist = (r: number, g: number, b: number) => {
          const dr = r - bgR;
          const dg = g - bgG;
          const db = b - bgB;
          return Math.sqrt(dr * dr + dg * dg + db * db);
        };

        if (variant === 'wordmark') {
          // Wordmark has deep teal letters + vivid green leaves on uniform cream paper
          // with subtle bright white embossed highlight edges.
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC - minC;
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            const dist = colorDist(r, g, b);

            // Pure paper or bright paper highlight
            if ((dist < 24 && sat < 26) || (luma > 226 && sat < 22)) {
              data[i + 3] = 0;
            } else if (luma > 180 && sat < 42 && dist < 85) {
              // Smooth anti-aliased edge feathering + color decontamination
              const alphaNorm = Math.min(1, Math.max(0, (dist - 22) / 56));
              const a = Math.round(alphaNorm * 255);
              data[i + 3] = a;
              if (alphaNorm > 0.08) {
                data[i] = Math.min(255, Math.max(0, Math.round((r - (1 - alphaNorm) * bgR) / alphaNorm)));
                data[i + 1] = Math.min(255, Math.max(0, Math.round((g - (1 - alphaNorm) * bgG) / alphaNorm)));
                data[i + 2] = Math.min(255, Math.max(0, Math.round((b - (1 - alphaNorm) * bgB) / alphaNorm)));
              }
            }
          }
        } else {
          // Emblem: Flood-fill from outer border to remove exterior cream paper & open wifi spaces
          // while preserving interior crisp white contour strokes around leaves/tomato/carrot!
          const visited = new Uint8Array(w * h);
          const isBg = new Uint8Array(w * h);
          const queue = new Int32Array(w * h);
          let head = 0;
          let tail = 0;

          const isPaperPixel = (idx4: number) => {
            const r = data[idx4];
            const g = data[idx4 + 1];
            const b = data[idx4 + 2];
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC - minC;
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            const dist = colorDist(r, g, b);
            return (dist < 38 && sat < 28 && luma > 205) || (luma > 234 && sat < 18);
          };

          const enqueue = (x: number, y: number) => {
            const p = y * w + x;
            if (visited[p]) return;
            visited[p] = 1;
            if (isPaperPixel(p * 4)) {
              isBg[p] = 1;
              queue[tail++] = p;
            }
          };

          for (let x = 0; x < w; x++) {
            enqueue(x, 0);
            enqueue(x, h - 1);
          }
          for (let y = 0; y < h; y++) {
            enqueue(0, y);
            enqueue(w - 1, y);
          }

          while (head < tail) {
            const p = queue[head++];
            const x = p % w;
            const y = (p - x) / w;
            if (x > 0) enqueue(x - 1, y);
            if (x < w - 1) enqueue(x + 1, y);
            if (y > 0) enqueue(x, y - 1);
            if (y < h - 1) enqueue(x, y + 1);
          }

          // Clear flooded background pixels
          for (let p = 0; p < w * h; p++) {
            if (isBg[p]) {
              data[p * 4 + 3] = 0;
            }
          }

          // Feather 2px boundary fringe next to transparent pixels for ultra-smooth anti-aliasing
          for (let pass = 0; pass < 2; pass++) {
            const toFeather: number[] = [];
            for (let y = 1; y < h - 1; y++) {
              for (let x = 1; x < w - 1; x++) {
                const p = y * w + x;
                if (data[p * 4 + 3] === 0) continue;
                const touchesBg =
                  data[(p - 1) * 4 + 3] === 0 ||
                  data[(p + 1) * 4 + 3] === 0 ||
                  data[(p - w) * 4 + 3] === 0 ||
                  data[(p + w) * 4 + 3] === 0;
                if (touchesBg) {
                  toFeather.push(p);
                }
              }
            }
            for (const p of toFeather) {
              const i = p * 4;
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              const sat = Math.max(r, g, b) - Math.min(r, g, b);
              const dist = colorDist(r, g, b);
              if (dist < 62 && sat < 45) {
                const alphaNorm = Math.min(1, Math.max(0, (dist - 16) / 48));
                data[i + 3] = Math.round(alphaNorm * 255);
                if (alphaNorm > 0.12) {
                  data[i] = Math.min(255, Math.max(0, Math.round((r - (1 - alphaNorm) * bgR) / alphaNorm)));
                  data[i + 1] = Math.min(255, Math.max(0, Math.round((g - (1 - alphaNorm) * bgG) / alphaNorm)));
                  data[i + 2] = Math.min(255, Math.max(0, Math.round((b - (1 - alphaNorm) * bgB) / alphaNorm)));
                }
              }
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);

        // Trim transparent outer margins tightly so logos align crisply
        let minX = w;
        let minY = h;
        let maxX = 0;
        let maxY = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 18) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (maxX > minX && maxY > minY) {
          const pad = 2;
          const tx = Math.max(0, minX - pad);
          const ty = Math.max(0, minY - pad);
          const tw = Math.min(w - tx, maxX - minX + 1 + pad * 2);
          const th = Math.min(h - ty, maxY - minY + 1 + pad * 2);
          const trimmed = document.createElement('canvas');
          trimmed.width = tw;
          trimmed.height = th;
          const tctx = trimmed.getContext('2d');
          if (tctx) {
            tctx.drawImage(canvas, tx, ty, tw, th, 0, 0, tw, th);
            const result = trimmed.toDataURL('image/png');
            processedLogoCache[variant] = result;
            resolve(result);
            return;
          }
        }

        const result = canvas.toDataURL('image/png');
        processedLogoCache[variant] = result;
        resolve(result);
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });

  processingPromises[variant] = promise;
  return promise;
}

interface ZenvegoLogoProps {
  variant: LogoVariant;
  className?: string;
  alt?: string;
}

export const ZenvegoLogo: React.FC<ZenvegoLogoProps> = ({ variant, className = '', alt }) => {
  const [src, setSrc] = useState<string>(
    processedLogoCache[variant] ?? ORIGINAL_LOGOS[variant]
  );
  const [isTransparentReady, setIsTransparentReady] = useState<boolean>(
    Boolean(processedLogoCache[variant])
  );

  useEffect(() => {
    let active = true;
    processOriginalLogo(variant).then((url) => {
      if (active) {
        setSrc(url);
        setIsTransparentReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [variant]);

  const defaultAlt =
    variant === 'emblem'
      ? 'Zenvego Original Emblem'
      : 'Zenvego — Hyperlocal Fresh Produce Marketplace';

  return (
    <img
      src={src}
      alt={alt || defaultAlt}
      className={`object-contain select-none ${
        isTransparentReady ? '' : 'mix-blend-multiply brightness-[1.04] contrast-[1.04]'
      } ${className}`}
      draggable={false}
    />
  );
};

interface SmartImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackIcon?: string;
}

export const SmartImage: React.FC<SmartImageProps> = ({
  src,
  alt,
  className = '',
  fallbackIcon = 'eco',
}) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-surface-container to-surface-container-high text-primary/70 ${className}`}
        role="img"
        aria-label={alt}
      >
        <span className="material-symbols-outlined text-[26px]">{fallbackIcon}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
