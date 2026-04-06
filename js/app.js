// PixelCam — main app: camera, processing loop, UI

import { PixelProcessor } from './pixel-processor.js';
import { PALETTE_NAMES } from './palettes.js';
import { Recorder, TimeLapseRecorder, capturePhoto, saveToDevice, shareFile } from './recorder.js';

const state = {
  stream: null,
  facingMode: 'environment',
  paletteIdx: 0,
  gridSize: 96,
  dithering: 'ordered',
  aspectRatio: '9:16',
  crtEffect: false,
  isRunning: false,
  lastFrameTime: 0,
  targetFps: 30,
  mode: 'photo', // 'photo' | 'video' | 'timelapse'
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
const timerDisplay = document.getElementById('timer-display');
const startScreen = document.getElementById('start-screen');
const mainScreen = document.getElementById('main-screen');
const errorScreen = document.getElementById('error-screen');
const errorMsg = document.getElementById('error-msg');
const previewScreen = document.getElementById('preview-screen');
const previewMedia = document.getElementById('preview-media');
const crtOverlay = document.getElementById('crt-overlay');
const captureBtn = document.getElementById('btn-capture');

const recorder = new Recorder(displayCanvas);
const tlRecorder = new TimeLapseRecorder(displayCanvas);

// --- Camera ---

async function startCamera() {
  try {
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
    }
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: state.facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = state.stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    return true;
  } catch (e) {
    console.error('Camera error:', e);
    let msg = 'Could not access camera.';
    if (e.name === 'NotAllowedError') msg = 'Camera permission denied. Please allow camera access in browser settings.';
    else if (e.name === 'NotFoundError') msg = 'No camera found.';
    else if (e.name === 'NotReadableError') msg = 'Camera is in use by another app.';
    showError(msg);
    return false;
  }
}

async function flipCamera() {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
}

// --- Processing loop ---

function computeCanvasSize() {
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
  const scale = Math.max(4, Math.floor(720 / Math.max(w, h)));
  displayCanvas.width = w * scale;
  displayCanvas.height = h * scale;
  displayCtx.imageSmoothingEnabled = false;
}

function processFrame(timestamp) {
  if (!state.isRunning) return;
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

    const videoRatio = vw / vh;
    const canvasRatio = cw / ch;
    let sx, sy, sw, sh;
    if (videoRatio > canvasRatio) {
      sh = vh; sw = vh * canvasRatio;
      sx = (vw - sw) / 2; sy = 0;
    } else {
      sw = vw; sh = vw / canvasRatio;
      sx = 0; sy = (vh - sh) / 2;
    }

    workCtx.save();
    if (state.facingMode === 'user') {
      workCtx.translate(cw, 0);
      workCtx.scale(-1, 1);
    }
    workCtx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
    workCtx.restore();

    const imageData = workCtx.getImageData(0, 0, cw, ch);
    processor.process(imageData);
    workCtx.putImageData(imageData, 0, 0);

    displayCtx.imageSmoothingEnabled = false;
    displayCtx.drawImage(workCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
    drawWatermark();
  }

  requestAnimationFrame(processFrame);
}

function drawWatermark() {
  const w = displayCanvas.width;
  const h = displayCanvas.height;
  const fontSize = Math.max(10, Math.floor(h / 45));
  displayCtx.save();
  displayCtx.font = `${fontSize}px "Press Start 2P", monospace`;
  displayCtx.fillStyle = 'rgba(255,255,255,0.5)';
  displayCtx.strokeStyle = 'rgba(0,0,0,0.6)';
  displayCtx.lineWidth = 2;
  const text = 'PixelCam';
  const x = w - displayCtx.measureText(text).width - 8;
  const y = h - 8;
  displayCtx.strokeText(text, x, y);
  displayCtx.fillText(text, x, y);
  displayCtx.restore();
}

// --- UI updates ---

function updatePaletteLabel() {
  paletteLabel.textContent = PALETTE_NAMES[state.paletteIdx];
}

