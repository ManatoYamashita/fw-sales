// =============================================
// Firstweb Lead OS — Data Store
// ver 1.0  (2026-04-07)
//
// 【手直しガイド】
//   ■ サンプルデータを変えたい → SEEDS セクション（L30〜）
//   ■ ステージ名を変えたい    → STAGES 配列（L280〜）
//   ■ 担当者を追加したい      → actions.js の select 要素
//   ■ 商材を追加したい        → app.js の initServiceCheckboxes
// =============================================

// ---- ユーティリティ ----
function generateId() {
  return 'fw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}
function today() {
  return new Date().toISOString().split('T')[0];
}
function formatDate(str) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    if (isNaN(d)) return str;
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  } catch { return str; }
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// =============================================
// SEEDS — 初期サンプルデータ
// （初回起動時 or ストレージ空のときのみ投入）
// =============================================
const SEED_STORES = [
  {
    id: 'store_001',
    name: '導楽',
    prefecture: '神奈川県',
    city: '川崎市中原区',
    address: '新丸子駅周辺',
    genre: '居酒屋',
    priority: '高',
    stage: '調査完了',
    map_url: 'https://maps.google.com/?q=導楽+新丸子',
    site_url: '',
    instagram_url: '',
    phone: '',
    has_contact_form: 'なし',
    channel: 'テレアポ推奨',
    target_service: 'MEO,HP',
    memo: '食べログURL: https://tabelog.com/kanagawa/A1405/A140504/14096697/\nお刺身評価高いが情報発信弱い。公式サイト・Instagram確認できず。',
    assigned_planner: '佐藤',
    assigned_sales: '渡部',
    review_count: 12,
    review_avg: 3.4,
    created_at: daysAgo(3),
    updated_at: daysAgo(1)
  },
  {
    id: 'store_002',
    name: 'CAFE VERDE',
    prefecture: '東京都',
    city: '世田谷区',
    address: '三軒茶屋2-14-5',
    genre: 'カフェ',
    priority: '中',
    stage: '一次接触準備',
    map_url: 'https://maps.google.com/?q=CAFE+VERDE+三軒茶屋',
    site_url: 'https://example.com/cafeverde',
    instagram_url: 'https://instagram.com/cafeverde',
    phone: '03-XXXX-XXXX',
    has_contact_form: 'あり',
    channel: 'DM推奨',
    target_service: 'MEO,インスタ',
    memo: '公式サイトに問い合わせフォームあり。Instagram開設済みだが更新3ヶ月停止。',
    assigned_planner: '佐藤',
    assigned_sales: '渡部',
    review_count: 28,
    review_avg: 3.8,
    created_at: daysAgo(5),
    updated_at: daysAgo(2)
  },
  {
    id: 'store_003',
    name: '炭火焼鳥 鶴丸',
    prefecture: '神奈川県',
    city: '横浜市港北区',
    address: '日吉本町1-2-3',
    genre: 'その他',
    priority: '高',
    stage: '商談化',
    map_url: 'https://maps.google.com/?q=炭火焼鳥鶴丸+日吉',
    site_url: '',
    instagram_url: '',
    phone: '045-XXX-XXXX',
    has_contact_form: 'なし',
    channel: 'テレアポ推奨',
    target_service: 'MEO,HP,動画',
    memo: '電話のみ。Googleマップの写真が古い。口コミ返信ゼロ。オーナーは集客に困っていると推測。',
    assigned_planner: '佐藤',
    assigned_sales: '渡部',
    review_count: 45,
    review_avg: 4.1,
    created_at: daysAgo(8),
    updated_at: daysAgo(1)
  },
  {
    id: 'store_004',
    name: 'らーめん 心',
    prefecture: '東京都',
    city: '大田区',
    address: '蒲田5-8-11',
    genre: 'ラーメン',
    priority: '低',
    stage: '調査待ち',
    map_url: '',
    site_url: '',
    instagram_url: '',
    phone: '03-XXXX-XXXX',
    has_contact_form: '未確認',
    channel: '未判定',
    target_service: 'おまかせ',
    memo: '紹介案件。詳細調査未着手。',
    assigned_planner: '',
    assigned_sales: '',
    review_count: 8,
    review_avg: 3.9,
    created_at: daysAgo(1),
    updated_at: daysAgo(1)
  },
  {
    id: 'store_005',
    name: 'トラットリア SOLE',
    prefecture: '東京都',
    city: '目黒区',
    address: '中目黒1-5-8',
    genre: 'イタリアン',
    priority: '中',
    stage: '受注',
    map_url: 'https://maps.google.com/?q=トラットリアSOLE+中目黒',
    site_url: 'https://example.com/sole',
    instagram_url: 'https://instagram.com/trattoriasole',
    phone: '03-XXXX-XXXX',
    has_contact_form: 'あり',
    channel: 'DM推奨',
    target_service: 'HP,MEO,インスタ',
    memo: '受注済み。HP制作+MEO+Instagram指南 セット。初期費用398,000円+月額22,000円。',
    assigned_planner: '佐藤',
    assigned_sales: '佐藤',
    review_count: 63,
    review_avg: 4.3,
    created_at: daysAgo(14),
    updated_at: daysAgo(0)
  }
];

