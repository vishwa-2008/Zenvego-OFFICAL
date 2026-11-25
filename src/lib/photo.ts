// Photo capture & file upload helper for identity verification.
// Returns a compressed base64 data URL suitable for IndexedDB storage.
export async function captureFromCamera(): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
  });
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();
    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 600;
      const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        stream.getTracks().forEach((t) => t.stop());
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      stream.getTracks().forEach((t) => t.stop());
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    video.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      reject(new Error('Camera error'));
    };
  });
}

export function readFileAsDataUrl(file: File, maxDim = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
