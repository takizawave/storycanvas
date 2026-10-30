# storycanvasの配布・リリース手順

更新日: 2026年10月30日

**ソースコードはMITライセンスで一般公開します。Chromeストア配布は、開発者登録後に知り合いとの限定テストから始めます。** 公開ソースは誰でも取得・ビルドできるため、ストアのPrivate設定はストア経由の配布対象を限定するものです。

## 段階

| 段階 | コード | 拡張の配布 | 進めること |
| --- | --- | --- | --- |
| いま | Public、MITライセンス | ソースからビルド、または配布されたZIPで手動インストール | Issue・PRで改善を受け付ける |
| 限定ストア配布 | Public、MITライセンス | ChromeストアのPrivate + Trusted testers | ストア経由のインストール・更新で改善を続ける |
| ストア一般公開 | Public、MITライセンス | ChromeストアのPublic | 限定テストの結果を反映し、配布対象を広げる |

Chromeストアの **Unlistedはリンクを知る人なら利用できる設定**です。今回の知り合い限定には **Private** を使用します。Privateでもストア審査は必要です。Trusted testersは開発者アカウント単位のリストなので、既存テスターがいる場合は対象を確認します。拡張単位で分けたい場合は管理するGoogle Groupを利用できます。[公式の配布設定](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)

## 1. 共同開発

1. [CONTRIBUTING.md](../CONTRIBUTING.md)に従い、Issueで不具合や改善案を共有。
2. リポジトリをforkし、ブランチ → Pull Request → レビュー → 取り込みの流れで改善。
3. 管理者が必要に応じて共同開発者を招待。
4. Chromeストアの限定テスターは別途登録。

`dist/`、`artifacts/`、`node_modules/`、環境変数ファイルや鍵はGit管理対象から除外しています。ただし `.gitignore` は既に登録済みのファイルや過去の履歴を消す機能ではありません。リリース前には変更内容と履歴も確認します。

公開先は [takizawave/storycanvas](https://github.com/takizawave/storycanvas)（Public、MITライセンス）。共同開発者の招待はまだ行っていません。

## 2. 配布ファイルを作る

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

ZIP作成は現在macOSが必要です。ビルドと単体テストは他OSでも実行できます。

| ファイル | 用途 |
| --- | --- |
| `artifacts/storycanvas.zip` | 解凍すると `storycanvas/` が現れる手動インストール用 |
| `artifacts/storycanvas-chrome-store.zip` | ストアにアップロードするZIP。`manifest.json` が直下 |
| `artifacts/storycanvas-figma-plugin.zip` | Figmaの開発用プラグインとして読み込む別配布物 |

ZIP作成時に権限・バージョン・実行ファイルを確認し、既知のファイルとMITライセンスを梱包します。テスト用の追加ホスト権限、開発用ファイル、デモ動画をストア用ZIPへ含めません。[ストアのZIP仕様](https://developer.chrome.com/docs/webstore/prepare)

2026年10月29日の確認: ビルド成功、単体テスト63件成功、主要ブラウザテスト16項目とポップアップ表示言語テスト6項目成功。3つの配布ZIPの構造・内容・破損の有無も確認しました。実サイトを使う全テスト、Chromeのツールバーを実際にクリックする確認、Figmaアプリ内の実インポート、ストア審査は今回の確認範囲に含みません。

## 3. ChromeストアでPrivate配布

2026年10月29日時点で、Chrome ウェブストアの開発者登録はまだ済んでいません。登録後にPrivate配布の申請を進めます。

- 開発者アカウントを登録・設定し、運営者と連絡先を確定。
- [ストア提出原稿](CHROME_STORE.md)を確認して掲載情報・権限の理由・審査用手順を入力。
- [データの扱い](../PRIVACY.md)の運営者・連絡先・内容を確認し、[公開URL](https://github.com/takizawave/storycanvas/blob/main/PRIVACY.md)がログイン不要で読めることを確認。
- アイコンと実際の操作画面のスクリーンショットを用意。画像は第三者の秘密情報や共有許可のない素材を含まないものを使う。
- ストア用ZIPをアップロードし、Distributionを **Private**、対象を **Trusted testers** に設定。Googleアカウントのメールアドレスで対象者を登録。
- 審査へ提出。公開時期を管理する場合は自動公開を外し、承認後にPrivate配布を開始。

[公開手順](https://developer.chrome.com/docs/webstore/publish) / [画像要件](https://developer.chrome.com/docs/webstore/images) / [プライバシー欄](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

## 4. ライセンスと今後の公開

本プロジェクトのコード・ドキュメントは[MITライセンス](../LICENSE)です。著作権表示とライセンス文を保持して利用・改変・再配布できます。Storybookから取得するコンポーネントや、第三者の画像・フォント・ロゴの権利はそれぞれの権利者に帰属します。

今後の変更でも、取り込むコード・素材の利用条件と、秘密情報が含まれないことを確認します。Chromeストアは限定テストの結果を反映してからPublicへ変更します。ストアへの申請・審査はGitHubでのソース公開とは別です。