const SEED_RESEARCH = [
  {
    id: 'res_001',
    store_id: 'store_001',
    store_name: '導楽',
    total_review: '食べログ3.4点 / 12件 | 口コミ返信なし',
    strength1: 'お刺身の鮮度・品質が高い（複数口コミで言及）',
    strength2: '雰囲気が良く居心地の良さを評価するコメントあり',
    strength3: '常連客に支持されている地元密着型店舗',
    weakness1: 'コスパへの不満が複数口コミで指摘（「コスパは…」）',
    weakness2: '公式サイト・Instagramが存在しない（情報ゼロ）',
    weakness3: 'Googleマップ情報が不完全・写真不足・口コミ返信ゼロ',
    review_positive: '「お刺身おいしい」「魚料理が新鮮」「雰囲気が良い」「常連でよく行く」',
    review_negative: '「コスパが微妙」「値段の割に量が少ない」「情報が少なくて行きづらい」',
    meo_gap: 'Googleマップ情報不完全。写真不足。口コミ返信ゼロ。上位表示の余地大。',
    hp_gap: '公式サイトなし。料金・メニュー・アクセスが検索から見えない状態。',
    instagram_gap: 'Instagram未開設。お刺身・料理写真の映えポテンシャルあり。',
    channel: 'テレアポ推奨',
    channel_reason: '公式サイト・問い合わせフォームが存在しない。電話番号が唯一の接触窓口。',
    sales_hook: '「お刺身の評判は高いのに、ネット上での情報発信が弱く、新規客が来づらい状態です。Googleマップ整備とHP作成で新規来店数を増やせます。」',
    entry_product: 'MEO対策（初期費用11万円〜）',
    main_product: 'HP制作（竹プラン29.8万）＋MEO月額運用セット',
    researcher: '佐藤',
    status: '完了',
    created_at: daysAgo(2),
    updated_at: daysAgo(1)
  },
  {
    id: 'res_002',
    store_id: 'store_002',
    store_name: 'CAFE VERDE',
    total_review: '食べログ3.8点 / 28件 | 口コミ返信あり',
    strength1: 'おしゃれな内装・写真映えする空間として評価',
    strength2: 'スイーツやドリンクメニューが豊富で評価高い',
    strength3: 'Instagramアカウント開設済み（素地はある）',
    weakness1: 'Instagram更新が3ヶ月以上止まっている',
    weakness2: 'Googleマップの投稿写真が古く店の現状が伝わらない',
    weakness3: 'ランチ情報がネット上で弱く集客機会ロスの可能性',
    review_positive: '「インスタ映え」「雰囲気最高」「スイーツがおいしい」「落ち着ける」',
    review_negative: '「更新が少なくて最新情報が分からない」「座席少なくて待つことある」',
    meo_gap: 'Googleマップ写真の更新が必要。投稿写真の品質改善で集客向上余地あり。',
    hp_gap: '公式サイトはあるが更新が少ない。ランチメニューの掲載が不十分。',
    instagram_gap: 'アカウントはあるが3ヶ月更新停止。再起動・動画活用で認知拡大余地大。',
    channel: 'DM推奨',
    channel_reason: '公式サイトに問い合わせフォームあり。メール経由での非同期接触が有効。',
    sales_hook: '「Instagramが止まっているのが一番もったいないです。映える空間があるのに発信できていない。月額プランで代行再開できます。」',
    entry_product: 'Instagram運用指南（5.5万円単発）',
    main_product: 'MEO月額＋Instagram定期支援セット',
    researcher: '佐藤',
    status: '完了',
    created_at: daysAgo(4),
    updated_at: daysAgo(2)
  }
];

