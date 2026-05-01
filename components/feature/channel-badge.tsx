import { Mail, Phone, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Channel } from "@/types/store";

/**
 * 色数最小化の方針: チャネル種別はアイコンで識別、配色は全て outline (slate)
 */
export function ChannelBadge({ channel }: { channel: Channel }) {
  switch (channel) {
    case "DM推奨":
      return (
        <Badge tone="outline">
          <Mail className="h-3 w-3" aria-hidden /> DM推奨
        </Badge>
      );
    case "テレアポ推奨":
      return (
        <Badge tone="outline">
          <Phone className="h-3 w-3" aria-hidden /> テレアポ推奨
        </Badge>
      );
    case "要確認":
      return (
        <Badge tone="outline">
          <HelpCircle className="h-3 w-3" aria-hidden /> 要確認
        </Badge>
      );
    case "未判定":
    default:
      return <Badge tone="outline">未判定</Badge>;
  }
}
