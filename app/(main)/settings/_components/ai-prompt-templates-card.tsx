import { FileText, Plus, Pencil, Trash2, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentSession } from "@/lib/supabase/server";
import { repos } from "@/lib/repositories";
import { formatDate } from "@/lib/utils/date";
import type { AiPromptTemplate } from "@/types/ai-prompt-template";

const MAX_TEMPLATES = 5;

export async function AiPromptTemplatesCard() {
  const session = await getCurrentSession();
  const templates: AiPromptTemplate[] = session
    ? await repos.promptTemplate.list(session.userId)
    : [];

  return (
    <Card>
      <Card.Header>
        <div>
          <Card.Title>AIプロンプトテンプレート</Card.Title>
          <p className="text-xs text-muted-foreground mt-0.5">
            現在 {templates.length} / {MAX_TEMPLATES} 件
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled
          title="次フェーズで実装予定"
          aria-label="新規作成（次フェーズで実装予定）"
        >
          <Plus className="h-4 w-4" />
          新規作成
        </Button>
      </Card.Header>

      <Card.Body className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          AI 店舗分析で使用する Few-shot 例を管理します。業種や自社のトーンに合わせた
          Few-shot を設定することで、分析結果をカスタマイズできます。
        </p>

        {session === null ? (
          <EmptyState
            icon={<FileText />}
            title="ログインするとテンプレートを管理できます"
            description="AI店舗分析で使うFew-shot例を、ユーザーごとに管理できるようになります。"
          />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="まだテンプレートはありません"
            description="テンプレート作成機能は次フェーズで実装予定です。"
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {templates.map((t) => (
              <TemplateRow key={t.id} template={t} />
            ))}
          </ul>
        )}
      </Card.Body>
    </Card>
  );
}

function TemplateRow({ template: t }: { template: AiPromptTemplate }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 bg-card">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{t.name}</span>
          {t.is_default && <Badge tone="success">デフォルト</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          更新: {formatDate(t.updated_at)}
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!t.is_default && (
          <Button
            size="sm"
            variant="ghost"
            disabled
            title="次フェーズで実装予定"
          >
            <Star className="h-3.5 w-3.5" />
            デフォルトにする
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled
          title="次フェーズで実装予定"
        >
          <Pencil className="h-3.5 w-3.5" />
          編集
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled
          title="次フェーズで実装予定"
          className="text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          削除
        </Button>
      </div>
    </li>
  );
}