const SEED_DEALS = [
  {
    id: 'deal_001',
    store_id: 'store_003',
    store_name: '炭火焼鳥 鶴丸',
    date: daysAgo(2),
    meeting_type: '対面',
    discussion: 'オーナーと初回商談。開業2年で新規客が減っているとのこと。Googleマップは登録しているが写真・情報が古いまま。予算は月2〜3万で考えている。前向き。',
    proposal: 'MEO対策（初期+月額）＋ショート動画3本セット',
    estimate_amount: 110000,
    order_amount: null,
    lost_reason: '',
    status: '見積提出',
    assigned_sales: '渡部',
    created_at: daysAgo(2),
    updated_at: daysAgo(1)
  },
  {
    id: 'deal_002',
    store_id: 'store_005',
    store_name: 'トラットリア SOLE',
    date: daysAgo(10),
    meeting_type: 'オンライン',
    discussion: '開業1年目。口コミは良いがHPがなく、予約はInstagramのDMだけ。HP作成とMEOとインスタ整備を全部まとめてやりたいとのこと。',
    proposal: 'HP松プラン（撮影あり）＋MEOセット＋Instagram指南',
    estimate_amount: 453000,
    order_amount: 453000,
    lost_reason: '',
    status: '受注',
    assigned_sales: '佐藤',
    created_at: daysAgo(10),
    updated_at: daysAgo(0)
  }
];

const SEED_HANDOFFS = [
  {
    id: 'hand_001',
    store_id: 'store_005',
    store_name: 'トラットリア SOLE',
    deal_id: 'deal_002',
    contract_services: 'HP制作（松プラン・撮影あり）、MEO対策（初期+月額）、Instagram運用指南',
    initial_fee: 453000,
    monthly_fee: 22000,
    contract_period: '1年（自動更新）',
    expected_result: 'Googleマップ上位表示、新規来店月20件増、Instagram再起動',
    contract_owner: '佐藤（Firstweb）',
    caution: 'オーナーの山田さんはSNS不慣れ。初回説明は丁寧に。撮影日は土曜日のみ可。',
    ng_items: 'SNS上での競合他社の名前出しNG。価格交渉の話は社長に戻すこと。',
    due_date: '2026-05-15',
    materials_status: '写真素材・ロゴはオーナー提供予定。撮影は2026-04-20予定。',
    ops_assignee: '小泉',
    contract_date: daysAgo(0),
    payment_confirmed: daysAgo(0),
    status: '完了',
    created_at: daysAgo(0),
    updated_at: daysAgo(0)
  }
];

// =============================================
// STAGES — パイプラインステージ定義
// 【手直し】ステージを追加・変更する場合はここを編集
// =============================================
const STAGES = [
  { id: '調査待ち',      label: '調査待ち',      color: '#94a3b8', bg: '#f1f5f9' },
  { id: '調査完了',      label: '調査完了',      color: '#7c3aed', bg: '#ede9fe' },
  { id: '一次接触準備',  label: '一次接触準備',  color: '#d97706', bg: '#fef3c7' },
  { id: 'DM送信済み',    label: 'DM送信済み',    color: '#2563eb', bg: '#dbeafe' },
  { id: 'テレアポ済み',  label: 'テレアポ済み',  color: '#0891b2', bg: '#cffafe' },
  { id: '反応あり',      label: '反応あり',      color: '#16a34a', bg: '#dcfce7' },
  { id: '商談化',        label: '商談化',        color: '#15803d', bg: '#bbf7d0' },
  { id: '見積提出',      label: '見積提出',      color: '#f59e0b', bg: '#fde68a' },
  { id: '失注',          label: '失注',          color: '#dc2626', bg: '#fee2e2' },
  { id: '受注',          label: '受注',          color: '#166534', bg: '#86efac' },
  { id: '引き継ぎ待ち',  label: '引き継ぎ待ち',  color: '#9a3412', bg: '#fed7aa' },
  { id: '引き継ぎ完了',  label: '引き継ぎ完了',  color: '#475569', bg: '#e2e8f0' }
];

// =============================================
// STORAGE — localStorage 永続化レイヤー
// キー名: 'fw_lead_os_v1'
// =============================================
const STORAGE_KEY = 'fw_lead_os_v1';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[LeadOS] storage load error:', e);
    return null;
  }
}

function saveToStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // localStorage容量超過などは無視（データはメモリに残る）
    console.warn('[LeadOS] storage save error:', e);
  }
}

function initStorage() {
  const saved = loadFromStorage();
  if (saved && saved.stores && saved.stores.length > 0) {
    // 保存済みデータを復元
    return {
      stores:   saved.stores   || [...SEED_STORES],
      research: saved.research || [...SEED_RESEARCH],
      deals:    saved.deals    || [...SEED_DEALS],
      handoffs: saved.handoffs || [...SEED_HANDOFFS]
    };
  }
  // 初回 or クリア後 → シードデータで初期化
  return {
    stores:   [...SEED_STORES],
    research: [...SEED_RESEARCH],
    deals:    [...SEED_DEALS],
    handoffs: [...SEED_HANDOFFS]
  };
}

// =============================================
// AppDB — メインデータストア
// 全操作はここ経由。変更のたびに自動保存。
// =============================================
const AppDB = (() => {
  const state = initStorage();

  function _save() {
    saveToStorage({
      stores:   state.stores,
      research: state.research,
      deals:    state.deals,
      handoffs: state.handoffs
    });
  }

  return {
    // --- Stores ---
    getStores(filter = {}) {
      let list = [...state.stores];
      if (filter.stage)    list = list.filter(s => s.stage === filter.stage);
      if (filter.priority) list = list.filter(s => s.priority === filter.priority);
      if (filter.channel)  list = list.filter(s => s.channel === filter.channel);
      if (filter.q) {
        const q = filter.q.toLowerCase();
        list = list.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.city||'').toLowerCase().includes(q) ||
          (s.genre||'').toLowerCase().includes(q)
        );
      }
      return list;
    },
    getStore(id) { return state.stores.find(s => s.id === id) || null; },
    addStore(data) {
      const store = { id: generateId(), created_at: today(), updated_at: today(), ...data };
      state.stores.unshift(store);
      _save();
      return store;
    },
    updateStore(id, data) {
      const idx = state.stores.findIndex(s => s.id === id);
      if (idx >= 0) {
        state.stores[idx] = { ...state.stores[idx], ...data, updated_at: today() };
        _save();
        return state.stores[idx];
      }
      return null;
    },
    deleteStore(id) {
      const idx = state.stores.findIndex(s => s.id === id);
      if (idx >= 0) { state.stores.splice(idx, 1); _save(); return true; }
      return false;
    },

    // --- Research ---
    getResearch(store_id)  { return state.research.find(r => r.store_id === store_id) || null; },
    getAllResearch()        { return [...state.research]; },
    addResearch(data) {
      const r = { id: generateId(), created_at: today(), updated_at: today(), ...data };
      state.research.unshift(r);
      _save();
      return r;
    },
    updateResearch(id, data) {
      const idx = state.research.findIndex(r => r.id === id);
      if (idx >= 0) {
        state.research[idx] = { ...state.research[idx], ...data, updated_at: today() };
        _save();
        return state.research[idx];
      }
      return null;
    },

    // --- Deals ---
    getDeals(store_id) {
      if (store_id) return state.deals.filter(d => d.store_id === store_id);
      return [...state.deals];
    },
    getDeal(id) { return state.deals.find(d => d.id === id) || null; },
    addDeal(data) {
      const d = { id: generateId(), created_at: today(), updated_at: today(), ...data };
      state.deals.unshift(d);
      _save();
      return d;
    },
    updateDeal(id, data) {
      const idx = state.deals.findIndex(d => d.id === id);
      if (idx >= 0) {
        state.deals[idx] = { ...state.deals[idx], ...data, updated_at: today() };
        _save();
        return state.deals[idx];
      }
      return null;
    },

    // --- Handoffs ---
    getHandoffs(store_id) {
      if (store_id) return state.handoffs.filter(h => h.store_id === store_id);
      return [...state.handoffs];
    },
    getHandoff(id) { return state.handoffs.find(h => h.id === id) || null; },
    addHandoff(data) {
      const h = { id: generateId(), created_at: today(), updated_at: today(), ...data };
      state.handoffs.unshift(h);
      _save();
      return h;
    },
    updateHandoff(id, data) {
      const idx = state.handoffs.findIndex(h => h.id === id);
      if (idx >= 0) {
        state.handoffs[idx] = { ...state.handoffs[idx], ...data, updated_at: today() };
        _save();
        return state.handoffs[idx];
      }
      return null;
    },

    // --- Stats ---
    getStats() {
      const stores = state.stores;
      const total        = stores.length;
      const surveyed     = stores.filter(s => s.stage !== '調査待ち').length;
      const dm           = stores.filter(s => s.channel === 'DM推奨').length;
      const tel          = stores.filter(s => s.channel === 'テレアポ推奨').length;
      const contacted    = stores.filter(s => ['DM送信済み','テレアポ済み','反応あり','商談化','見積提出','受注','引き継ぎ待ち','引き継ぎ完了'].includes(s.stage)).length;
      const deals_stage  = stores.filter(s => ['商談化','見積提出'].includes(s.stage)).length;
      const orders       = stores.filter(s => ['受注','引き継ぎ待ち','引き継ぎ完了'].includes(s.stage)).length;
      const waitResearch = stores.filter(s => s.stage === '調査待ち').length;
      const totalRevenue = state.handoffs.reduce((sum, h) => sum + (h.initial_fee || 0), 0);
      const monthlyRev   = state.handoffs.filter(h => h.status === '完了').reduce((sum, h) => sum + (h.monthly_fee || 0), 0);
      return { total, surveyed, dm, tel, contacted, deals_stage, orders, waitResearch, totalRevenue, monthlyRev };
    },

    // --- Dev utils （開発・手直し用）---
    // ブラウザコンソールから呼び出せます
    resetToSeed() {
      state.stores   = [...SEED_STORES];
      state.research = [...SEED_RESEARCH];
      state.deals    = [...SEED_DEALS];
      state.handoffs = [...SEED_HANDOFFS];
      _save();
      console.log('[LeadOS] データをシードにリセットしました');
    },
    clearAll() {
      state.stores = []; state.research = []; state.deals = []; state.handoffs = [];
      _save();
      console.log('[LeadOS] 全データをクリアしました');
    },
    exportJSON() {
      const json = JSON.stringify({ stores: state.stores, research: state.research, deals: state.deals, handoffs: state.handoffs }, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `firstweb_lead_os_${today()}.json`; a.click();
      console.log('[LeadOS] データをエクスポートしました');
    },
    importJSON(jsonStr) {
      try {
        const d = JSON.parse(jsonStr);
        if (d.stores)   state.stores   = d.stores;
        if (d.research) state.research = d.research;
        if (d.deals)    state.deals    = d.deals;
        if (d.handoffs) state.handoffs = d.handoffs;
        _save();
        console.log('[LeadOS] データをインポートしました');
        return true;
      } catch(e) { console.error('[LeadOS] import error:', e); return false; }
    }
  };
})();

