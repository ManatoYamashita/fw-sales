import type { Store } from "@/types/store";
import type { Research } from "@/types/research";
import type { Deal } from "@/types/deal";
import type { Handoff } from "@/types/handoff";
import type { Profile } from "@/types/profile";
import { daysAgo } from "@/lib/utils/date";

/**
 * Mock 経路 / dev 環境で固定 mock profile として注入される uuid。
 *
 * design.md §Decision D-4 (Mock バイパス) で middleware / `getCurrentSession()` /
 * `getCurrentProfile()` が `USE_MOCK_DB=true` 時にこの ID を返すバイパスを実装する。
 * Phase 3.1 / 3.3 でこの定数を import して固定セッション化している。
 */
export const PLACEHOLDER_DEV_PROFILE_ID =
  "00000000-0000-0000-0000-000000000001";

/**
 * 既存の `assigned_*` text 値 (担当者名) と対応する mock プロフィール uuid。
 * Phase 6.3 で SEED_STORES / SEED_DEALS / SEED_HANDOFFS の担当者参照を埋める際に使用。
 *
 * 旧 `lib/domain/staff.ts` の PLANNERS / SALES / OPS_MEMBERS を仮想的にマップ:
 *   - 佐藤 (PLANNERS / SALES) ← PLACEHOLDER_DEV_PROFILE_ID (dev 用兼任)
 *   - 渡部 (SALES) ← MOCK_WATABE_PROFILE_ID
 *   - 田中 (PLANNERS) ← MOCK_TANAKA_PROFILE_ID
 */
export const MOCK_WATABE_PROFILE_ID = "00000000-0000-0000-0000-000000000002";
export const MOCK_TANAKA_PROFILE_ID = "00000000-0000-0000-0000-000000000003";

/**
 * バックフィルで生成される placeholder プロフィールの動作確認用サンプル。
 * 実バックフィル時は `scripts/backfill-assignees.ts` が同形式で動的生成する。
 */
export const MOCK_PLACEHOLDER_EXAMPLE_ID =
  "00000000-0000-0000-0000-000000000099";

/**
 * Mock 経路の初期プロフィール。
 *
 * - 3 件の member プロフィール (佐藤 = dev 兼任 / 渡部 / 田中)
 * - 1 件の placeholder (バックフィル動作確認用)
 *
 * email が `@local.invalid` で終わるため `EmailClient.send()` の placeholder 保護
 * (no-op フォールバック) の対象となり、dev 環境で誤って実メールが送られない。
 */
export const SEED_PROFILES: readonly Profile[] = [
  {
    id: PLACEHOLDER_DEV_PROFILE_ID,
    email: "dev@local.invalid",
    display_name: "佐藤",
    avatar_url: null,
    role: "member",
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
  },
  {
    id: MOCK_WATABE_PROFILE_ID,
    email: "watabe-dev@local.invalid",
    display_name: "渡部",
    avatar_url: null,
    role: "member",
    created_at: daysAgo(28),
    updated_at: daysAgo(28),
  },
  {
    id: MOCK_TANAKA_PROFILE_ID,
    email: "tanaka-dev@local.invalid",
    display_name: "田中",
    avatar_url: null,
    role: "member",
    created_at: daysAgo(25),
    updated_at: daysAgo(25),
  },
  {
    id: MOCK_PLACEHOLDER_EXAMPLE_ID,
    email: "placeholder-yamada@local.invalid",
    display_name: "山田",
    avatar_url: null,
    role: "placeholder",
    created_at: daysAgo(7),
    updated_at: daysAgo(7),
  },
];

