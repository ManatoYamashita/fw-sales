# Requirements Document

> **2026-05-17 更新**: §4 (商談リマインダー / Email 通知) / §6 (Vercel Cron) / §8.3 (`CRON_SECRET`) は削除されました。本文中の該当要件記述は **取り消し線扱いの履歴** として参照してください。Supabase Auth (Google OAuth) + Profile 移行関連 (§1, §2, §3, §5, §7, §8.1, §8.2) は引き続き有効です。

## Project Description (Input)

参照元: GitHub Issue #16 — `feat(auth): Supabase Auth (Google OAuth) + メール通知基盤 + assigned カラム移行`
URL: https://github.com/ManatoYamashita/fw-sales/issues/16

### 誰が課題を抱えているか

フリーストWEB の営業担当 / 企画担当(`fw-sales` ツール利用者全員)、および本ツールの保守を担う開発チーム。

### 現状

- 本プロジェクトには **認証機能が一切存在しない**。誰がどの操作を行ったかをツール側で識別できない。
- #14 のエリア検索ジョブで「実行者の特定」ができないため、ジョブ完了/失敗時のメール通知の宛先を決められない。
- 既存 `stores.assigned_planner` / `stores.assigned_sales` / `deals.assigned_sales` は **text(自由文字列)** 保存で、ユーザーアカウントとの紐付けがない。「自分宛の商談」フィルタが文字列マッチに依存しており、表記ゆれや改名で破綻する。
- 操作ログ・編集履歴を残せない(将来要件に向けた基盤も不在)。
- メール送信の基盤が一切存在せず、商談予定日のリマインダーや調査ジョブの完了通知などのトリガがあっても通知できない。

### 何を変えるか

1. **Supabase Auth (Google OAuth)** を導入し、`@supabase/ssr` で Next.js 16 (App Router) に SSR 統合する。`(main)` 配下の全ルートを middleware で認証必須化し、未ログインは `/login` へリダイレクトする。
2. `auth.users` を拡張する **`profiles` テーブル**(id / email / display_name / avatar_url / role / created_at / updated_at)を新設し、`auth.users` への INSERT 時に Postgres trigger で自動生成する。
3. `stores.assigned_planner` / `stores.assigned_sales` / `deals.assigned_sales` の **text カラムを完全に置換** し、`assigned_planner_user_id` / `assigned_sales_user_id` (uuid, FK to profiles.id, nullable) に移行する。マイグレーションは 2 段階で実施(新カラム追加 + バックフィル → 旧 text DROP)。バックフィルで一致しない名前は **placeholder profile** (`role='placeholder'`) として作成し、後日マージ可能にする。
4. **Resend** を採用してメール送信基盤を構築する(`lib/email/`、SDK ラッパ + テンプレート群)。`RESEND_API_KEY` 未設定時は no-op で動作させ開発環境を阻害しない。
5. **#14 の調査ジョブ完了 / 失敗時** に `triggered_by` の profile.email へメール送信する。`store_research_jobs.triggered_by` を text → uuid (FK to profiles.id) に変更する。
6. **商談予定日リマインダー**を Vercel Cron で前日朝 / 当日朝に配信する(`assigned_sales_user_id` の profile.email 宛、商談一覧 + 店舗詳細リンク)。
7. **#14 の `notifications` テーブルに `user_id` (FK to profiles.id) を追加**し、アプリ内通知ベルを認証ユーザー本人の分のみ表示する。
8. ヘッダー / サイドバーに **ユーザーメニュー(アバター + サインアウト)** を配置する。
9. 環境変数雛形 (`.env.example`) に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `RESEND_API_KEY` / `RESEND_FROM_EMAIL` を追加する。

### スコープ境界 (OUT)

- メール / パスワード認証(本仕様は Google OAuth のみ)
- 招待制 / ドメイン制限(自由登録のリスクは README + Issue OUT に明記)
- ロール別権限制御 (`role='admin'` の活用は将来仕様、当面は全員 `member` 同権限)
- 編集履歴 / 監査ログ
- placeholder profile を実ユーザーへマージする Admin UI
- Slack / Discord / Web Push 等のメール以外の通知チャネル
- 商談ステージ変更通知 / 新規店舗登録通知

### 依存関係