function updateSizeLabel() {
  sizeLabel.textContent = `${state.gridSize}PX`;
}

function changePalette(dir) {
  state.paletteIdx = (state.paletteIdx + dir + PALETTE_NAMES.length) % PALETTE_NAMES.length;
  processor.setPalette(PALETTE_NAMES[state.paletteIdx]);
  updatePaletteLabel();
}

function cycleResolution() {
  const sizes = [32, 48, 64, 96, 128, 160];
  let idx = sizes.indexOf(state.gridSize);
  if (idx === -1) idx = 2;
  idx = (idx + 1) % sizes.length;
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
  document.getElementById('aspect-btn-label').textContent = state.aspectRatio;
}

function toggleCRT() {
  state.crtEffect = !state.crtEffect;
  crtOverlay.classList.toggle('active', state.crtEffect);
  document.getElementById('btn-fx').classList.toggle('active', state.crtEffect);
  document.getElementById('fx-label').textContent = state.crtEffect ? 'ON' : 'CRT';
}

function toggleDithering() {
  state.dithering = state.dithering === 'ordered' ? 'none' : 'ordered';
  processor.setDithering(state.dithering);
  document.getElementById('btn-dither').classList.toggle('active', state.dithering === 'ordered');
  document.getElementById('dither-label').textContent = state.dithering === 'ordered' ? 'ON' : 'OFF';
}

// --- Mode switching ---

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  // Update capture button style
  captureBtn.className = 'capture-btn';
  if (mode === 'video') captureBtn.classList.add('mode-video');
  if (mode === 'timelapse') captureBtn.classList.add('mode-timelapse');
}

// --- Timer display ---

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function showTimer(ms) {
  timerDisplay.textContent = formatTime(ms);
  timerDisplay.classList.add('active');
}

function hideTimer() {
  timerDisplay.classList.remove('active');
  timerDisplay.textContent = '';
}

// --- Capture actions ---

function flashEffect() {
  const flash = document.getElementById('flash');
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 200);
}

async function handleCapture() {
  switch (state.mode) {
    case 'photo': return takePhoto();
    case 'video': return toggleVideoRecording();
    case 'timelapse': return toggleTimeLapse();
  }
}

async function takePhoto() {
  flashEffect();
  const blob = await capturePhoto(displayCanvas);
  const ts = formatTimestamp();
  showPreview(blob, `pixelcam_${ts}.png`, 'image');
}

function toggleVideoRecording() {
  if (recorder.isRecording) {
    recorder.stop();
    recIndicator.classList.remove('active');
    hideTimer();
    captureBtn.classList.remove('recording');
  } else {
    if (!recorder.isSupported()) {
      alert('Video recording is not supported on this browser.');
      return;
    }
    recorder.onTick = (ms) => showTimer(ms);
    recorder.onStop = (blob, ext) => {
      hideTimer();
      captureBtn.classList.remove('recording');
      if (blob && blob.size > 0) {
        const ts = formatTimestamp();
        showPreview(blob, `pixelcam_${ts}.${ext}`, 'video');
      }
    };
    if (recorder.start()) {
      recIndicator.classList.add('active');
      captureBtn.classList.add('recording');
    }
  }
}

function toggleTimeLapse() {
  if (tlRecorder.isRecording) {
    tlRecorder.stop();
    recIndicator.classList.remove('active');
    hideTimer();
    captureBtn.classList.remove('recording');
  } else {
    tlRecorder.onTick = (ms) => showTimer(ms);
    tlRecorder.onStop = (blob, ext) => {
      hideTimer();
      captureBtn.classList.remove('recording');
      recIndicator.classList.remove('active');
      if (blob && blob.size > 0) {
        const ts = formatTimestamp();
        showPreview(blob, `pixelcam_tl_${ts}.${ext}`, 'video');
      } else if (!blob) {
        alert('TimeLapse requires at least 2 frames. Record for longer.');
      }
    };
    if (tlRecorder.start()) {
      recIndicator.classList.add('active');
      captureBtn.classList.add('recording');
    }
  }
}

function formatTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}_${d.getHours().toString().padStart(2,'0')}${d.getMinutes().toString().padStart(2,'0')}${d.getSeconds().toString().padStart(2,'0')}`;
}

// --- Preview ---

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
    vid.setAttribute('playsinline', 'true');
    vid.muted = true;
    previewMedia.appendChild(vid);
  }
  previewScreen.classList.remove('hidden');
}

function closePreview() {
  previewScreen.classList.add('hidden');
  previewMedia.innerHTML = '';
  _previewBlob = null;
}

function handleSave() {
  if (!_previewBlob) return;
  // Show OS selection menu
  document.getElementById('save-menu').classList.remove('hidden');
}

async function handleSaveMethod(method) {
  document.getElementById('save-menu').classList.add('hidden');
  if (!_previewBlob) return;
  switch (method) {
    case 'share':
      // iOS: Web Share API → "Save Video" / "Save Image" in share sheet
      await shareFile(_previewBlob, _previewFilename);
      break;
    case 'download':
      // Android: <a download> saves to Downloads → appears in Gallery
      await saveToDevice(_previewBlob, _previewFilename);
      break;
    case 'pc':
      // PC: Direct download to Downloads folder
      await saveToDevice(_previewBlob, _previewFilename);
      break;
  }
}

function closeSaveMenu() {
  document.getElementById('save-menu').classList.add('hidden');
}

async function handleShare() {
  if (!_previewBlob) return;
  await shareFile(_previewBlob, _previewFilename);
}

// --- Error ---

function showError(msg) {
  errorMsg.textContent = msg;
  errorScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
  startScreen.classList.add('hidden');
}

// --- Init ---

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
  // Start
  document.getElementById('start-btn').addEventListener('click', handleStart);

  // Camera flip
  document.getElementById('btn-flip').addEventListener('click', flipCamera);

  // Palette
  document.getElementById('pal-left').addEventListener('click', () => changePalette(-1));
  document.getElementById('pal-right').addEventListener('click', () => changePalette(1));

  // Settings
  document.getElementById('btn-res').addEventListener('click', cycleResolution);
  document.getElementById('btn-aspect').addEventListener('click', cycleAspect);
  document.getElementById('btn-fx').addEventListener('click', toggleCRT);
  document.getElementById('btn-dither').addEventListener('click', toggleDithering);

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Capture button
  captureBtn.addEventListener('click', handleCapture);

  // Preview
  document.getElementById('preview-close').addEventListener('click', closePreview);
  document.getElementById('preview-save').addEventListener('click', handleSave);
  document.getElementById('preview-share').addEventListener('click', handleShare);

  // Save menu options
  document.querySelectorAll('.save-option').forEach(btn => {
    btn.addEventListener('click', () => handleSaveMethod(btn.dataset.method));
  });
  document.getElementById('save-menu-close').addEventListener('click', closeSaveMenu);

  // Swipe palette on camera view
  let touchStartX = 0;
  const cameraView = document.getElementById('camera-view');
  cameraView.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  cameraView.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) changePalette(dx > 0 ? -1 : 1);
  }, { passive: true });

  // Keyboard (desktop)
  document.addEventListener('keydown', (e) => {
    if (!previewScreen.classList.contains('hidden')) return;
    switch (e.key) {
      case 'ArrowLeft': changePalette(-1); break;
      case 'ArrowRight': changePalette(1); break;
      case ' ': e.preventDefault(); handleCapture(); break;
      case 'f': case 'F': flipCamera(); break;
    }
  });

  // Visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!video.paused) video.pause();
    } else {
      if (state.isRunning) video.play().catch(() => {});
    }
  });
}

bindControls();

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.log('SW reg failed:', e));
  });
}