export const SEED_STORES: readonly Store[] = [
  {
    id: "store_001",
    name: "導楽",
    prefecture: "神奈川県",
    city: "川崎市中原区",
    address: "新丸子駅周辺",
    genre: "居酒屋",
    priority: "高",
    stage: "調査完了",
    map_url: "https://maps.google.com/?q=導楽+新丸子",
    site_url: "",
    instagram_url: "",
    phone: "",
    has_contact_form: "なし",
    channel: "テレアポ推奨",
    target_service: "MEO,HP",
    memo:
      "食べログURL: https://tabelog.com/kanagawa/A1405/A140504/14096697/\nお刺身評価高いが情報発信弱い。公式サイト・Instagram確認できず。",
    assigned_planner_user_id: PLACEHOLDER_DEV_PROFILE_ID,
    assigned_sales_user_id: MOCK_WATABE_PROFILE_ID,
    review_count: 12,
    review_avg: 3.4,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: 35.5836,
    lng: 139.6571,
    business_hours: "17:30-23:30 / 日休",
    google_place_id: null,
    created_at: daysAgo(3),
    updated_at: daysAgo(1),
  },
  {
    id: "store_002",
    name: "CAFE VERDE",
    prefecture: "東京都",
    city: "世田谷区",
    address: "三軒茶屋2-14-5",
    genre: "カフェ",
    priority: "中",
    stage: "一次接触準備",
    map_url: "https://maps.google.com/?q=CAFE+VERDE+三軒茶屋",
    site_url: "https://example.com/cafeverde",
    instagram_url: "https://instagram.com/cafeverde",
    phone: "03-XXXX-XXXX",
    has_contact_form: "あり",
    channel: "DM推奨",
    target_service: "MEO,インスタ",
    memo:
      "公式サイトに問い合わせフォームあり。Instagram開設済みだが更新3ヶ月停止。",
    assigned_planner_user_id: PLACEHOLDER_DEV_PROFILE_ID,
    assigned_sales_user_id: MOCK_WATABE_PROFILE_ID,
    review_count: 28,
    review_avg: 3.8,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: 35.6432,
    lng: 139.6709,
    business_hours: "11:00-22:00 / 月休",
    google_place_id: null,
    created_at: daysAgo(5),
    updated_at: daysAgo(2),
  },
  {
    id: "store_003",
    name: "炭火焼鳥 鶴丸",
    prefecture: "神奈川県",
    city: "横浜市港北区",
    address: "日吉本町1-2-3",
    genre: "その他",
    priority: "高",
    stage: "商談化",
    map_url: "https://maps.google.com/?q=炭火焼鳥鶴丸+日吉",
    site_url: "",
    instagram_url: "",
    phone: "045-XXX-XXXX",
    has_contact_form: "なし",
    channel: "テレアポ推奨",
    target_service: "MEO,HP,動画",
    memo:
      "電話のみ。Googleマップの写真が古い。口コミ返信ゼロ。オーナーは集客に困っていると推測。",
    assigned_planner_user_id: PLACEHOLDER_DEV_PROFILE_ID,
    assigned_sales_user_id: MOCK_WATABE_PROFILE_ID,
    review_count: 45,
    review_avg: 4.1,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: 35.5526,
    lng: 139.6469,
    business_hours: "18:00-24:00 / 日祝休",
    google_place_id: null,
    created_at: daysAgo(8),
    updated_at: daysAgo(1),
  },
  {
    id: "store_004",
    name: "らーめん 心",
    prefecture: "東京都",
    city: "大田区",
    address: "蒲田5-8-11",
    genre: "ラーメン",
    priority: "低",
    stage: "調査待ち",
    map_url: "",
    site_url: "",
    instagram_url: "",
    phone: "03-XXXX-XXXX",
    has_contact_form: "未確認",
    channel: "未判定",
    target_service: "おまかせ",
    memo: "紹介案件。詳細調査未着手。",
    assigned_planner_user_id: null,
    assigned_sales_user_id: null,
    review_count: 8,
    review_avg: 3.9,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: null,
    lng: null,
    business_hours: "",
    google_place_id: null,
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
  },
  {
    id: "store_005",
    name: "トラットリア SOLE",
    prefecture: "東京都",
    city: "目黒区",
    address: "中目黒1-5-8",
    genre: "イタリアン",
    priority: "中",
    stage: "受注",
    map_url: "https://maps.google.com/?q=トラットリアSOLE+中目黒",
    site_url: "https://example.com/sole",
    instagram_url: "https://instagram.com/trattoriasole",
    phone: "03-XXXX-XXXX",
    has_contact_form: "あり",
    channel: "DM推奨",
    target_service: "HP,MEO,インスタ",
    memo:
      "受注済み。HP制作+MEO+Instagram指南 セット。初期費用398,000円+月額22,000円。",
    assigned_planner_user_id: PLACEHOLDER_DEV_PROFILE_ID,
    assigned_sales_user_id: PLACEHOLDER_DEV_PROFILE_ID,
    review_count: 63,
    review_avg: 4.3,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: 35.6444,
    lng: 139.6985,
    business_hours: "11:30-15:00 / 17:30-23:00",
    google_place_id: null,
    created_at: daysAgo(14),
    updated_at: daysAgo(0),
  },
];

