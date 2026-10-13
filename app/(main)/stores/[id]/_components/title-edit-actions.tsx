import { Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 編集を終えたときにフォーカスを戻す先 (鉛筆ボタン) の id。 */
export const TITLE_EDIT_BUTTON_ID = "store_title_edit";

/**
 * 店舗タイトルの編集操作 (#321)。
 *
 * 表示中は鉛筆ボタン、編集中は同じ位置に「保存」「キャンセル」を出す。
 * 編集の開始と確定を同じ場所で行えるよう、両者を 1 つの差し替え点にまとめている。
 * 大きさは鉛筆ボタンと同じ `size="sm"` に揃え、見出し行の高さを変えない。
 */
export function TitleEditActions({
  editing,
  pending,
  onEdit,
  onSave,
  onCancel,
}: {
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!editing) {
    return (
      <Button
        id={TITLE_EDIT_BUTTON_ID}
        type="button"
        variant="ghost-muted"
        size="sm"
        onClick={onEdit}
        aria-label="店舗名・業態を編集"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </Button>
    );
  }
  return (
    <span
      role="group"
      aria-label="店舗名・業態の編集操作"
      className="inline-flex shrink-0 items-center gap-1"
    >
      <Button type="button" variant="primary" size="sm" onClick={onSave} pending={pending}>
        <Save className="h-3.5 w-3.5" aria-hidden />
        {pending ? "保存中…" : "保存"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
        <X className="h-3.5 w-3.5" aria-hidden />
        キャンセル
      </Button>
    </span>
  );
}
