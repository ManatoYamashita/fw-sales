"use client";

import { useTransition } from "react";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { addStoreFromPlaceAction } from "@/lib/actions/area-search-actions";
import type { PlaceResult } from "@/lib/places/types";

interface AddStoreButtonProps {
  place: PlaceResult;
  isAdded: boolean;
  onAdded: (placeId: string) => void;
}

export function AddStoreButton({ place, isAdded, onAdded }: AddStoreButtonProps) {
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
      const result = await addStoreFromPlaceAction(place);
      if (result.ok) {
        onAdded(place.placeId);
        toast.success(result.message ?? `「${place.name}」を追加しました`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "追加中…" : "追加"}
    </Button>
  );
}
