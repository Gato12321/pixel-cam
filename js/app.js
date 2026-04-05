// PixelCam main app — camera init, processing loop, UI bindings

import { PixelProcessor } from './pixel-processor.js';
import { PALETTE_NAMES } from './palettes.js';
import { Recorder, capturePhoto, shareOrDownload } from './recorder.js';

const state = {
  stream: null,
  facingMode: 'environment',
  paletteIdx: 0,
  gridSize: 96,
  dithering: 'ordered',
  aspectRatio: '9:16', // '9:16' | '1:1' | '4:3' | '16:9'
  crtEffect: false,
  isRunning: false,
  lastFrameTime: 0,
  targetFps: 30,
};

const processor = new PixelProcessor();

// DOM refs
const video = document.getElementById('video');
const displayCanvas = document.getElementById('display');
const workCanvas = document.createElement('canvas');
const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
const displayCtx = displayCanvas.getContext('2d');
displayCtx.imageSmoothingEnabled = false;

const paletteLabel = document.getElementById('palette-label');
const sizeLabel = document.getElementById('size-label');
const recIndicator = document.getElementById('rec-indicator');
const startScreen = document.getElementById('start-screen');
const mainScreen = document.getElementById('main-screen');
const errorScreen = document.getElementById('error-screen');
const errorMsg = document.getElementById('error-msg');
const previewScreen = document.getElementById('preview-screen');
const previewMedia = document.getElementById('preview-media');
const fxIndicator = document.getElementById('fx-indicator');
const crtOverlay = document.getElementById('crt-overlay');

const recorder = new Recorder(displayCanvas);

// --- Camera lifecycle ---------------------------------------

async function startCamera() {
  try {
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
    }
    const constraints = {
      video: {
        facingMode: state.facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = state.stream;
    // iOS Safari needs these explicitly
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    return true;
  } catch (e) {
    console.error('Camera error:', e);
    let msg = 'カメラにアクセスできませんでした。';
    if (e.name === 'NotAllowedError') msg = 'カメラ許可が拒否されました。ブラウザ設定から許可してください。';
    else if (e.name === 'NotFoundError') msg = 'カメラが見つかりません。';
    else if (e.name === 'NotReadableError') msg = 'カメラが他のアプリで使用中です。';
    showError(msg);
    return false;
  }
}

async function flipCamera() {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
}

// --- Processing loop ----------------------------------------

function computeCanvasSize() {
  // Keep display canvas matching target aspect ratio
  const ratios = { '9:16': 9/16, '1:1': 1, '4:3': 4/3, '16:9': 16/9 };
  const r = ratios[state.aspectRatio];
  const w = state.gridSize;
  const h = Math.round(w / r);
  return { w, h };
}

function sizeCanvases() {
  const { w, h } = computeCanvasSize();
  workCanvas.width = w;
  workCanvas.height = h;
  // Display canvas: upscale to a nice size for capture/display
  // Use power-of-2 multiplier for crisp pixels
  const scale = Math.max(4, Math.floor(720 / Math.max(w, h)));
  displayCanvas.width = w * scale;
  displayCanvas.height = h * scale;
  displayCtx.imageSmoothingEnabled = false;
}

function processFrame(timestamp) {
  if (!state.isRunning) return;

  // Throttle to target FPS
  const minFrameTime = 1000 / state.targetFps;
  if (timestamp - state.lastFrameTime < minFrameTime) {
    requestAnimationFrame(processFrame);
    return;
  }
  state.lastFrameTime = timestamp;

  if (video.readyState >= 2 && video.videoWidth > 0) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = workCanvas.width;
    const ch = workCanvas.height;

    // Cover-fit the video into the work canvas (center crop)
    const videoRatio = vw / vh;
    const canvasRatio = cw / ch;
    let sx, sy, sw, sh;
    if (videoRatio > canvasRatio) {
      // Video is wider: crop horizontally
      sh = vh;
      sw = vh * canvasRatio;
      sx = (vw - sw) / 2;
      sy = 0;
    } else {
      // Video is taller: crop vertically
      sw = vw;
      sh = vw / canvasRatio;
      sx = 0;
      sy = (vh - sh) / 2;
    }

    // Mirror front camera for selfie mode
    workCtx.save();
    if (state.facingMode === 'user') {
      workCtx.translate(cw, 0);
      workCtx.scale(-1, 1);
    }
    workCtx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
    workCtx.restore();

    // Apply pixelation
    const imageData = workCtx.getImageData(0, 0, cw, ch);
    processor.process(imageData);
    workCtx.putImageData(imageData, 0, 0);

    // Upscale to display canvas (nearest-neighbor)
    displayCtx.imageSmoothingEnabled = false;
    displayCtx.drawImage(workCanvas, 0, 0, displayCanvas.width, displayCanvas.height);

    // Draw watermark
    drawWatermark();
  }

  requestAnimationFrame(processFrame);
}

function drawWatermark() {
  const w = displayCanvas.width;
  const h = displayCanvas.height;
  const fontSize = Math.max(12, Math.floor(h / 40));
  displayCtx.save();
  displayCtx.font = `${fontSize}px "Press Start 2P", monospace`;
  displayCtx.fillStyle = 'rgba(255,255,255,0.7)';
  displayCtx.strokeStyle = 'rgba(0,0,0,0.8)';
  displayCtx.lineWidth = 3;
  const text = '\u2605 PixelCam';
  const x = w - displayCtx.measureText(text).width - 10;
  const y = h - 10;
  displayCtx.strokeText(text, x, y);
  displayCtx.fillText(text, x, y);
  displayCtx.restore();
}

// --- UI updates ---------------------------------------------

