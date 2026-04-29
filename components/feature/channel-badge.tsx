import { Mail, Phone, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Channel } from "@/types/store";

export function ChannelBadge({ channel }: { channel: Channel }) {
  switch (channel) {
    case "DM推奨":
      return (
        <Badge tone="blue">
          <Mail className="h-3 w-3" /> DM推奨
        </Badge>
      );
    case "テレアポ推奨":
      return (
        <Badge tone="cyan">
          <Phone className="h-3 w-3" /> テレアポ推奨
        </Badge>
      );
    case "要確認":
      return (
        <Badge tone="amber">
          <HelpCircle className="h-3 w-3" /> 要確認
        </Badge>
      );
    case "未判定":
    default:
      return <Badge tone="neutral">未判定</Badge>;
  }
}
