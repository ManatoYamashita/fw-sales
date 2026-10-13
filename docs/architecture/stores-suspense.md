# 店舗一覧のSuspense境界

`cacheComponents: true` の店舗一覧では、ページ本体を同期のシェルとして保つ。
`searchParams` はPromiseのまま `StoresTableSlot` へ渡し、ページ内のSuspense配下で読む。
ページ本体がawaitすると、後から返す子のSuspenseではその待機を捕捉できない。
親のloading境界で初回表示を処理できても、共有レイアウト内のクライアント遷移は別に検証する必要がある。

- クイックフィルタと検索・絞り込みバーは、それぞれkeyなしの境界を維持する。
- 一覧の外側の境界はsearchParamsを、子が返すkey付き境界は一覧取得を処理する。
- `filter` / `sort` のkeyは一覧だけに適用する。フィルタバーを入れると再マウントされ、入力や開閉状態が失われる。
- 外側と内側は共通の一覧fallbackを使う。

変更後は再読み込みとクライアント遷移の診断を確認し、検索のdebounceによるURL更新をまたいで入力文字・フォーカス・caret・絞り込みパネル状態が保持されることを検証する。
ソースガードを追加した場合は、ページ本体へawaitを戻すと失敗することも確認する。

参照: [Issue #294](https://github.com/ManatoYamashita/fw-sales/issues/294)、インストール済みNext.jsの `instant-navigation.md`、[公式の境界修正ガイド](https://nextjs.org/docs/messages/blocking-prerender-runtime)。
