"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { updateProfileRoleAction } from "@/lib/actions/profile-actions";
import type { Profile, ProfileRole } from "@/types/profile";

/**
 * ユーザー管理カードの client Shell (#155)。admin 判定は server 側
 * (user-management-card.tsx) 済み。認可の真の防御は Server Action の requireAdmin。
 *
 * - 各行の role を native <Select> で member↔admin 変更 → 即時 updateProfileRoleAction。
 * - 楽観更新: 選択値を即反映し (controlled select の revert ちらつき回避)、失敗時は戻す。
 * - 自分自身の admin→member のみ確認ダイアログを挟む (管理画面へのアクセスを失うため)。
 */

const ASSIGNABLE: readonly ProfileRole[] = ["member", "admin"];
const ROLE_LABEL: Record<string, string> = { member: "メンバー", admin: "管理者" };

export function UserManagementShell({
  users,
  currentUserId,
}: {
  users: readonly Profile[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [changingId, setChangingId] = useState<string | null>(null);
  // 楽観的な role 上書き。成功時は router.refresh() が prop を更新するまで保持、失敗時は削除。
  const [optimistic, setOptimistic] = useState<Record<string, ProfileRole>>({});
  // 自己降格の確認待ち対象。
  const [confirmSelfId, setConfirmSelfId] = useState<string | null>(null);

  const roleOf = (u: Profile): ProfileRole => optimistic[u.id] ?? u.role;

  const applyRole = (userId: string, role: ProfileRole) => {
    setOptimistic((prev) => ({ ...prev, [userId]: role }));
    setChangingId(userId);
    startTransition(async () => {
      const result = await updateProfileRoleAction(userId, role);
      if (result.ok) {
        toast.success(result.message ?? "ロールを更新しました");
        router.refresh();
      } else {
        toast.error(result.error);
        setOptimistic((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }
      setChangingId(null);
    });
  };

  const onSelect = (user: Profile, next: ProfileRole) => {
    if (!ASSIGNABLE.includes(next) || next === roleOf(user)) return;
    // 自分自身を管理者から外す時だけ確認を挟む。
    if (user.id === currentUserId && next === "member") {
      setConfirmSelfId(user.id);
      return;
    }
    applyRole(user.id, next);
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>ユーザー管理</Card.Title>
        <span className="text-sm text-muted-foreground">{users.length} 人</span>
      </Card.Header>
      <Card.Body>
        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          ログイン済みユーザーの権限を管理します。新規ログイン時は「メンバー」で登録されます。
          「管理者」は店舗・データの削除など破壊的操作を実行できます。
        </p>
        <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {users.map((u) => {
            const role = roleOf(u);
            const isSelf = u.id === currentUserId;
            return (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 bg-card"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {u.display_name}
                    </span>
                    {isSelf && <Badge tone="secondary">あなた</Badge>}
                  </div>
                  <span className="block text-xs text-muted-foreground truncate">
                    {u.email}
                  </span>
                </div>
                <Badge tone={role === "admin" ? "info" : "outline"}>
                  {ROLE_LABEL[role] ?? role}
                </Badge>
                <Select
                  value={role}
                  disabled={pending}
                  aria-label={`${u.display_name} のロール`}
                  className="w-32 text-foreground"
                  onChange={(e) => onSelect(u, e.target.value as ProfileRole)}
                >
                  <option value="member">メンバー</option>
                  <option value="admin">管理者</option>
                </Select>
              </li>
            );
          })}
        </ul>
      </Card.Body>

      <Modal
        open={confirmSelfId !== null}
        onOpenChange={(v) => {
          if (!v && changingId === null) setConfirmSelfId(null);
        }}
      >
        <ModalContent title="自分を管理者から外しますか?" size="sm">
          <p className="text-sm text-foreground leading-relaxed">
            あなた自身のロールを「メンバー」に変更します。以降、このユーザー管理画面や
            店舗・データの削除などの管理者操作は行えなくなります。
          </p>
          <ModalFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmSelfId(null)}
              disabled={pending}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                const id = confirmSelfId;
                setConfirmSelfId(null);
                if (id) applyRole(id, "member");
              }}
            >
              メンバーにする
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
}
