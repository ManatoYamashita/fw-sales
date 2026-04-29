import type { Channel, ContactForm } from "@/types/store";

/**
 * 問い合わせフォームの有無からチャネルを推定する純関数。
 * - あり → DM推奨(非同期接触)
 * - なし → テレアポ推奨(電話のみが窓口)
 * - 未確認 → 要確認(オペレーター判断が必要)
 */
export function decideChannel(contactForm: ContactForm): Channel {
  switch (contactForm) {
    case "あり":
      return "DM推奨";
    case "なし":
      return "テレアポ推奨";
    case "未確認":
      return "要確認";
    default:
      return "未判定";
  }
}

export function channelReasonFor(channel: Channel): string {
  switch (channel) {
    case "DM推奨":
      return "公式サイトに問い合わせフォームあり。メール経由の非同期接触が有効。";
    case "テレアポ推奨":
      return "問い合わせフォームが存在しない。電話番号が唯一の接触窓口。";
    case "要確認":
      return "問い合わせフォームの有無が未確認。手動で再調査が必要。";
    case "未判定":
      return "判定材料が不足。基本情報の追加調査が必要。";
  }
}
