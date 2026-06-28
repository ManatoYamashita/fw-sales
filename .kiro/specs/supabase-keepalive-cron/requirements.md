# Requirements Document

## Introduction

本機能は、Supabase Free Tier の「7 日連続無アクセスで自動 pause」によって本番 (`https://fw-sales.vercel.app/`) が `504 GATEWAY_TIMEOUT` (`MIDDLEWARE_INVOCATION_TIMEOUT`) を返す再発を防ぐため、定期的に Supabase へ活性化リクエストを送る GitHub Actions ベースの Keep-Alive ワークフローを導入する。

2026-06-21 の障害（最終 main commit 2026-06-14 → ぴったり 7 日後に pause が発火）を受けて、PR #146 で Edge Middleware に `AbortSignal.timeout(4_000)` の fail-fast 防御を入れたが、これは被害最小化であり pause 自体の予防ではない。本機能は pause タイマーをリセットし続けることで、pause を「発火させない」ことを目的とする。

対象ユーザーは本プロダクトの運用者（開発者本人）であり、観測可能な成功条件は「7 日連続無アクセス状態が成立せず、本番がいつ訪問しても応答可能であり続けること」である。

## Boundary Context

- **In scope**:
  - 定期スケジュール実行と手動実行が可能な Keep-Alive ワークフローの新規追加
  - Supabase の活性化に有効なエンドポイントへ、認証ヘッダ付きで読み取り専用リクエストを送ること
  - リクエストの HTTP ステータス・応答時間の記録、失敗時の運用者への通知
  - Keep-Alive が依存するシークレット（接続先 URL / 公開鍵）の構成要件
- **Out of scope**:
  - Edge Middleware の fail-fast 防御（PR #146 で実装済み・本機能では変更しない）
  - Supabase 有料プランへの移行（pause の根本解だがコストのため不採用、Free Tier 運用継続が前提）
  - Vercel Cron Job 上での実装（middleware 内 fetch の loop リスクを避け、外部 CI 側で完結させる）
  - アプリケーションコード・データベーススキーマ・本番データへの一切の書き込み変更
- **Adjacent expectations**:
  - 実行基盤（GitHub Actions）に、接続先 URL と公開鍵に相当するシークレットが事前登録されていること
  - Supabase Free Tier の pause タイマーが「外部からの API アクセスでリセットされる」という前提が成立すること（成立しない場合は本機能の有効性が無効化されるため、検証で確認する）
  - 障害発生時の被害最小化は別機能（PR #146 の fail-fast）が担い、本機能はそれと独立して pause 予防のみを担う

## Requirements

### Requirement 1: 定期的な自動 Keep-Alive 実行

**Objective:** 運用者として、Supabase の pause タイマーが満了する前に自動で活性化リクエストが送られてほしい。それにより、無操作期間が続いても本番が pause に陥らないようにするため。

#### Acceptance Criteria

1. The Keep-Alive ワークフロー shall pause タイマー（7 日）に対して最低 1〜2 日の余裕を確保できる周期（5 日以下の間隔）で自動的に起動する。
2. When スケジュールされた起動時刻に達した場合, the Keep-Alive ワークフロー shall 運用者の手動操作なしに活性化リクエストの送信ジョブを開始する。
3. While 直近の自動実行から次の pause タイマー満了までの猶予が確保されている状態, the Keep-Alive ワークフロー shall 次回の自動実行が確実にスケジュールされた状態を維持する。
4. The Keep-Alive ワークフロー shall 直前の main コミットや本番へのデプロイの有無に依存せず、無操作期間中であっても定期実行を継続する。

### Requirement 2: 手動 Keep-Alive 実行

**Objective:** 運用者として、必要なときに Keep-Alive を即時に手動実行したい。導入直後の動作確認や、障害復旧直後の即時 pause 予防を行うため。

#### Acceptance Criteria

1. Where 手動実行手段が提供されている場合, the Keep-Alive ワークフロー shall 運用者が任意のタイミングで実行を開始できる手段を提供する。
2. When 運用者が手動実行を起動した場合, the Keep-Alive ワークフロー shall 自動実行時と同一の活性化リクエスト処理を実行する。
3. When 手動実行が正常に完了した場合, the Keep-Alive ワークフロー shall 成功（green）として運用者が結果を確認できる状態にする。

### Requirement 3: Supabase への活性化リクエスト送信

**Objective:** 運用者として、pause タイマーのリセットに有効な形で Supabase へアクセスしてほしい。単に CI が green になるだけでなく、実際に Supabase 側が「アクセスあり」と認識する活性化を成立させるため。