export const SEED_RESEARCH: readonly Research[] = [
  {
    id: "res_001",
    store_id: "store_001",
    store_name: "導楽",
    total_review: "食べログ3.4点 / 12件 | 口コミ返信なし",
    strength1: "お刺身の鮮度・品質が高い(複数口コミで言及)",
    strength2: "雰囲気が良く居心地の良さを評価するコメントあり",
    strength3: "常連客に支持されている地元密着型店舗",
    weakness1: "コスパへの不満が複数口コミで指摘(「コスパは…」)",
    weakness2: "公式サイト・Instagramが存在しない(情報ゼロ)",
    weakness3: "Googleマップ情報が不完全・写真不足・口コミ返信ゼロ",
    review_positive:
      "「お刺身おいしい」「魚料理が新鮮」「雰囲気が良い」「常連でよく行く」",
    review_negative:
      "「コスパが微妙」「値段の割に量が少ない」「情報が少なくて行きづらい」",
    meo_gap:
      "Googleマップ情報不完全。写真不足。口コミ返信ゼロ。上位表示の余地大。",
    hp_gap:
      "公式サイトなし。料金・メニュー・アクセスが検索から見えない状態。",
    instagram_gap:
      "Instagram未開設。お刺身・料理写真の映えポテンシャルあり。",
    channel: "テレアポ推奨",
    channel_reason:
      "公式サイト・問い合わせフォームが存在しない。電話番号が唯一の接触窓口。",
    sales_hook:
      "「お刺身の評判は高いのに、ネット上での情報発信が弱く、新規客が来づらい状態です。Googleマップ整備とHP作成で新規来店数を増やせます。」",
    entry_product: "MEO対策(初期費用11万円〜)",
    main_product: "HP制作(竹プラン29.8万)+MEO月額運用セット",
    researcher: "佐藤",
    status: "完了",
    created_at: daysAgo(2),
    updated_at: daysAgo(1),
  },
  {
    id: "res_002",
    store_id: "store_002",
    store_name: "CAFE VERDE",
    total_review: "食べログ3.8点 / 28件 | 口コミ返信あり",
    strength1: "おしゃれな内装・写真映えする空間として評価",
    strength2: "スイーツやドリンクメニューが豊富で評価高い",
    strength3: "Instagramアカウント開設済み(素地はある)",
    weakness1: "Instagram更新が3ヶ月以上止まっている",
    weakness2: "Googleマップの投稿写真が古く店の現状が伝わらない",
    weakness3: "ランチ情報がネット上で弱く集客機会ロスの可能性",
    review_positive:
      "「インスタ映え」「雰囲気最高」「スイーツがおいしい」「落ち着ける」",
    review_negative:
      "「更新が少なくて最新情報が分からない」「座席少なくて待つことある」",
    meo_gap:
      "Googleマップ写真の更新が必要。投稿写真の品質改善で集客向上余地あり。",
    hp_gap: "公式サイトはあるが更新が少ない。ランチメニューの掲載が不十分。",
    instagram_gap:
      "アカウントはあるが3ヶ月更新停止。再起動・動画活用で認知拡大余地大。",
    channel: "DM推奨",
    channel_reason:
      "公式サイトに問い合わせフォームあり。メール経由での非同期接触が有効。",
    sales_hook:
      "「Instagramが止まっているのが一番もったいないです。映える空間があるのに発信できていない。月額プランで代行再開できます。」",
    entry_product: "Instagram運用指南(5.5万円単発)",
    main_product: "MEO月額+Instagram定期支援セット",
    researcher: "佐藤",
    status: "完了",
    created_at: daysAgo(4),
    updated_at: daysAgo(2),
  },
];

export const SEED_DEALS: readonly Deal[] = [
  {
    id: "deal_001",
    store_id: "store_003",
    store_name: "炭火焼鳥 鶴丸",
    date: daysAgo(2),
    meeting_type: "対面",
    discussion:
      "オーナーと初回商談。開業2年で新規客が減っているとのこと。Googleマップは登録しているが写真・情報が古いまま。予算は月2〜3万で考えている。前向き。",
    proposal: "MEO対策(初期+月額)+ショート動画3本セット",
    estimate_amount: 110000,
    order_amount: null,
    lost_reason: "",
    status: "見積提出",
    assigned_sales_user_id: MOCK_WATABE_PROFILE_ID,
    created_at: daysAgo(2),
    updated_at: daysAgo(1),
  },
  {
    id: "deal_002",
    store_id: "store_005",
    store_name: "トラットリア SOLE",
    date: daysAgo(10),
    meeting_type: "オンライン",
    discussion:
      "開業1年目。口コミは良いがHPがなく、予約はInstagramのDMだけ。HP作成とMEOとインスタ整備を全部まとめてやりたいとのこと。",
    proposal: "HP松プラン(撮影あり)+MEOセット+Instagram指南",
    estimate_amount: 453000,
    order_amount: 453000,
    lost_reason: "",
    status: "受注",
    assigned_sales_user_id: PLACEHOLDER_DEV_PROFILE_ID,
    created_at: daysAgo(10),
    updated_at: daysAgo(0),
  },
];

export const SEED_HANDOFFS: readonly Handoff[] = [
  {
    id: "hand_001",
    store_id: "store_005",
    store_name: "トラットリア SOLE",
    deal_id: "deal_002",
    contract_services:
      "HP制作(松プラン・撮影あり)、MEO対策(初期+月額)、Instagram運用指南",
    initial_fee: 453000,
    monthly_fee: 22000,
    contract_period: "1年(自動更新)",
    expected_result: "Googleマップ上位表示、新規来店月20件増、Instagram再起動",
    contract_owner: "佐藤(Firstweb)",
    caution:
      "オーナーの山田さんはSNS不慣れ。初回説明は丁寧に。撮影日は土曜日のみ可。",
    ng_items: "SNS上での競合他社の名前出しNG。価格交渉の話は社長に戻すこと。",
    due_date: "2026-05-15",
    materials_status: "写真素材・ロゴはオーナー提供予定。撮影は2026-04-20予定。",
    ops_assignee: "小泉",
    contract_date: daysAgo(0),
    payment_confirmed: daysAgo(0),
    status: "完了",
    created_at: daysAgo(0),
    updated_at: daysAgo(0),
  },
];
