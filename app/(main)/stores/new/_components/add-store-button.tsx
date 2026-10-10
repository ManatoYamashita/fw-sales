"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runAction } from "@/lib/client/run-action";
import { addStoreFromPlaceAction } from "@/lib/actions/area-search-actions";

interface AddStoreButtonProps {
  placeId: string;
  placeName: string;
  isAdded: boolean;
  onAdded: (placeId: string) => void;
}

export function AddStoreButton({
  placeId,
  placeName,
  isAdded,
  onAdded,
}: AddStoreButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (isAdded) {
    return (
      <Badge tone="success" className="gap-1">
        <CheckCircle className="h-3 w-3" />
        追加済み
      </Badge>
    );
  }

  const handleClick = () => {
    startTransition(async () => {
      const result = await runAction(() => addStoreFromPlaceAction(placeId), {
        success: `「${placeName}」を追加しました`,
      });
      if (result?.ok) {
        onAdded(placeId);
        // 追加した店舗の詳細ページへ遷移 (トーストは遷移後も Toaster が表示する)。
        router.push(`/stores/${result.data.id}`);
      }
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      pending={isPending}
    >
      {isPending ? "追加中…" : "追加"}
    </Button>
  );
}
