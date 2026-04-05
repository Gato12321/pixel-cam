# PixelCam ★ Real-time Pixel Art Camera PWA

スマホカメラをリアルタイムでレトロピクセルアートに変換するPWA。11のレトロパレット、録画機能、ワンタップ共有を備えた、TikTok/Instagram/Twitter向けのSNSファーストツール。

## 特徴

- **リアルタイム30fps変換**: カメラ映像をその場でピクセルアート化
- **11のレトロパレット**: Game Boy / NES / PICO-8 / C64 / MSX / Neon / など
- **録画機能**: 最大60秒のショート動画、iOS/Android両対応
- **ワンタップ共有**: Web Share APIで各SNSに直接投稿
- **PWAインストール可能**: ホーム画面に追加してネイティブ風に使用
- **完全クライアントサイド**: 画像・動画は一切サーバーに送信されない
- **レトロゲーム風UI**: Game Boyコントローラー風の操作感

## 技術スタック

- Vanilla JavaScript (フレームワーク不使用)
- Canvas 2D API + WebRTC getUserMedia
- MediaRecorder API（iOS用MP4フォールバック付き）
- Service Worker による完全オフライン動作

## ファイル構成

```
pixel_cam/
├── index.html              # エントリー
├── css/style.css           # Game Boy風テーマ
├── js/
│   ├── app.js              # メインアプリ
│   ├── palettes.js         # 11パレット定義
│   ├── pixel-processor.js  # ピクセル化エンジン (LUTベース高速化)
│   └── recorder.js         # 録画・共有
├── sw.js                   # Service Worker
├── manifest.json           # PWAマニフェスト
└── assets/icons/           # PWAアイコン
```

## 起動方法

### ローカル開発

```bash
cd pixel_cam
python -m http.server 8765
```

ブラウザで `http://localhost:8765` を開く。

**iOS/Android実機テスト**: HTTPSが必要（`getUserMedia`要件）。ngrokやCloudflare Tunnelを使用:

```bash
ngrok http 8765
# https://xxx.ngrok.io を実機で開く
```

### 本番デプロイ

静的ファイルをHTTPSホスティング先へアップロード:
- Vercel / Netlify / Cloudflare Pages / GitHub Pages

## 操作

| コントロール | 動作 |
|---|---|
| A ボタン | 写真撮影 |
| B ボタン | 録画開始/停止 |
| ◀ ▶ (D-pad 左右) | パレット切替 |
| ▲ ▼ (D-pad 上下) | 解像度切替 (48-160px) |
| SELECT | アスペクト比切替 (9:16 / 1:1 / 4:3 / 16:9) |
| START | 前後カメラ切替 |
| FX | CRTスキャンラインON/OFF |
| カメラ画面スワイプ | パレット切替 |

**キーボード (デスクトップテスト用)**: 矢印キー / Space / R / F / A

## パフォーマンス

- 128x128ピクセル処理: **0.2-0.3ms/frame** (LUTベース)
- 実機想定: iPhone 12+/Pixel 6+で安定30fps
- 初回ロード: < 100KB (フォント除く)
- PWA完全オフライン動作

## SNS戦略

このアプリは以下の市場インサイトに基づいて設計されています:

1. **Ameniwaピクセル変換の成功** (3100万ビュー): ブラウザ完結 + レトロUI + 無料 = バイラル
2. **8Bit Photo Lab後継市場** (380万DL): カメラ型ピクセルアートの需要は継続
3. **TikTokのBefore/After動画**: 最高エンゲージメントフォーマット
4. **韓国発Mini Me Pixelトレンド**: 若年層の強い需要

**差別化ポイント**:
- 録画+共有まで1フローで完結 (競合は静止画のみ)
- カメラ型 (Ameniwaはアップロードのみ)
- モバイルPWA (競合はデスクトップWeb or 未対応)

## ライセンス・流用

`pixel_engine.py` のパレット定義・Bayerマトリクスを流用。元プロジェクトと同じ作者による継承。

## 今後のロードマップ

- MediaPipe Selfie Segmentation統合 (人物/背景分離変換)
- MediaPipe Face Detection (顔重点変換モード)
- Lospecカスタムパレットインポート
- GIFエクスポート（軽量版）
- ウォーターマーク有料除去版 (Pro)
