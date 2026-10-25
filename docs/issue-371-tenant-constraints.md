# Issue 371: DEFAULT撤去とテナント複合制約

親: #365 ／ 前提: #368・#370（完了、#395までmain取り込み済み）

## PLAN

main `4ffff850` から専用worktreeで実装した。AGENTS.md / CLAUDE.md、既存Drizzle migration・FK検証の運用、Next.js 16.3.1同梱資料、Supabase / Postgresガイドを参照した。外部ライブラリは追加しない。

Issue指定に従い、次の3つのPRを順に反映する。ローカルでは全段階を検証したが、dev/prdへのDDLは実行していない。

| 段階 | 内容 | 反映条件 |
| --- | --- | --- |
| expand | 0033: 親のUNIQUE(tenant_id,id)、候補・設定・既定テンプレートの複合unique、所属付き索引を追加。旧制約・DEFAULTは維持 | 最初にマージ。既存workflowで同じcommitをdev→prdへ適用し、成功を確認 |
| code | 設定のupsertを(tenant_id,key)へ切替。旧global PKによる衝突も汎用エラーへ変換 | expandの両DB反映後にマージし、このコードの本番配備がReadyになったことを確認 |
| contract | 0034: DEFAULT・旧unique/PK・単一列業務FKの撤去と複合FK・上限triggerへの切替。0035: 降順索引をSQLのNULLS FIRSTへ合わせる | codeの本番反映後にマージ。migrationとVercelの起動順は保証されないため、同時マージしない |

expandは旧コード・新コードの両方を受理する。contract後はON CONFLICT(key)を使う旧コードへ戻さず、複合キー対応済みのcode段階以降を使う。DDLの復旧が必要なら、現状の制約と重複を調査したうえで、新しいforward migrationを作る。適用済みSQL・journalの書換えはしない。

## DO

### DEFAULTと主キー

業務9テーブルのtenant_idはNOT NULLを維持してDEFAULTを外す。共有のtenants / profilesと、元々DEFAULTのないmembershipsの扱いは変えない。event_logsは証跡保持のためtenant FKを張らないが、tenant_idの明示は必須とする。

place_candidatesのgoogle_place_idは(tenant_id,google_place_id)の一意へ切り替える。app_settingsは(tenant_id,key)を主キーとし、0033で追加した一意索引をPRIMARY KEY USING INDEXで再利用する。他社と同名の設定を保存しても、自社の行だけが更新される。

### 業務行の参照

stores / dealsにUNIQUE(tenant_id,id)を追加したうえで、以下を複合FKへ切り替える。既存のid単独主キーは維持し、バックアップのIDやURLは変更しない。

| 子→親 | 子列 | 親列 | 削除 |
| --- | --- | --- | --- |
| deals→stores | tenant_id, store_id | tenant_id, id | CASCADE |
| handoffs→stores | tenant_id, store_id | tenant_id, id | CASCADE |
| handoffs→deals | tenant_id, deal_id | tenant_id, id | CASCADE |
| store_research_runs→stores | tenant_id, store_id | tenant_id, id | CASCADE |
| place_candidates→stores | tenant_id, matched_store_id | tenant_id, id | SET NULL (matched_store_id) |

候補のSET NULLは所属列を消してはいけない。Drizzleは列指定を表現できないため、0034のraw SQLで指定し、schemaにはonDelete("set null")を宣言する。db:verify-fksがpg_constraintの参照列・親列・confdelsetcols・検証済み状態まで照合する。schema走査も全業務FKの対応するtenant列を検査する。

不正な旧参照は自動修復しない。FK検証に失敗すればDrizzleのtransaction全体が戻り、旧PK・DEFAULT・行が維持される。lock_timeout=5sにより、稼働中の処理とのロック競合を長く待ち続けない。

2026-10-25の読み取り確認ではdev/prdともPostgreSQL 17.6（server_version_num=170006）。上記5関係の越境参照は両DBとも各0件、旧設定PK名はapp_settings_pkeyだった。migrationはPostgreSQL 15以上を明示的に要求する。

### 担当者・依頼者と退会

stores.assigned_*_user_id / deals.assigned_sales_user_id / store_research_runs.requested_by_user_idは、共有identityであるprofilesへの現行FKを維持する。membershipsへのFKは追加しない。

