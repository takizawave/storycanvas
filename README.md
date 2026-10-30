# storycanvas

**MITライセンスで公開しているOSSです。** 不具合報告や改善提案、Pull Requestを歓迎します。Chrome ウェブストアにはまだ公開していません。ストア配布は知り合いとの限定テストから始める予定です。

[ライセンス](LICENSE) · [共同開発](CONTRIBUTING.md) · [データの扱い](PRIVACY.md) · [配布の手順](docs/RELEASE.md)

Storybookを、デザインツールのように見て操作できるChrome拡張です。**すべてのコンポーネントを見渡す無限キャンバス**と、**コンポーネントごとの詳細ページ**を行き来し、実物の比較、Properties編集、デザインのコピーができます。

[Chakra UI](https://chakra-ui.netlify.app/?path=/story/accordion--default)、[GOV.UK React](https://govuk-react.github.io/govuk-react/?path=/docs/form-group--docs)、[Adobe Spectrum](https://opensource.adobe.com/spectrum-web-components/storybook/?path=/story/button-black-fill--primary)で検証しています。表示はStorybookそのものから取得します。

## VariantsとProperties

- **Story / Canvas** で元のStorybookと一覧キャンバスを切り替えます。Story表示では右上に切替トグルだけが浮かび、Canvas表示ではヘッダーに戻ります。プレビューを再読み込みせず、キャンバスの位置・選択・Propertiesを保持します。ヘッダーと左右のパネルは `#2C2C2C` です。
- **日本語 / English** のトグルで操作UIを切り替えられます。表示言語はポップアップとヘッダーで共有・保存され、元のStory名やコンポーネントの内容はそのまま表示します。
- 「すべてのコンポーネント」には全Storyの実物と小さな名前を、カードなしで並べます。コンポーネント単位に、マスターアイコンと `#8A38F5` の角丸破線枠を添えます。ドラッグ・スクロールで移動し、⌘ / Ctrl＋スクロールでカーソル位置を基準にズームできます。右下に拡大・縮小・100%・全体表示があります。
- 左のコンポーネント名、または「すべて」の実物をダブルクリックすると、そのコンポーネントだけの詳細ページを開きます。詳細ページから一覧へ戻ると、一覧の表示位置と倍率を復元します。詳細ページもマスターアイコンと破線枠の内側に実物を並べ、ダブルクリックで操作用プレビューを拡大します。
- Heading・Badge・Buttonで1つのStoryに複数の独立した見本がある場合は、それぞれを余白付きで自動配置します。見本を個別に選択・コピーでき、元のStoryは維持します。複合コンポーネントの内部要素や、見本と判断できない構造は分割しません。名前は実物の上の小さな紫のラベルに表示します。
- Spectrumの `Button / Black / Fill` などをButtonファミリーとして認識し、右側のVariantsでStyle・Treatmentなどを切り替えられます。存在しない組み合わせは生成しません。
- 右側のPropertiesは、Storybookの実際のargsとargTypesから作成します。真偽値、選択肢、文字、数値、色を編集し、選択中のキャンバス・プレビュー・コピーへ反映します。リセット、選び直したときの変更保持にも対応します。
- ControlsベースのGOV.UK React／Adobe Spectrumにも対応します。右側のActionsには、選択中のライブプレビューが実際に発火したStorybookイベントを最新30件まで表示します。履歴をクリアしても元のStorybookやコンポーネントの状態は変えません。イベントを登録していないStoryには操作ログを作りません。
- Controlsを公開していないStoryでは、その旨を表示します。React要素・関数などは編集しません。GOV.UKのDocsページから開いた場合は、同じコンポーネントの実際のStoryを選択します。
- キャンバス背景はライト `#F5F5F5`、ダーク `#1E1E1E`。選択枠は青 `#0D99FF`、マスターの点線・アイコンは紫 `#8A38F5`。上部は小さな情報バー、左右はコンポーネント一覧とPropertiesのパネルです。
- 元のStorybookのヘッダー画像や独自faviconが取得できる場合、上部と左パネルのライブラリ名にロゴを添えます。SpectrumのAdobeロゴにも対応します。標準Storybookのfaviconはライブラリロゴとして使わず、画像が取得できない場合は名前と汎用アイコンを表示します。
- 大きなライブラリでは、画面に近いStoryを優先して読み込みます。描画済みの非選択StoryはHTMLと計算済みスタイルから作った画像に切り替え、ライブiframeをキャンバス8個＋右側1個までに制限します。枠線・内側の影・グラデーション・取得可能なWebフォントを保持し、選択すると実際のStoryを再表示します。動画やアニメーション、取得できない外部フォントなどは右側のライブプレビューで確認できます。

## 使いはじめる

### キャンバスの操作

画面下のツールバーから選択・手のひらツール、パネル表示、ズーム倍率を操作できます。`?` で日英対応のショートカット一覧を開けます。

| 操作 | ショートカット |
| --- | --- |
| 選択 / 手のひら | `V` / `H` |
| 一時的に移動 | `Space` + ドラッグ（中ボタンドラッグも可） |
| 次 / 前のフレームにズーム | `N` / `Shift+N`（`End` / `Home` でも可） |
| 全体 / 選択範囲を表示 | `Shift+1` / `Shift+2` |
| 100%で表示 | `Shift+0` / `⌘/Ctrl+0` |
| 拡大 / 縮小 | `+` / `-`、または `⌘/Ctrl` + スクロール |
| ポインター位置で拡大 / 縮小 | `Z` を押しながらクリック / `Alt+Z` を押しながらクリック |
| 囲んだ範囲にズーム | `Z` を押しながらドラッグ |
| 隣のコンポーネントを選択 | 矢印キー |
| キャンバスを移動 | 選択なしで矢印キー。`Shift` + 矢印キーで大きく移動 |
| 選択したプレビューを開く | `Enter` / `Shift+Space` |
| 選択をFigma用にコピー | `⌘/Ctrl+C` |
| 選択をPNGでコピー | `⌘/Ctrl+Shift+C` |
| 書き出し形式を選択 | `⌘/Ctrl+Shift+E` |
| コンポーネントを検索 | `⌘/Ctrl+K` / `⌘/Ctrl+F` |
| 左右パネルを表示・非表示 | `⌘/Ctrl+\`（`.` でも可） |
| ダイアログを閉じる・ツールを戻す・選択解除 | `Esc` |

`N` / `Shift+N` は現在の一覧・検索結果・お気に入り内を表示順に巡回し、末尾から先頭へ戻ります。同じStory内の独立した見本も順に選べます。

入力欄・日本語変換中・Story内の操作にはキャンバスのショートカットを割り当てません。Canvasの `Esc` ではライブラリを閉じず、右上の閉じるボタンで終了します。

### 拡張機能を開く

ソースから試す場合は、リポジトリを取得して `npm ci`、`npm run build` を実行し、Chromeの `chrome://extensions` でデベロッパーモードを有効にして `dist` フォルダを読み込みます。Node.js 20以降が必要です。

配布用の `storycanvas.zip` を受け取っている場合は、ビルドせずに次の手順で使えます。GitHubの「Download ZIP」はソース一式なので、先に上記のビルドが必要です。

1. `storycanvas.zip` を解凍します。
2. Chromeで `chrome://extensions` を開き、右上の **デベロッパーモード** をオンにします。
3. **パッケージ化されていない拡張機能を読み込む** から、解凍した **`storycanvas` フォルダ**を選びます。
4. Storybookを開き、storycanvasの拡張アイコンをクリックします。
5. **このStorybookを展開** を押します。

Chrome公式の[ローカル拡張の読み込み手順](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)も参照できます。Web Storeへの公開・ブラウザへの自動インストールはしていません。

## コピー形式

| 形式 | 使い方 |
| --- | --- |
| Figma用データ | 同梱Figmaプラグインに貼り付けると、テキスト・図形を編集できるネイティブのComponentを作成 |
| SVGを保存 | 保存した `.svg` をFigmaのキャンバスへドラッグして配置 |
| SVGコード | SVGのソースコードをクリップボードへコピー |
| PNG | 画像としてクリップボードへコピー。資料・ホワイトボードなどに貼り付け |
| HTML | 現在の表示と計算済みスタイルをコピー。React/JSXの元ソースではありません |
| Link | 元のStoryへのリンクをコピー |

### 編集できるFigma Componentとして取り込む

1. Figmaデスクトップの **Plugins → Development → Import plugin from manifest…** で `figma-plugin/manifest.json` を読み込みます。
2. 拡張のコピー形式で **Figma** を選び、コンポーネントをコピーします。
3. Figmaで **storycanvas Import** を実行し、データを貼り付けてインポートします。

ネイティブのComponentと編集可能なテキスト・図形を生成します。ブラウザで表示した一時点のデザインを取り込む方式で、Reactの動作、Auto Layout、Figma Variables、既存マスターとのリンクやVariant setの自動構築は含みません。SVGのみの場合はプラグイン不要です。

## 対応範囲

- `index.json` を持つ新しいStorybook、`stories.json` を持つ旧版、およびChakra UIのように実行時のClient APIを公開するStorybook 5。
- サブディレクトリで配信されるStorybook。
- ログイン済みStorybookは、開いているタブのセッションを利用します。
- Storybookとプレビューの配信元が同じであることが必要です。
- SVG / Figma / PNGはDOMの文字・図形から生成します。通常の背景、枠、文字、SVGアイコン、Spectrumなどのopen Shadow DOMとslotに対応します。CSSの高度なエフェクト、疑似要素、Canvas、動画、closed Shadow DOM、一部の画像・フォントには制限があります。エクスポート時の注意表示を確認してください。ピクセル完全一致のスクリーンショットではありません。
- Propertiesはライブラリ内の一時的な表示変更です。コードや元のStory定義への保存はしません。Linkは元StoryのURLで、変更したPropertiesは含みません。
- 元のStory自身にあるplay関数やマウント時の動作は、ライブプレビュー内でも動作します。

## 権限とデータ

Manifest V3。`activeTab`、`scripting`、`clipboardWrite`、表示言語の保存用の `storage` を使用します。拡張をクリックしたタブにだけコードを注入し、ホスト全体への常時アクセス権は要求しません。ライブラリを閉じると元のStorybookに戻ります。開発者のサーバーへのデータ送信や利用解析、APIキー、拡張独自のアカウント登録はありません。

表示のために、利用中のStorybookとその画像・フォントなどの配信元へ通信します。ログイン済みサイトではブラウザの既存セッションを使います。表示言語は拡張のローカルストレージ、お気に入りはそのStorybookのサイトストレージに保存します。コピーした内容はクリップボードや保存先へ渡ります。詳細は[データの扱い](PRIVACY.md)を参照してください。

## 開発

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run test:live
npm run test:runtime
npm run package
```

開発時は `npm run build` が生成した `dist` フォルダをChromeに読み込めます。

`npm run dev` は実物のStorybookをローカルにプロキシしてプレビューします。インターネット接続が必要です。このプロキシは開発専用で、Chrome拡張には含まれません。テスト用の固定データは `tests/fixtures` に分離しています。

ローカルプレビューの上部メニューからChakra UI／GOV.UK React／Adobe Spectrumを切り替えられます。配布拡張は、開いている実際のStorybookをその場で展開します。

- Chakra: `http://127.0.0.1:4173/?path=/story/badge--solid-badges`
- Spectrum: `http://127.0.0.1:4173/spectrum-web-components/storybook/?path=/story/button-black-fill--primary`
- GOV.UK: `http://127.0.0.1:4173/govuk-react/?path=/docs/form-group--docs`

開発サーバー起動中に `npm run test:properties` を実行すると、3サイトの表示、Properties変更とキャンバス同期、リセット、コピーを実ブラウザで検証します。
`npm run test:modern` はGOV.UK／Spectrumの切り替え、Controls編集、実Actions履歴を検証します。

`npm run package` で次のZIPを作成します。ZIP作成は現在macOSの `ditto` を使用します。

- `artifacts/storycanvas.zip` — 解凍してChromeに読み込む限定テスト用。
- `artifacts/storycanvas-chrome-store.zip` — `manifest.json` が直下にあるストア提出用。
- `artifacts/storycanvas-figma-plugin.zip` — 別途読み込むFigmaプラグイン。

ストア用ZIPには明示した実行ファイル、アイコン、MITライセンスを入れます。テスト用ホスト権限やバージョンの不一致を検出した場合は作成を停止します。ビルド・パッケージ作成だけでは外部公開しません。

### 20秒のデモ動画

動画と検証画像はGitHubには含めていません。以下は手元で再生成するための説明です。

`artifacts/demo/story-library-demo.mp4` は実際のUIを収録した20秒・1920×1080・30fpsの無音動画です。Chakra／GOV.UK／Adobeの各サイトで、元のStorybookと拡張後のライブラリ表示を交互に見せ、右パネルのPropertiesを実際にクリックして変更する様子を紹介します。元の画面には実サイトのキャプチャを使い、操作部分には実録画を使っています。読み込みの待ち時間は編集で省いています。

`npm run demo` で `http://127.0.0.1:4174` に動画プレイヤーを開けます。「操作する」では3つのライブラリを切り替えられます。操作デモには別途 `npm run dev` を起動してください。録画を更新する場合は `npm run demo:record`、続いて `npm run demo:render` を実行します。編集にはPATH上のffmpegとffprobeを利用します。

`npm run demo:record` は未収録のサイトから再開します。3サイトを撮り直す場合は `npm run demo:record -- chakra govuk spectrum` を実行してください。

### 検証

- Chakra UIで **54ファミリー / 157 Story** を取得（55タイトルのうちInputとInput/Variantsを1ファミリーに統合）。Headingの1 Storyを6見本、Badgeの4 Storyを19見本に展開して表示。
- Spectrumで **78ファミリー / 1086 Story**、Buttonは177 Story。GOV.UKで **58ファミリー / 196 Story**、Form groupは5 Story。
- Spectrumのdisabled・treatment変更、GOV.UKのerror変更による赤枠表示とリセットを確認。実際にインストールした拡張のservice worker経由でも、指定iframeだけが変わることを確認。
- 実サイト上のMV3拡張で、Spectrum Checkboxのclick/change、GOV.UK Radioフォームのsubmitを確認。元Storybookからのイベントが混ざらず、履歴のクリアも元コンポーネントに影響しないことを検証。
- 同じ実データからFigma用データとPNGのクリップボードコピー、SVG出力を確認。
- 一覧取得、runtime bridge、Figmaインポーター、配置とカメラ操作の単体テスト、拡張の操作に関する16項目のブラウザチェックを実施。無限キャンバス、スナップショットの切り抜き、SVG/HTML/PNGとShadow DOMもブラウザで検証。
- 製品のManifest V3が読み込まれることを確認。自動操作ではツールバーのユーザークリックによるactiveTab許可を付与できないため、実行時テストだけは一時コピーにlocalhostまたは対象サイトだけの権限を追加しています。配布版の権限は変えていません。
- FigmaインポーターはPlugin APIのテスト環境で検証済み。**Figmaアプリ内での実インポートは未検証**です。

検証画像は `artifacts/heading-examples.png`、`artifacts/badge-examples.png`、`artifacts/breadcrumb-metadata.png`、`artifacts/spectrum-properties.png`、`artifacts/govuk-properties.png`、出力例は `artifacts/chakra-accordion.svg` と `artifacts/chakra-accordion.figma.json` です。元のChakra Storybookでは拡張を入れる前にも既存の `version` 読み取りエラーが1件発生しますが、今回の表示・コピーの検証を妨げていません。

## 構成

- `src/background.js` — activeTabでの起動とMAIN worldへの橋渡し
- `src/story-index.js` — Storybookの世代差を吸収する一覧取得
- `src/story-runtime.js` — 選択iframeのargs / argTypes取得、更新、リセット
- `src/library-ui.js`, `src/library.css` — ページから隔離されたShadow DOMのライブラリ
- `src/library-brand.js` — 元Storybookのブランド画像・faviconの検出
- `src/infinite-canvas.js` — 実サイズの配置、移動、ズーム、全体表示
- `src/story-examples.js` — Story内の独立した見本を保守的に検出
- `src/preview-snapshot.js` — 描画済みプレビューの軽量キャッシュ
- `src/exporter.js` — SVG / HTML / PNG / Figmaデータの生成
- `figma-plugin/` — Figma用データからネイティブComponentを作成

参考: [Storybookの索引](https://storybook.js.org/docs/configure/user-interface/sidebar-and-urls)、[Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[Figma Plugin API](https://developers.figma.com/docs/plugins/api/figma/)。
