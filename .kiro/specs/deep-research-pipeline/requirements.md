# Requirements Document

> **2026-09-03 更新**: 本仕様の要件 (R1〜R8) は **すべて削除されました** (#110)。
> 本文中の全要件記述は **取り消し線扱いの履歴** として参照してください。
> 引き続き有効な要件はありません。後継は AI 店舗調査 (Plan v3.2 / Issue #180): `app/(main)/research/**` / `lib/ai/research/**` / `workflows/store-research.ts`。
>
> 例外として §1.4 (エリア検索の画面に調査のキュー登録アクションを露出させない)
> だけは、後継の AI 店舗調査でも同じ UX 方針を維持しており、そのガードは
> `app/(main)/stores/__tests__/area-search-no-deep-research.test.ts` に残置しています。

## Project Description (Input)

**参照 Issue**: [#43 feat: ディープリサーチ・パイプライン構築（Vercel Hobby + GitHub Actions cron + Deep Research polling）](https://github.com/ManatoYamashita/fw-sales/issues/43)

### 誰の課題か
fw-sales を利用する営業担当者。エリア検索でアポリスト候補を抽出した後、各店舗の詳細リサーチ（8 カテゴリ・51 項目）を行う必要があるが、人手で行うと 1 店舗あたり数十分〜1 時間かかり、夜間の準備作業として現実的でない。

### 現状
- AI 分析は `lib/ai/client.ts` / `lib/ai/prompt.ts` / `lib/ai/schema.ts` による **60 秒同期処理**で、出力項目は 5 項目のみ。
- 入力は公式サイト HTML を `cheerio` で抽出して 1 回投げるだけで、Web 検索やニュース等の外部情報は使用していない。
- バックグラウンドジョブ基盤はゼロ（直近コミット `c382619` で Vercel Cron + Resend を全削除済み）。`notifications` テーブルは残存するが配信ロジックは未実装。
- 既存制約（運用環境由来）: 同期処理は最大 60 秒、外部スケジューラの実行間隔は最短 5 分・遅延 10〜30 分が常態化し得る。

### あるべき姿（本機能で変えたいこと）
1. **1 店舗単位で Deep Research をキュー登録**できる（エリア一括投入は本スコープ外、Phase 2 で再検討）。
2. パイプラインは **基本情報取得 → Deep Research（非同期）→ 51 項目構造化 → 通知** の 4 段階で完結する。
3. 51 項目は **A: Web で高信頼取得 / B: 推定（confidence 必須）/ C: 店主ヒアリング必須** の 3 区分でレポートに明示し、C 区分はヒアリング質問文を付ける。
4. 夜間に投入したジョブが翌朝までに完了し、アプリ内通知で結果に到達できる。
5. 既存の同期 AI 分析（5 項目即時返答）は置き換えず、別経路として共存する。

## Boundary Context

- **In scope**:
  - 1 店舗単位での Deep Research ジョブ登録
  - キュー登録 → 非同期実行 → 51 項目構造化レポート生成 → アプリ内通知 の 4 段パイプライン
  - ジョブ状態（queued / researching / structuring / done / failed）の可視化と失敗時の再投入導線
  - 月次・1 日単位の利用上限と外部スケジューラ呼出の認可
- **Out of scope**:
  - エリア検索結果からの一括ジョブ登録（Phase 2）
  - メール・Slack・LINE 等の外部通知チャネル
  - 既存同期 AI 分析（5 項目）の置換または廃止
  - 店主への直接コンタクト機能（電話発信・自動メール送付など）
- **Adjacent expectations**:
  - 既存 `stores` ドメインの店舗マスタが本機能の入力（必須: 店舗名のみ。所在地等は任意で AI が補完）。本機能側で店舗マスタは編集しない。
  - 既存 `notifications` テーブルを拡張して通知を載せるが、通知センター UI は本機能では新設しない。
  - 既存同期 AI 分析と同じ店舗詳細画面に共存させる前提。両者は別経路として区別表示する。
  - エリア検索（`lib/actions/area-search-actions.ts`）からは本機能のキュー登録ボタンを露出させない。

## Requirements

### Requirement 1: 1 店舗単位の Deep Research キュー登録

**Objective:** As a 営業担当者, I want 個別の店舗を 1 件ずつ Deep Research の対象としてキューに登録できること, so that 夜間に必要分を仕込んでおき翌朝までに詳細レポートを得られる

#### Acceptance Criteria
1. When ユーザーが店舗詳細画面で Deep Research ジョブ登録アクションを実行する, the Deep Research Pipeline shall その店舗 1 件分のジョブを `queued` 状態でキューに登録し、登録結果をユーザーに返す
2. If 対象店舗に対して `queued` / `researching` / `structuring` のいずれかの状態の既存ジョブが存在する, the Deep Research Pipeline shall 重複登録を拒否し、既存ジョブへの参照と進行状態をユーザーに返す
3. If 対象店舗の必須基本情報（店舗名）が欠落している, the Deep Research Pipeline shall ジョブ登録を拒否し、欠落項目名をユーザーに通知する（所在地・ジャンル等の他項目は任意。Stage 1 の Deep Research AI が公開情報からベストエフォートで補完する前提のため必須としない）
4. When エリア検索結果の一覧画面が表示される, the Deep Research Pipeline shall その画面に Deep Research のキュー登録アクションを露出させない
5. The Deep Research Pipeline shall ジョブ登録操作の所要時間を、ユーザーが結果を画面で確認できるまで概ね 5 秒以内に収める

### Requirement 2: 非同期実行とユーザー操作からの独立

**Objective:** As a 営業担当者, I want キュー登録後はブラウザを閉じても処理が進むこと, so that 寝ている間にパイプラインが完走している

#### Acceptance Criteria
1. While キューに `queued` 状態のジョブが存在する, the Deep Research Pipeline shall ユーザー操作なしでバックグラウンドで処理を進める
2. The Deep Research Pipeline shall ユーザーがアプリ画面を閉じた後もジョブの進行を継続する
3. While ジョブが処理中, the Deep Research Pipeline shall `queued` / `researching` / `structuring` / `done` / `failed` のいずれか 1 つの状態を必ず保持する
4. The Deep Research Pipeline shall 1 ジョブの所要時間が数十分から数時間規模になることを許容し、複数ジョブが連続実行可能であること
5. While 単一の実行枠の処理時間上限が近づく, the Deep Research Pipeline shall 当該枠内で未完ジョブの処理を打ち切り、ジョブ状態を保持したまま次回の実行枠に処理を引き継ぐ

### Requirement 3: 8 カテゴリ・51 項目の構造化レポート生成

**Objective:** As a 営業担当者, I want 既定の 8 カテゴリ・51 項目を網羅したレポートが店舗単位で得られること, so that 営業準備に必要な情報を画面 1 つで把握できる

#### Acceptance Criteria
1. When Deep Research と構造化処理が完了する, the Deep Research Pipeline shall 8 カテゴリ・51 項目すべての枠を含むレポートを生成し、ジョブを `done` 状態に遷移させる
2. The Deep Research Pipeline shall 各項目に取得難易度区分（A: 高信頼 Web 取得 / B: 推定 / C: 店主ヒアリング必須）を必ず付与する
3. Where 項目区分が B である, the Deep Research Pipeline shall 当該項目に `confidence`（0-100 の数値）、`source_urls`（引用元 URL 配列）、`source_quote`（引用元抜粋テキスト）を付与する
4. Where 項目区分が C である, the Deep Research Pipeline shall 営業が店主に確認する想定の `hearing_question`（質問文）を当該項目に付与する
5. If ある項目について情報が取得できなかった, the Deep Research Pipeline shall その項目を空欄のまま放置せず、区分・confidence・hearing_question のいずれかを必ず明示してレポート上で未充足を可視化する
6. The Deep Research Pipeline shall レポート本文の生 Markdown 全文と、構造化処理で参照した全 URL の配列を、レポート単位で保存する

### Requirement 4: ジョブ完了のアプリ内通知

**Objective:** As a 営業担当者, I want ジョブの完了と失敗をアプリ内で能動的に確認できること, so that 翌朝に結果を見落とさず確認できる

#### Acceptance Criteria
1. When ジョブが `done` 状態に遷移する, the Deep Research Pipeline shall 対象店舗の登録ユーザー宛にアプリ内通知を 1 件作成する
2. When ジョブが `failed` 状態に遷移する, the Deep Research Pipeline shall 失敗理由の要約を含むアプリ内通知を対象ユーザー宛に作成する
3. When ユーザーが完了通知を選択する, the Deep Research Pipeline shall 該当店舗の Deep Research レポート画面へ 1 アクションで遷移させる
4. The Deep Research Pipeline shall 通知をメール・Slack・LINE 等の外部チャネルに送らず、アプリ内に限定する

### Requirement 5: ジョブ状態の可視化と再投入

**Objective:** As a 営業担当者, I want キュー内ジョブの進行状況と失敗時の理由を確認し、必要に応じて再投入できること, so that スタックや失敗を放置せず運用を継続できる

#### Acceptance Criteria
1. While 対象店舗に進行中のジョブ（`queued` / `researching` / `structuring`）が存在する, the Deep Research Pipeline shall 店舗詳細画面に進行中バッジと現在の状態名を表示する
2. When ユーザーが進行中ジョブの状態を確認する, the Deep Research Pipeline shall 登録日時・処理開始日時・現在の状態を画面上で開示する
3. If ジョブが `failed` 状態に遷移した, the Deep Research Pipeline shall その理由要約をジョブログとして保存し、ユーザー画面に表示する
4. If ジョブが 6 時間以上 `researching` または `structuring` 状態のまま進行しない, the Deep Research Pipeline shall そのジョブをスタックとみなして `failed` に遷移させ、スタック理由をジョブログに記録する
5. When `failed` 状態のジョブが画面に表示される, the Deep Research Pipeline shall 同一店舗を再度キューに登録できる手動再投入アクションをユーザーに提供する
6. The Deep Research Pipeline shall 自動リトライを行わず、再実行はユーザーの明示的な再投入操作によってのみ起動する

### Requirement 6: 利用上限と外部呼出の認可

**Objective:** As a プロダクトオーナー, I want ユーザー単位・組織単位の利用上限と外部スケジューラからの呼出認可を担保できること, so that API コスト枯渇と無権限呼出を防げる

#### Acceptance Criteria
1. The Deep Research Pipeline shall 1 ユーザーあたり 1 日（暦日）に登録可能なジョブ件数の上限を運用設定として持ち、上限超過時には新規ジョブ登録を拒否する
2. The Deep Research Pipeline shall 月次の総ジョブ実行件数の上限を運用設定として持ち、上限到達時には新規ジョブ登録を拒否する
3. If 月次実行件数が事前設定した警告閾値（例: 上限の 80%）を超える, the Deep Research Pipeline shall 管理者ロールのユーザー宛にアプリ内警告通知を作成する
4. When 外部スケジューラがパイプラインのポーリングエンドポイントを呼び出す, the Deep Research Pipeline shall 共有シークレットによる認可を必須とする
5. If 認可ヘッダが不正または欠落, the Deep Research Pipeline shall HTTP 401 を返してジョブ処理を進めない
6. The Deep Research Pipeline shall 外部 API 呼出時に発生した生エラーメッセージから API キー文字列および外部リクエスト ID を除去した上でジョブログに記録する

### Requirement 7: 既存機能との境界と表示の使い分け

**Objective:** As a 営業担当者, I want 既存同期 AI 分析と Deep Research レポートを混同せず使い分けられること, so that 用途に応じて適切な情報源を選べる

#### Acceptance Criteria
1. The Deep Research Pipeline shall 既存の同期 AI 分析（5 項目即時返答）を置換せず、別経路として共存させる
2. When 店舗詳細画面が表示される, the Deep Research Pipeline shall Deep Research レポートと同期 AI 分析結果を視覚的に区別された別領域に表示する
3. The Deep Research Pipeline shall Deep Research レポートに最終生成日時と取得難易度区分の凡例を併記する
4. The Deep Research Pipeline shall 既存 `notifications` テーブルに新規通知種別を追加して通知を載せ、既存通知種別のスキーマを破壊しない
5. While レポートが個人情報（店主氏名・連絡先等）を含み得る, the Deep Research Pipeline shall 対象店舗の閲覧権限を持つユーザーにのみレポートを開示する

### Requirement 8: 運用品質目標（パフォーマンス・観測性）

**Objective:** As a プロダクトオーナー, I want ジョブの完了時間と運用統計を追跡できること, so that 夜間運用が翌朝に間に合っているか把握できる

#### Acceptance Criteria
1. The Deep Research Pipeline shall 各ジョブの登録日時・処理開始日時・処理完了日時・所要時間・コスト概算をジョブ単位で記録する
2. The Deep Research Pipeline shall 夜間時間帯（例: 22:00 JST）までに登録されたジョブを翌朝の業務開始時刻（例: 08:00 JST）までに完了させることを運用目標とし、その達成可否を月次集計可能な形で記録する
3. The Deep Research Pipeline shall 月次のジョブ件数・成功件数・失敗件数・スタック件数を集計可能な形で保持する
4. The Deep Research Pipeline shall 失敗ジョブの理由要約を分類可能なログとして保持する
