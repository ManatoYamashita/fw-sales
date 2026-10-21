-- 店舗の契約連絡先メールアドレス (#384) の列だけを先に足す expand の migration です。アプリはまだこの列を知りません。
-- 既存の行と、列を知らない今のアプリが書く行は、既定値の空文字 (未登録) になります。
-- 定数の既定値付きの ADD COLUMN はテーブルを書き換えないため、既存データは変わりません。
--
-- `pnpm db:generate --custom` で作ったため、0033 の snapshot は 0032 と同じで、この列を含みません。
-- schema.ts と snapshot が一致したままなので、アプリに反映するまでの間に別件で db:generate を回しても
-- この列の DROP は生成されません。アプリへの反映 (#384 の後続 PR) で schema.ts に列を足すと
-- db:generate が同じ ADD COLUMN を再び作るため、その migration は `ADD COLUMN IF NOT EXISTS` に直します。
--
-- ADD COLUMN は stores の排他ロックを一瞬だけ取ります。長い処理がロックを持っていると、待つ間に後続の
-- 店舗の読み書きが列に並んでしまうため、待ちを 3 秒で打ち切ります。打ち切った場合は migration 全体が
-- ROLLBACK され、何も変わりません (Apply Migrations の失敗したジョブを再実行します)。
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "contact_email" text DEFAULT '' NOT NULL;
