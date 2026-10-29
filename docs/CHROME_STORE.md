# Chrome ウェブストア提出原稿

対象: 0.1.0 / 配布先: **Private + Trusted testers** / 状態: 未提出

Chrome ウェブストアの開発者アカウントは未登録です（2026年10月29日確認）。

運営者・問い合わせ先・公開プライバシーポリシーURL・画像は提出前に確定します。このファイルを用意してもストアには送信されません。

## 掲載文

**名前:** storycanvas

**短い説明:** Storybookを、一覧・比較・コピーできるデザインコンポーネントライブラリに。

**詳しい説明:**

storycanvasは、Storybookのコンポーネントをデザインツールのように見渡し、比較・調整・コピーできるChrome拡張です。PM、デザイナー、エンジニアが、実際のコンポーネントを確認しながら次の画面を考えるために使えます。

Storybookを開いて拡張アイコンをクリックし、「このStorybookを展開」を押すと始められます。

- コンポーネントとバリエーションを一覧キャンバスで比較。
- Storybookが公開するPropertiesを編集して見た目を確認。
- 選んだコンポーネントをSVG、PNG、HTML、リンク、Figma用データとしてコピー・保存。
- 検索、お気に入り、日本語・英語の表示切り替え。
- 元のStorybookとキャンバスを切り替えて確認。

利用者が指定したタブで動作し、サイト全体への常時アクセスは要求しません。ページ内容はブラウザ内で処理します。開発者のサーバーへのデータ送信や利用解析はありません。表示のために、対象Storybookや画像・フォントなどの配信元への通信は発生します。

Storybookとプレビューが同じ配信元にある構成が対象です。Propertiesの編集は一時的な表示変更で、元のコードは変わりません。高度なCSS効果、Canvas、動画、closed Shadow DOMなどの書き出しには制限があります。Figmaで編集可能なデータを取り込むには、別配布のstorycanvas Importプラグインが必要です。Figmaの通常の貼り付けだけでネイティブComponentになる機能ではありません。

本ツールは独立したプロジェクトで、Storybook、Google、Figma、デモに使うライブラリの公式製品や提携製品ではありません。

## Privacy欄

### 単一の目的

利用者が開いているStorybookのコンポーネントを、一覧・比較・表示調整・書き出しできるデザインライブラリとして提供すること。

### 権限の理由

| 権限 | 記入文 |
| --- | --- |
| `activeTab` | 利用者が拡張をクリックしたタブのURLとStorybookに一時的にアクセスするため。常時のホストアクセスや閲覧履歴の取得は不要です。 |
| `scripting` | 同梱のライブラリUIを選択タブへ注入し、Storybook自身の実行環境でStory一覧・args・argTypesを読み、利用者が選んだプレビューのPropertiesを更新するため。 |
| `clipboardWrite` | 利用者がコピーを実行したとき、選択したコンポーネントのSVG・PNG・HTML・リンク・Figma用データをクリップボードへ書き込むため。 |
| `storage` | 利用者が選んだ日本語／英語の表示言語を端末内に保存し、ポップアップとライブラリ表示で共有するため。 |

### データの申告

ローカル処理も申告対象です。「開発者に送信しない」だけを理由に、すべてのデータ項目を未使用としないでください。[公式FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

実装上の処理対象は **Website content**（コンポーネントの文字・画像・フォームの現在値等）、対象ページのURL、**User activity**（対象プレビューのActions）です。ダッシュボードに表示される最新の定義に合わせて、URLを扱う **Web history** を含めて該当項目を確認・申告します。ブラウザ全体の閲覧履歴を取得する実装ではありません。[PRIVACY.md](../PRIVACY.md)と矛盾しない説明を記入します。

パスワードや認証Cookieを直接読み取る機能はなく、ログイン済みStorybookの読み込みにはブラウザの通常のセッションを利用します。開発者への収集、広告目的の利用、販売はありません。

### リモートコードの説明

拡張のロジックはZIPに同梱しています。外部JavaScriptを取得して拡張コードとして実行する更新機構や `eval` は使いません。ただし、ページ内のiframeで元のStorybookを表示するので、元サイトのスクリプトは通常のWebページとして動作します。同梱した処理がMAIN worldでStorybookのAPIを呼ぶ構成も、審査時に説明します。

「外部コードは一切動かない」とは申告せず、リモートコード欄の定義・選択肢に合わせてこの構成を明記します。iframe等の拡張APIから隔離された文脈はMV3ポリシーに記載がありますが、この実装の適合性は審査で判断されます。[MV3追加要件](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)

## 審査・手動確認の手順

1. 最新Chromeで拡張をインストールする。
2. 公開Storybookを開く。例: [GOV.UK React](https://govuk-react.github.io/govuk-react/?path=/story/button--default)。公開サイトのURL・稼働状態は提出直前に再確認する。
3. 拡張アイコンをクリックし、「このStorybookを展開」を押す。
4. コンポーネント一覧、検索、詳細ページを確認する。
5. Controls対応のStoryでPropertiesを編集し、プレビューが変わること、元のソースを変更しないことを確認する。
6. SVGやPNGをコピー、SVGを保存し、対象の内容が得られることを確認する。
7. 日本語／英語を切り替え、再起動後も設定が保持されることを確認する。
8. 閉じるボタンで元のStorybookへ戻ることを確認する。

拡張独自のログイン情報は不要です。Figma用データの取り込みは別プラグインの任意機能であり、ブラウザ内の一覧・調整・その他の書き出しにFigmaは不要です。

## 提出前に揃える項目

- 開発者アカウント、運営者名、公開問い合わせ先。
- ログイン不要で読めるHTTPSのプライバシーポリシーURL。
- アイコン（ビルドで `dist/icons/icon128.png` を生成）と実際の製品画面のスクリーンショット。ストアの最新の画像要件に合わせる。
- 対象テスターのGoogleアカウント。Privateが選ばれていることと既存のTrusted testersも含む配布範囲を確認。
- 実機での起動・コピーの確認。FigmaプラグインはFigmaアプリ内での実インポート確認が別途必要。

参照: [画像要件](https://developer.chrome.com/docs/webstore/images) / [Privacy欄](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) / [提出手順](https://developer.chrome.com/docs/webstore/publish)
