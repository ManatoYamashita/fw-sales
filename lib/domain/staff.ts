export const PLANNERS = ["佐藤", "田中"] as const;
export const SALES = ["佐藤", "渡部"] as const;
export const OPS_MEMBERS = ["小泉", "山本"] as const;

export type Planner = (typeof PLANNERS)[number];
export type Sales = (typeof SALES)[number];
export type OpsMember = (typeof OPS_MEMBERS)[number];

// 佐藤を「現在ログイン中ユーザー」として扱う(認証は将来導入)
export const CURRENT_USER = {
  name: "佐藤",
  role: "代表",
} as const;