所属を外すとログイン・新しい割り当ては拒否する一方、過去の担当者や調査依頼者は残す。membership削除で履歴をNULLにしたり、履歴があるため退会できなくなったりする契約は採用しない。新規割り当ての所属検証は既存のrepositoryが担い、会員管理の画面・運用は#374で扱う。DBの管理者SQLによるidentity割り当てまでmembership制約で強制するものではない。

### テンプレート

既定の部分一意を(tenant_id,user_id)へ変更する。件数上限triggerは同じ組で数え、pg_advisory_xact_lock(hashtext(tenant_id),hashtext(user_id))を取得する。BEFORE INSERTに加え、tenant_id / user_idのUPDATEも対象とし、移動による上限回避を拒否する。既定の直接削除拒否とprofile参照は維持する。

### 索引と診断

主な一覧、Google Place ID照合、子参照、最新run、通知・テンプレートの索引はtenant_idを先頭へ置く。座標索引は(tenant_id,lat,lng) WHERE lat IS NOT NULL AND lng IS NOT NULLとする。

降順索引のNULLの順もSQLと合わせる。Drizzleの索引.desc()はNULLS LASTを出力する一方、ORDER BY ... DESCは既定NULLS FIRSTなので、NOT NULL列でも順序付き索引が選ばれない場合がある。0035では.nullsFirst()へ合わせ、実行計画で一覧のSort省略を確認する。

bench-area-search-index.mjsは所有確認済みの破棄専用clusterだけで動かす例外を維持する。全Q1〜Q5、型比較のSQLへ所属条件を追加し、C5の所属付き座標索引も比較する。通常の診断CLIは対象を必須にする。

```sh
pnpm db:diagnose-area-search --tenant=firstweb --json
bash scripts/bench-area-search-index.sh --rows=10000,100000 --null-rates=0.5 --runs=5
```

2社1万行の実DBでは、一覧・Place ID・bbox・IN OR bboxの4形状で複合索引とtenant_idのIndex Condを確認した（seqscan強制無効化なし、random_page_costはSupabase実測の1.1）。破棄専用ベンチも1万・10万行で実行した。共有端末の時間値は参考値とし、採用根拠は所属条件を索引で処理する計画とする。

## CHECK

- [x] 追加制約だけのDBで旧コード114件、新コード114件が成功
- [x] 全9テーブルでtenant省略を23502、業務5関係の越境INSERTを23503で拒否
- [x] 2社の同じPlace ID・設定キー、兼務者の各社既定1件・最大5件
- [x] 同時INSERTは残り1枠を超えず、別社のINSERTを同じロックで待たせない
- [x] 自社だけのCASCADE、候補の所属を維持する指定列SET NULL
- [x] 実際のSQLによるexpand互換、contract失敗時の全体rollback、移行後の拒否と削除
- [x] 実DB14ファイル140件、型、lint、本番向けbuild、FK検証
- [ ] 最終単体・反証・E2EとPR CI（最終結果はPR / Issueへ記録）

旧DEFAULTを前提にした基盤・ローカルidentity移行のfixtureは、明示tenantへ更新した。旧他社参照のアプリ保護テストはtransaction内で旧FKを再現して残し、新DB自身の拒否とは分けて検証する。

## ACTION

各PRのレビューと上記順の本番反映が完了するまでIssueは開いたままにする。request所属解決は#373、招待・退会は#374に残るため、この変更だけで2社目の開設を完了した扱いにはしない。

## 今回の知見とルール更新提案

- 【発見した問題・課題】複合SET NULLでは所属までNULLになる。索引とSQLのNULL順の差も実行計画へ影響する。
- 【解決した方法】指定列SET NULLをraw SQLと実catalogで検証し、降順索引をSQLの並びに合わせた。
- 【推奨するルール追加・更新】contractはexpand・対応コードの本番反映後に分ける。DDL失敗時の復元、別接続の上限制御、SQLと索引の並びを実DBで検証する。
- 【次回同様のタスクで参照すべき情報】本書、_store-fk-policy.mjs、tenant-contract-migration / tenant-template-concurrency / tenant-index-plansの各integration test。
- 【次に行うべきこと】3段階のPRレビュー・順次反映。その後#372へ進む。

参考: [PostgreSQLの複合FKと指定列SET NULL](https://www.postgresql.org/docs/17/ddl-constraints.html)、[Supabaseの索引・実行計画](https://supabase.com/docs/guides/database/query-optimization)。
