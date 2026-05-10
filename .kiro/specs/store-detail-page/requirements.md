# Requirements Document

## Project Description (Input)

GitHub Issue: https://github.com/ManatoYamashita/fw-sales/issues/15

### 背景・目的

- **対象ユーザー**: 営業担当者(フリーザ軍の現場戦士)
- **現状**: 店舗一覧 (`/stores`) は存在するが、個別店舗の詳細を1画面で確認・編集する画面が存在しない。営業活動に必要な情報(基本情報・AI 分析結果・関連商談履歴)が分散しており、商談前の情報集約に時間がかかっている。
- **変えたいこと**: `/stores/[id]` 詳細画面を新規実装し、営業活動に必要な情報を一画面で確認・インライン編集できるようにする。エリア検索モード(別 Issue)からの動線終点としても機能させる。

### ゴール (Acceptance Criteria 抜粋)

- `/stores/[id]` ルート新規実装、店舗一覧から1行クリックで遷移
- 6セクション構成: ヘッダー / 基本情報 / AI 分析結果 / 営業活動履歴 / メモ / アクション
- 各セクション**インライン編集** (Q13-3: (b))、保存は Server Action 経由
- AI 分析結果セクションは **#13 の信頼度背景色グラデーション** を再利用
- 削除: **物理削除**、確認ダイアログ必須、関連 deals も**カスケード削除** (Q13-4)
- 削除権限: **全員可** (Q13-4)
- `[再調査]` 押下でエリア検索 Issue の調査ジョブを単発投入
- `[商談を追加]` で `/deals/new?store_id=[id]` 遷移
- 404: 存在しない id は Next.js の `notFound()` を返す

### スコープ

#### IN
- `/stores/[id]` ルートとページコンポーネント(Server Component)
- 6セクション構成のコンポーネント分割
- インライン編集(Client Component + Server Action)
- 関連 deals 一覧表示(`deal-repository` 既存 query 再利用)
- 削除確認ダイアログ + カスケード削除 Server Action
- Google Map 埋め込み(`lat` / `lng` がある場合のみ。エリア検索 Issue 前提)
- `/stores` 一覧から詳細への遷移リンク追加

#### OUT (別 Issue)
- 編集履歴 / 監査ログ
- 操作者ロール別の権限制御(認証実装に依存)
- AI 再分析の進捗バー(エリア検索 Issue のジョブ基盤に依存)
- 商談履歴のページネーション
- マップ操作(現状は埋め込み表示のみ)

### 主要な関連ファイル

| パス | 役割 | 変更要否 |
|---|---|---|
| `app/(main)/stores/[id]/page.tsx` | 詳細ページ Server Component | 新規 |
| `app/(main)/stores/[id]/_components/*.tsx` | 6セクションのコンポーネント群 | 新規 |
| `app/(main)/stores/page.tsx` | 一覧 → 行クリックで詳細遷移リンク | 変更 |
| `lib/actions/store-actions.ts` | `updateStoreFieldAction` / `deleteStoreCascadeAction` 追加 | 変更 |
| `lib/repositories/store-repository.ts` | `findById` / `updateField` / `deleteCascade` 追加 | 変更 |

### 依存関係

- **#13 (AI 店舗分析)** 完了後、AI 分析結果セクションが完全表示できる
- **エリア検索 Issue** 完了後、`lat` / `lng` カラム表示と `[再調査]` ボタンが完全動作
- 但し、本 Issue のタスク 1〜4 / 7 / 9 / 10 は両依存と無関係に並行着手可能

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