function updatePaletteLabel() {
  const name = PALETTE_NAMES[state.paletteIdx];
  paletteLabel.textContent = name;
}

function updateSizeLabel() {
  sizeLabel.textContent = `${state.gridSize}PX`;
}

function changePalette(dir) {
  state.paletteIdx = (state.paletteIdx + dir + PALETTE_NAMES.length) % PALETTE_NAMES.length;
  processor.setPalette(PALETTE_NAMES[state.paletteIdx]);
  updatePaletteLabel();
}

function changeSize(dir) {
  const sizes = [48, 64, 96, 128, 160];
  let idx = sizes.indexOf(state.gridSize);
  if (idx === -1) idx = 2;
  idx = Math.max(0, Math.min(sizes.length - 1, idx + dir));
  state.gridSize = sizes[idx];
  sizeCanvases();
  updateSizeLabel();
}

function cycleAspect() {
  const list = ['9:16', '1:1', '4:3', '16:9'];
  const idx = list.indexOf(state.aspectRatio);
  state.aspectRatio = list[(idx + 1) % list.length];
  sizeCanvases();
  document.getElementById('aspect-label').textContent = state.aspectRatio;
}

function toggleCRT() {
  state.crtEffect = !state.crtEffect;
  crtOverlay.classList.toggle('active', state.crtEffect);
  fxIndicator.textContent = state.crtEffect ? 'CRT' : '---';
}

// --- Capture & Record ---------------------------------------

async function takePhoto() {
  flashEffect();
  const blob = await capturePhoto(displayCanvas);
  const ts = Date.now();
  const filename = `pixelcam_${ts}.png`;
  showPreview(blob, filename, 'image');
}

function toggleRecording() {
  if (recorder.isRecording) {
    recorder.stop();
    recIndicator.classList.remove('active');
  } else {
    if (!recorder.isSupported()) {
      alert('録画はこのブラウザでサポートされていません。');
      return;
    }
    recorder.onStop = (blob, url, ext) => {
      const ts = Date.now();
      const filename = `pixelcam_${ts}.${ext}`;
      showPreview(blob, filename, 'video');
    };
    if (recorder.start()) {
      recIndicator.classList.add('active');
    }
  }
}

function flashEffect() {
  const flash = document.getElementById('flash');
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 200);
}

// --- Preview screen -----------------------------------------

let _previewBlob = null;
let _previewFilename = null;

function showPreview(blob, filename, type) {
  _previewBlob = blob;
  _previewFilename = filename;
  const url = URL.createObjectURL(blob);
  previewMedia.innerHTML = '';
  if (type === 'image') {
    const img = document.createElement('img');
    img.src = url;
    previewMedia.appendChild(img);
  } else {
    const vid = document.createElement('video');
    vid.src = url;
    vid.controls = true;
    vid.autoplay = true;
    vid.loop = true;
    vid.playsInline = true;
    previewMedia.appendChild(vid);
  }
  previewScreen.classList.remove('hidden');
}

function closePreview() {
  previewScreen.classList.add('hidden');
  previewMedia.innerHTML = '';
  _previewBlob = null;
}

async function sharePreview() {
  if (!_previewBlob) return;
  await shareOrDownload(_previewBlob, _previewFilename);
}

// --- Error handling ------------------------------------------

function showError(msg) {
  errorMsg.textContent = msg;
  errorScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
  startScreen.classList.add('hidden');
}

// --- Init ----------------------------------------------------

async function handleStart() {
  startScreen.classList.add('hidden');
  sizeCanvases();
  updatePaletteLabel();
  updateSizeLabel();
  const ok = await startCamera();
  if (!ok) return;
  mainScreen.classList.remove('hidden');
  state.isRunning = true;
  requestAnimationFrame(processFrame);
}

function bindControls() {
  document.getElementById('start-btn').addEventListener('click', handleStart);
  document.getElementById('btn-a').addEventListener('click', takePhoto);
  document.getElementById('btn-b').addEventListener('click', toggleRecording);
  document.getElementById('dpad-left').addEventListener('click', () => changePalette(-1));
  document.getElementById('dpad-right').addEventListener('click', () => changePalette(1));
  document.getElementById('dpad-up').addEventListener('click', () => changeSize(1));
  document.getElementById('dpad-down').addEventListener('click', () => changeSize(-1));
  document.getElementById('btn-select').addEventListener('click', cycleAspect);
  document.getElementById('btn-start').addEventListener('click', flipCamera);
  document.getElementById('btn-fx').addEventListener('click', toggleCRT);

  // Preview screen
  document.getElementById('preview-close').addEventListener('click', closePreview);
  document.getElementById('preview-share').addEventListener('click', sharePreview);

  // Swipe palette on display area
  let touchStartX = 0;
  const cameraView = document.getElementById('camera-view');
  cameraView.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  cameraView.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
      changePalette(dx > 0 ? -1 : 1);
    }
  }, { passive: true });

  // Keyboard for desktop testing
  document.addEventListener('keydown', (e) => {
    if (previewScreen.classList.contains('hidden') === false) return;
    switch (e.key) {
      case 'ArrowLeft': changePalette(-1); break;
      case 'ArrowRight': changePalette(1); break;
      case 'ArrowUp': changeSize(1); break;
      case 'ArrowDown': changeSize(-1); break;
      case ' ': e.preventDefault(); takePhoto(); break;
      case 'r': case 'R': toggleRecording(); break;
      case 'f': case 'F': toggleCRT(); break;
      case 'a': case 'A': cycleAspect(); break;
    }
  });

  // Handle visibility change (pause when tab hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (video.paused === false) video.pause();
    } else {
      if (state.isRunning) video.play().catch(() => {});
    }
  });
}

bindControls();

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.log('SW reg failed:', e));
  });
}