- **#14** (エリア検索ジョブ + アプリ内通知ベル): 本仕様で `notifications.user_id` / `store_research_jobs.triggered_by` を user 紐付けに変更する。並行着手可能だが、#14 のテーブル新設タスクが先行する。
- **#15** (店舗詳細画面): 本仕様完了後、編集 / 削除アクションに将来ロール制御を入れる余地ができる。

## Boundary Context

- **In scope**:
  - Google OAuth による サインイン / サインアウト と全 `(main)` ルートの認証保護
  - ユーザー識別子(プロフィール)の自動生成・管理(表示名 / メール / アバター / ロール)
  - `stores` / `deals` の担当者表現を「自由文字列」から「ユーザー参照」へ完全置換し、既存データを保持したまま移行する
  - メール通知の汎用送信基盤(送信失敗時の業務継続性 / 設定未投入時の no-op 動作)
  - 調査ジョブ完了 / 失敗のメール通知配信
  - 商談予定日リマインダーの定時メール配信(前日朝 / 当日朝)
  - アプリ内通知の通知先ユーザー絞り込み
  - 認証・OAuth・メール送信に必要な環境変数の雛形整備
- **Out of scope**:
  - メール / パスワード認証、ドメイン制限、招待制
  - `member` 以外のロールに基づく権限分岐(`admin` ロール定義は将来用に温存するのみ)
  - 編集履歴 / 監査ログ
  - placeholder プロフィールを実ユーザーにマージする運用 UI
  - Slack / Discord / Web Push / SMS 等メール以外の通知チャネル
  - 商談ステージ変更通知、新規店舗登録通知などの本仕様で定義しない通知トリガ
