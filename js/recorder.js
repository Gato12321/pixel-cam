// Recorder: captures display canvas, with iOS/Android codec negotiation

// Pick the best available codec — iOS Safari requires MP4/H.264
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E', // iOS Safari 14.1+
    'video/mp4',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

export class Recorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.mediaRecorder = null;
    this.chunks = [];
    this.mimeType = pickMimeType();
    this.isRecording = false;
    this.maxDurationMs = 60000; // 60s max for SNS
    this._timer = null;
    this.onStop = null; // callback(blob, url, extension)
  }

  isSupported() {
    return !!this.mimeType && typeof this.canvas.captureStream === 'function';
  }

  getExtension() {
    if (!this.mimeType) return 'webm';
    return this.mimeType.includes('mp4') ? 'mp4' : 'webm';
  }

  start() {
    if (this.isRecording || !this.isSupported()) return false;
    this.chunks = [];
    const stream = this.canvas.captureStream(30);
    try {
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: this.mimeType,
        videoBitsPerSecond: 4_000_000,
      });
    } catch (e) {
      console.error('MediaRecorder init failed:', e);
      return false;
    }
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType });
      const url = URL.createObjectURL(blob);
      this.isRecording = false;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (this.onStop) this.onStop(blob, url, this.getExtension());
    };
    this.mediaRecorder.start(100);
    this.isRecording = true;
    // Auto-stop at max duration
    this._timer = setTimeout(() => this.stop(), this.maxDurationMs);
    return true;
  }

  stop() {
    if (!this.isRecording || !this.mediaRecorder) return;
    try {
      this.mediaRecorder.stop();
    } catch (e) {
      console.error('Stop failed:', e);
    }
  }
}

// Capture a PNG photo from canvas
export function capturePhoto(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

// Try Web Share API, fall back to download
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'PixelCam',
        text: 'Made with ★ PixelCam',
      });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // Fall through to download
    }
  }
  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
