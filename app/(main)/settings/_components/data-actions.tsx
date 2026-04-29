"use client";

import { useTransition, type ChangeEvent } from "react";
import { Download, Upload, RotateCcw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { useState } from "react";
import {
  clearAllAction,
  importJsonAction,
  resetToSeedAction,
} from "@/lib/actions/data-actions";
import { toast } from "@/components/ui/toast";

export function DataActions() {
  const [resetOpen, setResetOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    startTransition(async () => {
      const r = await resetToSeedAction();
      if (r.ok) toast.success(r.message ?? "リセットしました");
      else toast.error(r.error);
      setResetOpen(false);
    });
  };

  const clearAll = () => {
    startTransition(async () => {
      const r = await clearAllAction();
      if (r.ok) toast.warn(r.message ?? "全データを削除しました");
      else toast.error(r.error);
      setClearOpen(false);
    });
  };

  const importFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const r = await importJsonAction(null, formData);
      if (r.ok) toast.success(r.message ?? "インポートしました");
      else toast.error(r.error);
      e.target.value = "";
    });
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>データ管理</Card.Title>
      </Card.Header>
      <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <a
          href="/api/export"
          className="inline-flex items-center justify-center gap-2 h-11 rounded-lg border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50"
          download
        >
          <Download className="h-4 w-4" />
          JSON エクスポート
        </a>

        <label className="inline-flex items-center justify-center gap-2 h-11 rounded-lg border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50 cursor-pointer">
          <Upload className="h-4 w-4" />
          JSON インポート
          <input
            type="file"
            accept="application/json,.json"
            onChange={importFile}
            disabled={pending}
            className="sr-only"
          />
        </label>

        <Modal open={resetOpen} onOpenChange={setResetOpen}>
          <Button
            variant="outline"
            onClick={() => setResetOpen(true)}
            className="h-11"
          >
            <RotateCcw className="h-4 w-4" />
            シードデータに戻す
          </Button>
          <ModalContent title="シードデータにリセット" size="sm">
            <p className="text-sm text-slate-700">
              現在のデータをすべて破棄し、初期サンプルデータに戻します。
              この操作は元に戻せません。
            </p>
            <ModalFooter>
              <Button
                variant="ghost"
                onClick={() => setResetOpen(false)}
                disabled={pending}
              >
                キャンセル
              </Button>
              <Button variant="primary" onClick={reset} disabled={pending}>
                {pending ? "処理中…" : "リセット"}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Modal open={clearOpen} onOpenChange={setClearOpen}>
          <Button
            variant="ghost"
            onClick={() => setClearOpen(true)}
            className="h-11 text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            全データを削除
          </Button>
          <ModalContent title="全データを削除" size="sm">
            <p className="text-sm text-slate-700">
              すべての店舗・調査・商談・引き継ぎを削除します。
              復元はインポートからのみ可能です。
            </p>
            <ModalFooter>
              <Button
                variant="ghost"
                onClick={() => setClearOpen(false)}
                disabled={pending}
              >
                キャンセル
              </Button>
              <Button variant="danger" onClick={clearAll} disabled={pending}>
                {pending ? "削除中…" : "削除する"}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </Card.Body>
    </Card>
  );
}
