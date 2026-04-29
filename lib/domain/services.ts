export const SERVICE_OPTIONS = [
  "MEO",
  "HP",
  "インスタ",
  "動画",
  "Google広告",
  "おまかせ",
] as const;

export type ServiceOption = (typeof SERVICE_OPTIONS)[number];

export const SERVICE_PRICES: Record<ServiceOption, string> = {
  MEO: "初期11万円〜 / 月額3.3万円〜",
  HP: "竹プラン29.8万 / 松プラン45万〜",
  インスタ: "単発5.5万円 / 月額契約あり",
  動画: "ショート動画 1本3.3万円〜",
  "Google広告": "運用代行 月額5.5万円〜",
  おまかせ: "ヒアリング後に提案",
};