#### Acceptance Criteria

1. When 活性化リクエストの送信ジョブが実行された場合, the Keep-Alive ワークフロー shall Supabase の稼働確認に有効なエンドポイントへ、公開鍵による認証情報を付与してリクエストを送信する。
2. The Keep-Alive ワークフロー shall 送信した各リクエストの HTTP ステータスコードと応答時間を実行ログに記録する。
3. When Supabase が正常応答を返した場合, the Keep-Alive ワークフロー shall 当該リクエストを成功として扱い、ジョブを正常終了させる。
4. The Keep-Alive ワークフロー shall 本番データベースおよびアプリケーションデータに対する書き込み・更新・削除を一切行わず、稼働確認に必要な読み取り相当のアクセスのみを行う。

### Requirement 4: 失敗検知と運用者への通知

**Objective:** 運用者として、Keep-Alive が失敗したら確実に気づきたい。pause 予防が機能していない状態を放置して再び 7 日 pause に陥ることを防ぐため。

#### Acceptance Criteria

1. If 活性化リクエストが非正常応答（接続失敗・タイムアウト・エラーステータス）を返した場合, then the Keep-Alive ワークフロー shall 当該実行を失敗（red）として終了する。
2. When 実行が失敗として終了した場合, the Keep-Alive ワークフロー shall 運用者が把握できる通知（実行基盤の標準的な失敗通知）を発生させる。
3. If 複数の活性化リクエストのうち一部でも非正常応答を返した場合, then the Keep-Alive ワークフロー shall その実行全体を失敗として扱う。
4. When 実行が失敗した場合, the Keep-Alive ワークフロー shall どのリクエストがどのステータス・応答で失敗したかを実行ログから追跡できる情報を残す。

### Requirement 5: シークレットと構成の管理

**Objective:** 運用者として、接続先や鍵を安全に構成したい。秘匿情報をコードに直書きせず、本番アプリと同一の接続先を参照してずれを防ぐため。

#### Acceptance Criteria

1. The Keep-Alive ワークフロー shall 接続先 URL と公開鍵を、リポジトリのソースコードに直接埋め込まず、実行基盤のシークレット機構から取得する。
2. The Keep-Alive ワークフロー shall 本番アプリが参照しているものと同一の Supabase プロジェクト URL および公開鍵に相当する値を参照する。
3. If 必要なシークレットが未設定または空である場合, then the Keep-Alive ワークフロー shall 活性化リクエストを成功扱いせず、失敗として運用者に検知可能な状態で終了する。
4. The Keep-Alive ワークフロー shall シークレットの値を実行ログに平文で出力しない。

### Requirement 6: 安全性・運用負荷・可観測性

**Objective:** 運用者として、Keep-Alive が運用上の害やノイズにならないことを保証したい。長時間ハングや過剰実行、不明瞭なログで運用負荷を増やさないため。

#### Acceptance Criteria

1. The Keep-Alive ワークフロー shall 1 回の実行に上限時間を設け、Supabase 無応答時でも実行が無期限にハングしない。
2. The Keep-Alive ワークフロー shall 本機能の追加によって本番アプリのリクエスト経路（middleware など）に新たな同期 fetch や処理を一切持ち込まない。
3. When 実行が完了した場合, the Keep-Alive ワークフロー shall 成功・失敗いずれの場合も、何に対してどの結果が得られたかを運用者が実行ログから判別できる出力を残す。
4. The Keep-Alive ワークフロー shall pause 予防に必要な最小限の頻度・リクエスト数で動作し、不要な高頻度実行を行わない。

### Requirement 7: pause 予防の有効性確認（DoD）

**Objective:** 運用者として、本機能が実際に pause を防げていることを確認したい。導入したつもりで再び障害が起きる事態を避けるため。

#### Acceptance Criteria

1. When ワークフローが運用基盤へ反映された後, the Keep-Alive ワークフロー shall 手動実行によって正常完了（green）することを確認できる。
2. While Keep-Alive が定期運用されている状態, the Supabase プロジェクト shall 無操作起因の自動 pause を発火させない。
3. When 一定期間（pause タイマー周期を複数回跨ぐ運用期間）が経過した場合, the 運用者 shall 本番がその間 pause に陥らなかったことを確認できる。
4. The Keep-Alive ワークフロー shall 自動実行（スケジュール起動）でも手動実行と同様に green となることを、後続の自動実行で確認できる。
