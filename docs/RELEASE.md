# 限定テストからOSS・Chromeストア公開へ

方針確定: 2026年10月29日

**最初はコードも拡張も知り合い限定。共同で改善してから、OSS化と一般公開を行います。** ソース公開とChromeストア配布は別々に設定します。

## 段階

| 段階 | コード | 拡張の配布 | 進めること |
| --- | --- | --- | --- |
| いま | Privateリポジトリを作成済み。共同開発者の招待待ち | 招待した人に手動インストール用ZIPを共有可能 | 知り合いから使い勝手のフィードバックを集める |
| 限定ストア配布 | Private、共同開発者だけ招待 | ChromeストアのPrivate + Trusted testers | ストア経由のインストール・更新で改善を続ける |
| 一般公開 | 権利確認・ライセンス設定後にPublic | ChromeストアのPublic | 外部からのIssue・PRを受け付ける |

Chromeストアの **Unlistedはリンクを知る人なら利用できる設定**です。今回の知り合い限定には **Private** を使用します。Privateでもストア審査は必要です。Trusted testersは開発者アカウント単位のリストなので、既存テスターがいる場合は対象を確認します。拡張単位で分けたい場合は管理するGoogle Groupを利用できます。[公式の配布設定](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)

## 1. 知り合いとの共同開発

1. GitHubでPrivateリポジトリを作成し、ソースとドキュメントを登録。
2. 共同開発者のGitHubユーザー名を確認し、必要な人だけ招待。
3. ブランチ → Pull Request → レビュー → 取り込みの流れで改善。
4. 動作確認だけをお願いする人には拡張だけ共有。

`dist/`、`artifacts/`、`node_modules/`、環境変数ファイルや鍵はGit管理対象から除外しています。ただし `.gitignore` は既に登録済みのファイルや過去の履歴を消す機能ではありません。一般公開前には履歴も含めて確認します。

公開先は [takizawave/storycanvas](https://github.com/takizawave/storycanvas)（Private）。共同開発者の招待はまだ行っていません。

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

ZIP作成時に権限・バージョン・実行ファイルを確認し、既知のファイルだけを梱包します。テスト用の追加ホスト権限、開発用ファイル、デモ動画をストア用ZIPへ含めません。[ストアのZIP仕様](https://developer.chrome.com/docs/webstore/prepare)

2026年10月29日の確認: ビルド成功、単体テスト63件成功、主要ブラウザテスト16項目成功。3つの配布ZIPの構造・内容・破損の有無も確認しました。実サイトを使う全テスト、Chromeのツールバーを実際にクリックする確認、Figmaアプリ内の実インポート、ストア審査は今回の確認範囲に含みません。

## 3. ChromeストアでPrivate配布

2026年10月29日時点で、Chrome ウェブストアの開発者登録はまだ済んでいません。登録後にPrivate配布の申請を進めます。

- 開発者アカウントを登録・設定し、運営者と連絡先を確定。
- [ストア提出原稿](CHROME_STORE.md)を確認して掲載情報・権限の理由・審査用手順を入力。
- [データの扱い](../PRIVACY.md)の運営者と連絡先を確定し、ログイン不要のHTTPSページに掲載。PrivateのGitHub内のURLでは外部の審査担当者や利用者が読めません。
- アイコンと実際の操作画面のスクリーンショットを用意。画像は第三者の秘密情報や共有許可のない素材を含まないものを使う。
- ストア用ZIPをアップロードし、Distributionを **Private**、対象を **Trusted testers** に設定。Googleアカウントのメールアドレスで対象者を登録。
- 審査へ提出。公開時期を管理する場合は自動公開を外し、承認後にPrivate配布を開始。

[公開手順](https://developer.chrome.com/docs/webstore/publish) / [画像要件](https://developer.chrome.com/docs/webstore/images) / [プライバシー欄](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

## 4. OSS化と一般公開

OSS化すると、ライセンスに基づき他の人がコードを再利用・改変・再配布できるようになります。「知り合い以外への再配布禁止」をOSSライセンスに追加する方針ではありません。[Open Source Definition](https://opensource.org/osd)

ライセンスの第一候補は **MIT**。著作権表示とライセンス文の保持を条件に利用・改変・再配布を許可するライセンスです。採用時は著作権者を確定し、参加者の貢献を同じ条件で公開できることを確認して `LICENSE` を追加します。現段階では未適用です。[MIT原文](https://opensource.org/license/mit)

公開前に確認するもの:

- 自作コード・参加者のコード・取り込んだコードの権利とライセンス。必要な著作権表示。
- 履歴、Issue、PR、添付画像に秘密情報・認証情報・非公開URLが含まれないこと。
- デモに使ったコンポーネント・画像・フォント・ロゴの利用条件。ツールのOSS化で第三者素材の権利は変わりません。
- 公開README、問い合わせ先、報告窓口、最新の検証結果。
- 配布する実物での手動確認。自動テストだけではChromeツールバーの実クリックやFigma内の実インポートを完全には検証できません。

条件が揃った時点でGitHubをPublicへ変更し、ストアの公開範囲もPublicへ変更します。OSS化とストア公開は両立します。ストア審査の通過や第三者の権利確認の完了は、この準備だけでは確定しません。
