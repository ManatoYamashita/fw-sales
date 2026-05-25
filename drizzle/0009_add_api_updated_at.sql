-- Deep Research ジョブ進行状況把握機能 (Issue #43 follow-up)
-- Google API の Interaction.updated 値を保存し、 最終更新時刻を UI に表示する。
-- 既存列への変更ゼロ。 既存行は NULL。

ALTER TABLE "research_jobs"
  ADD COLUMN "api_updated_at" timestamp with time zone;
