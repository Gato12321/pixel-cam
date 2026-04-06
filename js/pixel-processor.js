// PixelProcessor: real-time pixel art conversion
// Optimized for mobile: pre-computed LUT for palette lookup

import { PALETTES, BAYER_8x8 } from './palettes.js';

export class PixelProcessor {
  constructor() {
    this.palette = PALETTES["Game Boy"];
    this.paletteName = "Game Boy";
    this.dithering = "ordered"; // "none" | "ordered"
    this.gridSize = 96; // target width in pixels for downscale
    this.lut = null; // 32³ lookup table (8192 bytes) → palette index
    this._buildLUT();
  }

  setPalette(name) {
    this.paletteName = name;
    if (name === 'Original') {
      this.palette = null;
      this.lut = null;
      return;
    }
    if (!PALETTES[name]) return;
    this.palette = PALETTES[name];
    this._buildLUT();
  }

  setGridSize(size) {
    this.gridSize = Math.max(24, Math.min(192, size));
  }

  setDithering(mode) {
    this.dithering = mode;
  }

  // Pre-compute nearest palette index for every 32×32×32 RGB bucket
  // This avoids per-pixel Euclidean distance during real-time processing
  _buildLUT() {
    const lut = new Uint8Array(32 * 32 * 32);
    const pal = this.palette;
    for (let r = 0; r < 32; r++) {
      for (let g = 0; g < 32; g++) {
        for (let b = 0; b < 32; b++) {
          // Center of bucket (0-255 range)
          const R = (r << 3) | 4;
          const G = (g << 3) | 4;
          const B = (b << 3) | 4;
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < pal.length; i++) {
            const dr = R - pal[i][0];
            const dg = G - pal[i][1];
            const db = B - pal[i][2];
            const dist = dr*dr + dg*dg + db*db;
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = i;
            }
          }
          lut[(r << 10) | (g << 5) | b] = bestIdx;
        }
      }
    }
    this.lut = lut;
  }

  // Process ImageData in-place: pixelate using current palette
  process(imageData) {
    // Original mode: no color mapping, just pass through (pixelation is done by canvas downscale)
    if (!this.palette || !this.lut) return imageData;

    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const lut = this.lut;
    const pal = this.palette;

    if (this.dithering === "ordered") {
      // Ordered dithering: add Bayer offset before palette lookup
      for (let y = 0; y < h; y++) {
        const bayerRow = BAYER_8x8[y & 7];
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const threshold = (bayerRow[x & 7] - 0.5) * 32; // ±16 perturbation
          // Clamp and quantize to 5-bit
          const r = Math.max(0, Math.min(255, data[i] + threshold)) >> 3;
          const g = Math.max(0, Math.min(255, data[i+1] + threshold)) >> 3;
          const b = Math.max(0, Math.min(255, data[i+2] + threshold)) >> 3;
          const idx = lut[(r << 10) | (g << 5) | b];
          const c = pal[idx];
          data[i]   = c[0];
          data[i+1] = c[1];
          data[i+2] = c[2];
        }
      }
    } else {
      // Direct nearest-color mapping
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i] >> 3;
          const g = data[i+1] >> 3;
          const b = data[i+2] >> 3;
          const idx = lut[(r << 10) | (g << 5) | b];
          const c = pal[idx];
          data[i]   = c[0];
          data[i+1] = c[1];
          data[i+2] = c[2];
        }
      }
    }
    return imageData;
  }
}