- **Adjacent expectations**:
  - 別仕様 (#14) が `store_research_jobs` テーブルとそのステータス遷移、およびアプリ内通知レコードと通知ベル UI を提供する。本仕様は当該テーブルのトリガユーザー / 通知先ユーザーをユーザー参照として持たせる責務、および当該ステータス遷移をフックしてメール送信する責務を負う。
  - 別仕様 (#15) が店舗詳細画面のリンク先となる。リマインダー / 完了通知メール内のリンクは当該画面が公開された URL を前提とする。
  - 既存リポジトリ層 (`lib/repositories`) と Server Actions (`lib/actions`) の Mock / 本実装は、担当者表現がユーザー参照に変わった後も等価な業務制約を満たすこと(steering の `Repository Pattern` 規約に従う)。

## Requirements

### Requirement 1: Google OAuth による認証アクセス制御

**Objective:** As a fw-sales ツール利用者(営業 / 企画担当), I want Google アカウントでサインインしてツール全画面を利用したい, so that 個別ユーザー識別を前提とした業務機能を安全に使用できる

#### Acceptance Criteria
1. While ユーザーが未認証である, when ユーザーが `(main)` 配下の任意ルート(例: `/dashboard`, `/stores`, `/deals`, `/research`, `/pipeline`, `/handoffs`, `/kpi`, `/settings`)にアクセスする, the fw-sales システム shall サインイン画面 (`/login`) にリダイレクトする
2. When ユーザーがサインイン画面で Google サインインアクションを実行する, the fw-sales システム shall Google OAuth 認可フローを開始する
3. When Google OAuth 認可フローが正常完了する, the fw-sales システム shall ユーザーを認証済み状態にし、認可前にアクセスしようとしていたルート(指定がなければ `/dashboard`)へ遷移する
4. If Google OAuth 認可フローがキャンセル または 失敗する, then the fw-sales システム shall サインイン画面に失敗理由を示すエラーメッセージを表示する
5. While ユーザーが認証済みである, the fw-sales システム shall ヘッダー領域にユーザーアバター・表示名を含むユーザーメニューを常時表示する
6. When ユーザーがユーザーメニューからサインアウトを実行する, the fw-sales システム shall セッションを破棄し `/login` へリダイレクトする
7. The fw-sales システム shall サインイン手段として Google OAuth のみを提供する (メール / パスワード認証は提供しない)

### Requirement 2: ユーザープロフィールの自動生成と再利用

**Objective:** As a fw-sales 開発者 / マネージャー, I want Google サインインと同時にユーザープロフィール(表示名 / メール / アバター / ロール)が自動生成され継続利用される, so that ツール上で各ユーザーを構造化データとして安定参照できる

#### Acceptance Criteria
1. When ユーザーが初めて Google でサインインする, the fw-sales システム shall ユーザーの Google アカウント情報(表示名 / メールアドレス / アバター URL)を取り込んだプロフィールレコードを自動生成する
2. When プロフィールレコードを自動生成する, the fw-sales システム shall ロール属性を `member` として初期化する
3. When 既存プロフィールを持つユーザーが再サインインする, the fw-sales システム shall 既存プロフィールを再利用し、当該プロフィール ID と紐付くドメイン参照(担当者参照 / トリガユーザー / 通知先)を保持する
4. The fw-sales システム shall Google アカウントを持つ任意のユーザーがサインイン可能な自由登録方式を採る (招待制 / ドメイン制限はスコープ外)
5. The fw-sales システム shall プロフィールを `member` ロールと、移行用に確保される `placeholder` ロールの 2 種別で識別可能とする (本仕様での権限分岐は行わない)

### Requirement 3: 担当者表現のユーザー参照への完全置換

**Objective:** As a fw-sales 営業 / 企画担当, I want 店舗 / 商談の担当者をユーザーアカウントとして紐付けて取り扱う, so that 「自分宛のレコード」を表記ゆれなく一意に絞り込め、改名・退職時のデータ追従コストを排除できる

#### Acceptance Criteria
1. The fw-sales システム shall 店舗(store)レコードに「企画担当ユーザー」「営業担当ユーザー」の 2 つのユーザー参照を保持する
2. The fw-sales システム shall 商談(deal)レコードに「営業担当ユーザー」のユーザー参照を保持する
3. The fw-sales システム shall 担当者を未割り当て(NULL)とする状態を許容する
4. While 既存データの移行処理を実行中である, the fw-sales システム shall 旧 text 担当者値とプロフィールの表示名が完全一致する場合に当該プロフィール参照に紐付ける
5. If 旧 text 担当者値に対応するプロフィールが存在しない, then the fw-sales システム shall 当該名称を表示名として保持する placeholder プロフィール(`role = 'placeholder'`)を生成し、レコードをそれに紐付ける
6. When 移行処理が完了する, the fw-sales システム shall 旧 text 担当者カラム(`stores.assigned_planner` / `stores.assigned_sales` / `deals.assigned_sales`)を以後保持しない
7. While ユーザーが店舗 / 商談の新規登録 または 編集フォームを操作する, the fw-sales システム shall 担当者欄として登録済みプロフィール(placeholder を含む)から選択する UI を提示する (自由文字列入力は受け付けない)
8. The fw-sales システム shall 担当者によるレコード絞り込み(自分宛の店舗 / 自分宛の商談など)をユーザー参照に基づいて実行する

### Requirement 4: メール通知の汎用送信基盤

**Objective:** As a fw-sales 開発者 / 利用者, I want システム内のイベントから安定してメール通知を送信できる基盤がある, so that 通知トリガが追加された際に追加開発なくメール配信を起動でき、設定未投入の環境でも業務処理を阻害しない

#### Acceptance Criteria
1. When メール通知トリガが発火する, the fw-sales システム shall 受信者プロフィールのメールアドレスを宛先としてメールを送信する
2. While メール送信に必要な API キーが未設定である, the fw-sales システム shall メール送信処理を no-op として扱い、業務処理(認証・主要機能・ジョブ完了処理)を中断・失敗させない
3. If メール送信が失敗する, then the fw-sales システム shall 失敗をエラーログに記録し、業務処理(送信トリガ元の主処理)は継続する
4. The fw-sales システム shall 全送信メールに本仕様のツール名を識別できる送信元アドレスと、件名先頭にツール識別プレフィックス(例: `[fw-sales]`)を付与する

### Requirement 5: 調査ジョブ完了 / 失敗のメール通知

**Objective:** As a 調査ジョブを起動した営業 / 企画担当, I want ジョブの完了 / 失敗をメールで知らされる, so that ツールを能動的に開かなくても結果に気付き次アクションへ進める

#### Acceptance Criteria
1. The fw-sales システム shall 調査ジョブのトリガユーザーをユーザー参照として保持する (text 自由文字列での保存はしない)
2. When 調査ジョブのステータスが「completed」に遷移する, the fw-sales システム shall ジョブを起動したユーザーのメールアドレスへ完了通知メールを 1 通送信する
3. When 調査ジョブのステータスが「failed」に遷移する, the fw-sales システム shall ジョブを起動したユーザーのメールアドレスへ失敗通知メールを 1 通送信する
4. The fw-sales システム shall 完了通知メールの件名にジョブの成功件数 / 失敗件数の集計を含める
5. The fw-sales システム shall 完了通知メールの本文に対象店舗一覧と、ツール上の店舗一覧画面 (`/stores`) へのリンクを含める
6. The fw-sales システム shall 失敗通知メールの本文に失敗概要(対象件数 / 失敗件数 / 主要エラーの要約)と、再実行手順または該当画面へのリンクを含める
7. If 調査ジョブのトリガユーザーが特定できない, then the fw-sales システム shall メール送信を行わず、その旨をエラーログに記録する

### Requirement 6: 商談予定日リマインダーの定時メール配信

**Objective:** As a 商談を担当する営業, I want 翌日 / 当日に予定された商談をメールで思い出させてもらう, so that ツールを開かなくても商談を漏れなく実施できる

#### Acceptance Criteria
1. The fw-sales システム shall リマインダー判定基準時刻を日本標準時 (JST) で運用する
2. When 前日朝の指定時刻に日次リマインダー配信ジョブが起動する, the fw-sales システム shall 翌日 (JST) に予定があり、かつ営業担当ユーザーが割り当てられている商談を抽出する
3. When 当日朝の指定時刻に日次リマインダー配信ジョブが起動する, the fw-sales システム shall 当日 (JST) に予定があり、かつ営業担当ユーザーが割り当てられている商談を抽出する
4. When 抽出された商談が 1 件以上存在する, the fw-sales システム shall 営業担当ユーザーごとに対象商談を集約し、ユーザー 1 名につき 1 通のリマインダーメールを送信する
5. The fw-sales システム shall リマインダーメールの件名にリマインダー種別(明日 / 本日)と件数を含める
6. The fw-sales システム shall リマインダーメールの本文に商談ごとの店舗名・商談形式・提案内容、および店舗詳細画面へのリンクを含める
7. If 商談に営業担当ユーザーが割り当てられていない, then the fw-sales システム shall 当該商談をリマインダー対象から除外する
8. If 抽出された商談が 0 件である, then the fw-sales システム shall リマインダーメールを送信しない

### Requirement 7: アプリ内通知の通知先ユーザー絞り込み

**Objective:** As a fw-sales 利用者, I want アプリ内通知ベルに自分宛の通知のみが表示される, so that 他人宛の通知に煩わされず、自分が次に取るべきアクションだけを把握できる

#### Acceptance Criteria
1. The fw-sales システム shall アプリ内通知レコードに通知先ユーザー参照を保持する
2. When 業務イベントが発火しアプリ内通知レコードを生成する, the fw-sales システム shall 通知対象に紐付くユーザーを通知先として記録する
3. While 認証済みユーザーがアプリ内通知ベルを開く, the fw-sales システム shall 当該ユーザーを通知先とする通知のみを表示する

### Requirement 8: 環境変数とランタイム構成

**Objective:** As a fw-sales 開発者 / 運用担当, I want 認証 / OAuth / メール送信に必要な環境変数が雛形として整備されている, so that 新環境セットアップ・本番デプロイ時に設定漏れなく構築できる

#### Acceptance Criteria
1. The fw-sales プロジェクト shall 認証プロバイダ接続情報(URL / 公開鍵 / サービスロール相当キー)、OAuth クライアント認証情報(クライアント ID / クライアントシークレット)、メール送信 API キー、送信元メールアドレスを環境変数雛形ファイル (`.env.example`) に列挙する
2. While 認証関連の環境変数が未設定である, the fw-sales システム shall 起動時または認証機能の初回利用時に未設定であることを警告ログに出力し、サインイン処理は失敗として扱う
3. If メール送信 API キーが未設定である, then the fw-sales システム shall メール送信を no-op としつつ、認証および主要機能(店舗 / 商談 / 調査ジョブ)を継続稼働させる
