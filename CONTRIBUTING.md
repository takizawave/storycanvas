# storycanvasへの参加

storycanvasは[MITライセンス](LICENSE)のOSSです。誰でも不具合報告、改善提案、Pull Requestで参加できます。提供する権利のあるコード・素材を使い、このプロジェクトへの貢献はMITライセンスで公開する前提でお願いします。

## 参加方法

[Issues](https://github.com/takizawave/storycanvas/issues)で不具合や改善案を共有できます。変更を提案する場合はリポジトリをforkしてブランチを作り、Pull Requestにまとめてください。管理者がレビューして取り込みます。Chromeストアの限定テストへの参加は、コードへの貢献とは別に案内します。

- 不具合: Chromeのバージョン、再現手順、期待した結果、実際の結果を記載。
- 改善提案: 誰がどの場面で困ったか、改善すると何ができるかを記載。
- 修正: 変更の理由、動作確認、画面が変わる場合はスクリーンショットをPRに記載。

社内StorybookのURL、認証情報、顧客データ、共有許可のない画面は貼らず、可能なら `tests/fixtures` で再現してください。このリポジトリの履歴・Issue・PRは公開されます。脆弱性や漏えいは、管理者との既存の連絡先で非公開に報告してください。

## 開発と確認

Node.js 20以降とnpmを使用します。ZIP作成は現在macOS専用です。

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

Chromeの `chrome://extensions` でデベロッパーモードを有効にし、`dist/` を読み込みます。変更後は再ビルドして、Chrome側で拡張と対象タブを再読み込みします。

ブラウザテストはローカルの固定データで検証します。テスト用に追加するホスト権限は一時コピー内に限り、製品の `extension/manifest.json` には追加しません。実サイトに依存する `test:live` / `test:runtime` などは必要な変更に応じて実行します。

## リリース担当

ストアへの提出は管理者が担当します。共同開発者にストアのアカウント、認証情報、秘密鍵を渡す必要はありません。版を上げるときは `package.json`、`package-lock.json` のルート情報、`extension/manifest.json` を揃えます。

ソース、デモの素材、外部コードの権利やライセンスはそれぞれ確認します。StorybookやFigmaに表示されたコンポーネントの権利は、このツールのライセンスとは別です。
