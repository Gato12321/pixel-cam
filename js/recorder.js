// Recorder: video capture, timelapse, photo — with iOS/Android codec negotiation

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E',
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
    this.maxDurationMs = 60000;
    this._timer = null;
    this._startTime = 0;
    this.onStop = null;
    this.onTick = null; // callback(elapsedMs)
    this._tickInterval = null;
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
      this.isRecording = false;
      this._clearTimers();
      if (this.onStop) this.onStop(blob, this.getExtension());
    };
    this.mediaRecorder.start(100);
    this.isRecording = true;
    this._startTime = Date.now();
    this._timer = setTimeout(() => this.stop(), this.maxDurationMs);
    this._tickInterval = setInterval(() => {
      if (this.onTick) this.onTick(Date.now() - this._startTime);
    }, 200);
    return true;
  }

  stop() {
    if (!this.isRecording || !this.mediaRecorder) return;
    try { this.mediaRecorder.stop(); } catch (e) {}
  }

  _clearTimers() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
  }
}

// TimeLapse recorder: captures frames at intervals, creates sped-up video
export class TimeLapseRecorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.frames = [];
    this.isRecording = false;
    this.intervalMs = 500; // capture every 500ms
    this.playbackFps = 15;  // playback at 15fps = 7.5x speed
    this.maxFrames = 600;   // 600 frames = 5min capture = 40s video
    this._timer = null;
    this._startTime = 0;
    this._tickInterval = null;
    this.onStop = null;
    this.onTick = null;
  }

  start() {
    if (this.isRecording) return false;
    this.frames = [];
    this.isRecording = true;
    this._startTime = Date.now();

    // Capture first frame
    this._captureFrame();

    // Set interval for subsequent frames
    this._timer = setInterval(() => {
      if (this.frames.length >= this.maxFrames) {
        this.stop();
        return;
      }
      this._captureFrame();
    }, this.intervalMs);

    this._tickInterval = setInterval(() => {
      if (this.onTick) this.onTick(Date.now() - this._startTime);
    }, 200);

    return true;
  }

  _captureFrame() {
    // Copy current canvas as ImageData
    const ctx = this.canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.frames.push(data);
  }

  async stop() {
    if (!this.isRecording) return;
    this.isRecording = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }

    if (this.frames.length < 2) {
      if (this.onStop) this.onStop(null, null);
      return;
    }

    // Encode frames to video using canvas + MediaRecorder
    const blob = await this._encodeToVideo();
    if (this.onStop) this.onStop(blob, blob ? 'webm' : null);
  }

  async _encodeToVideo() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');

    // Check MediaRecorder support
    const mimeType = pickMimeType();
    if (!mimeType) return null;

    const stream = offscreen.captureStream(0); // 0 = manual frame control
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        resolve(blob);
      };

      recorder.start();

      let frameIdx = 0;
      const frameDuration = 1000 / this.playbackFps;

      const drawNext = () => {
        if (frameIdx >= this.frames.length) {
          recorder.stop();
          return;
        }
        ctx.putImageData(this.frames[frameIdx], 0, 0);
        // Request a frame from the capture stream
        if (stream.getVideoTracks()[0].requestFrame) {
          stream.getVideoTracks()[0].requestFrame();
        }
        frameIdx++;
        setTimeout(drawNext, frameDuration);
      };

      drawNext();
    });
  }
}

// Capture a PNG photo from canvas
export function capturePhoto(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

// Save to device: uses multiple strategies for maximum compatibility
export async function saveToDevice(blob, filename) {
  // Strategy 1: Use <a download> — works on most Android browsers, desktop
  // For iOS Safari, this downloads as file; user can then save from Files
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Small delay to ensure download starts
  await new Promise(r => setTimeout(r, 500));
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'saved';
}

// Share via Web Share API (opens native share sheet → Save to Photos, etc.)
export async function shareFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'PixelCam',
        text: 'Made with PixelCam',
      });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  // Fallback to download if share not available
  return saveToDevice(blob, filename);
}