// =============================================
// HELPER FUNCTIONS — バッジ・表示部品
// =============================================
function getChannelBadge(channel) {
  const map = {
    'DM推奨':      '<span class="badge channel-dm"><i class="fas fa-envelope"></i> DM推奨</span>',
    'テレアポ推奨': '<span class="badge channel-tel"><i class="fas fa-phone"></i> テレアポ推奨</span>',
    '要確認':      '<span class="badge channel-check"><i class="fas fa-question-circle"></i> 要確認</span>',
    '未判定':      '<span class="badge badge-gray">未判定</span>',
  };
  return map[channel] || `<span class="badge badge-gray">${channel || '—'}</span>`;
}

function getPriorityBadge(p) {
  return `<span class="badge priority-${p || '低'}">${p || '—'}</span>`;
}

function getStageBadge(stage) {
  const s = STAGES.find(x => x.id === stage);
  if (!s) return `<span class="badge badge-gray">${stage || '—'}</span>`;
  return `<span class="badge" style="background:${s.bg};color:${s.color}">${stage}</span>`;
}

function getStarRating(n) {
  const num  = parseFloat(n) || 0;
  const full = Math.floor(num);
  const half = num - full >= 0.5;
  let stars  = '';
  for (let i = 0; i < full; i++) stars += '<i class="fas fa-star"></i>';
  if (half) stars += '<i class="fas fa-star-half-alt"></i>';
  for (let i = full + (half ? 1 : 0); i < 5; i++) stars += '<i class="far fa-star"></i>';
  return `<span class="review-stars">${stars}</span>`;
}

function formatYen(n) {
  if (n === null || n === undefined || n === '') return '—';
  return '¥' + Number(n).toLocaleString();
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast('コピーしました ✓'));
}
