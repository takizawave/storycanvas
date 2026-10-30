# storycanvas — インストール

Storybookを、コンポーネントを一覧・比較・コピーできるデザインライブラリとして使うChrome拡張です。ソースコードはMITライセンスで公開しています。Chrome ウェブストアにはまだ公開していないため、このZIPは手動でインストールします。同梱の `LICENSE` に利用条件を記載しています。

## インストール

1. `storycanvas.zip` を解凍します。
2. Chromeで `chrome://extensions` を開き、デベロッパーモードをオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」から、解凍した `storycanvas` フォルダを選びます。
4. Storybookを開き、拡張アイコン →「このStorybookを展開」を押します。

Chrome 120以降が必要です。更新版を受け取ったら同じフォルダのファイルを更新し、拡張機能の管理画面で再読み込みして、Storybookのタブも再読み込みしてください。手動インストール版には自動更新がありません。

## 試してほしいこと

- 一覧から目的のコンポーネントを探せるか。
- Propertiesを変えて見た目を比較できるか。
- SVG／PNG／HTML／リンクのコピーが用途に合うか。
- 日本語／英語の切り替え、ズーム、検索、お気に入りが使いやすいか。

元のStorybookのコードは変更しません。対応するPropertiesはそのStorybookが公開しているものに限ります。表示・書き出しの再現には制限があり、Canvas、動画、高度なCSS効果などは完全に再現できません。

Figmaで編集できるデータを取り込む場合は、別配布の `storycanvas-figma-plugin.zip` も必要です。解凍後、Figmaデスクトップの Plugins → Development → Import plugin from manifest からその中の `manifest.json` を読み込み、拡張でコピーしたFigma用データをプラグインに貼り付けます。

## データとフィードバック

同梱の `PRIVACY.md` にデータの扱いを記載しています。ページの内容を開発者のサーバーへ送る機能や利用解析はありません。Storybookや画像・フォントの取得に伴う通信は発生します。

気になった点は [GitHub Issues](https://github.com/takizawave/storycanvas/issues)で、再現手順・期待する結果・実際の結果を共有してください。スクリーンショットを共有するときは、社内情報や顧客データが含まれないものを使ってください。
