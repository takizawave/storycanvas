# READMEのデモメディア

- `storycanvas-preview.gif` — 9秒のループ。キャンバスでの比較、errorの切り替え、disabledの切り替え。
- `storycanvas-preview.png` — 同じ実画面の静止画。1920×1080。
- `storycanvas-demo.mp4` — 元のStorybookと拡張後を紹介する20秒の動画。1920×1080、30fps、音声なし。

2026-11-01にビルドしたstorycanvasと、以下の公開デモを撮影しています。

- [Chakra UI — Heading](https://chakra-ui.netlify.app/?path=/story/heading--default)
- [GOV.UK React — Form group](https://govuk-react.github.io/govuk-react/?path=/docs/form-group--docs)
- [Adobe Spectrum — Button](https://opensource.adobe.com/spectrum-web-components/storybook/?path=/story/button-black-fill--primary)

コンポーネントと各ライブラリのロゴは、それぞれのプロジェクトのものです。公開デモをローカルプロキシ経由で読み込み、一時的な拡張のコピーで同じタブの変更前後を収録しています。ブラウザ枠と起動時のポップアップ・ポインターは編集で合成し、読み込みの待ち時間を省いています。プロパティ変更は実際の操作の録画です。

## 更新する

依存関係のインストール後、`ffmpeg` と `ffprobe` がPATHにある状態で実行します。

```sh
npm run build
npm run dev
```

サーバーを起動したまま、別のターミナルで撮影・書き出しします。

```sh
npm run demo:record -- chakra govuk spectrum
node scripts/capture-demo-popup.mjs
npm run demo:render
npm run demo:preview
```

撮影にはインターネット接続とPlaywrightのChromiumが必要です。`artifacts/` の元録画はコミットせず、`docs/media/` の3つの完成ファイルだけを目視確認して更新します。
