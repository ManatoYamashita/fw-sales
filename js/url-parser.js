// =============================================
// Firstweb Lead OS - URL Parser
// 食べログ / Googleマップ URL から基本情報を自動解析
// =============================================

// ---- 食べログ 都道府県コード辞書 ----
const TABELOG_PREF = {
  hokkaido: '北海道',
  aomori: '青森県', iwate: '岩手県', miyagi: '宮城県', akita: '秋田県',
  yamagata: '山形県', fukushima: '福島県',
  ibaraki: '茨城県', tochigi: '栃木県', gunma: '群馬県', saitama: '埼玉県',
  chiba: '千葉県', tokyo: '東京都', kanagawa: '神奈川県',
  niigata: '新潟県', toyama: '富山県', ishikawa: '石川県', fukui: '福井県',
  yamanashi: '山梨県', nagano: '長野県', shizuoka: '静岡県',
  aichi: '愛知県', gifu: '岐阜県', mie: '三重県',
  shiga: '滋賀県', kyoto: '京都府', osaka: '大阪府', hyogo: '兵庫県',
  nara: '奈良県', wakayama: '和歌山県',
  tottori: '鳥取県', shimane: '島根県', okayama: '岡山県', hiroshima: '広島県',
  yamaguchi: '山口県',
  tokushima: '徳島県', kagawa: '香川県', ehime: '愛媛県', kochi: '高知県',
  fukuoka: '福岡県', saga: '佐賀県', nagasaki: '長崎県', kumamoto: '熊本県',
  oita: '大分県', miyazaki: '宮崎県', kagoshima: '鹿児島県', okinawa: '沖縄県'
};

// 食べログ エリアコード → 市区町村ヒント辞書（主要のみ）
const TABELOG_AREA = {
  // 東京
  A1301: '千代田区・中央区・港区', A1302: '新宿区', A1303: '渋谷区',
  A1304: '目黒区・品川区', A1305: '世田谷区', A1306: '大田区',
  A1307: '中野区・杉並区', A1308: '豊島区・北区', A1309: '文京区・台東区',
  A1310: '墨田区・江東区', A1311: '荒川区・足立区', A1312: '葛飾区・江戸川川',
  A1315: '八王子市・町田市',
  // 神奈川
  A1401: '横浜市中区・西区', A1402: '横浜市南区・港南区', A1403: '横浜市神奈川区',
  A1404: '横浜市港北区・都筑区', A1405: '川崎市',
  A1406: '相模原市', A1407: '横須賀市・三浦市', A1408: '藤沢市・鎌倉市',
  A1409: '小田原市・平塚市',
  // 大阪
  A2701: '大阪市北区・中央区', A2702: '大阪市浪速区・西区',
  A2703: '大阪市天王寺区・阿倍野区', A2704: '大阪市城東区・東成区',
  // 愛知
  A2301: '名古屋市中区・東区', A2302: '名古屋市千種区・昭和区',
  // 福岡
  A4001: '福岡市博多区・中央区', A4002: '福岡市西区・早良区'
};

// 食べログ 小エリアコード → 駅・地名ヒント（主要のみ）
const TABELOG_SUBAREA = {
  // 川崎市エリア
  A140501: '川崎駅周辺', A140502: '武蔵小杉・元住吉',
  A140503: '武蔵小杉', A140504: '新丸子・武蔵新城',
  A140505: '溝の口・宮前平', A140506: '登戸・向ヶ丘',
  // 渋谷
  A130301: '渋谷駅周辺', A130302: '恵比寿・代官山',
  A130303: '表参道・青山', A130304: '原宿・明治神宮前',
  // 新宿
  A130201: '新宿駅東口', A130202: '新宿駅西口・南口',
  A130203: '四谷・四ツ谷', A130204: '高田馬場・早稲田',
  // 横浜
  A140101: '横浜駅周辺', A140102: '関内・馬車道',
  A140103: '中華街・元町',
  // 名古屋
  A230101: '名古屋駅', A230102: '栄・錦',
  A230103: '大須・矢場町',
};

// 業態キーワード → 業態名マッピング
const GENRE_KEYWORDS = {
  '居酒屋': '居酒屋', 'izakaya': '居酒屋',
  'ラーメン': 'ラーメン', 'ramen': 'ラーメン', '拉麺': 'ラーメン',
  'カフェ': 'カフェ', 'cafe': 'カフェ', 'coffee': 'カフェ',
  'イタリアン': 'イタリアン', 'italian': 'イタリアン', 'pasta': 'イタリアン',
  '焼肉': '焼肉', 'yakiniku': '焼肉',
  '寿司': '寿司', 'sushi': '寿司', '鮨': '寿司',
  '中華': '中華', 'chinese': '中華', '中国料理': '中華',
  '定食': '定食', 'teishoku': '定食',
  'カレー': 'カレー', 'curry': 'カレー',
  '焼き鳥': 'その他', '焼鳥': 'その他', '蕎麦': 'その他',
  'うどん': 'その他', '天ぷら': 'その他', '和食': 'その他',
  'フレンチ': 'その他', 'french': 'その他',
  'バー': '居酒屋', 'bar': '居酒屋',
};

// =============================================
// メイン解析関数
// =============================================
function parseStoreUrl(url) {
  if (!url || url.trim() === '') return null;

  const trimmed = url.trim();

  // 食べログURL判定
  if (trimmed.includes('tabelog.com')) {
    return parseTabelogUrl(trimmed);
  }

  // Googleマップ判定
  if (trimmed.includes('maps.google') || trimmed.includes('goo.gl/maps') ||
      trimmed.includes('maps.app.goo.gl') || trimmed.includes('google.com/maps')) {
    return parseGoogleMapsUrl(trimmed);
  }

  // Instagram URL
  if (trimmed.includes('instagram.com')) {
    return { type: 'instagram', instagram_url: trimmed };
  }

  return { type: 'unknown', raw: trimmed };
}

// =============================================
// 食べログURL解析
// =============================================
function parseTabelogUrl(url) {
  const result = {
    type: 'tabelog',
    source_url: url,
    prefecture: '',
    city: '',
    pref_raw: '',
    area_raw: '',
    subarea_raw: '',
    store_id: '',
    tabelog_url: url,
    confidence: {}
  };

  try {
    // パターン: https://tabelog.com/{pref}/{area}/{subarea}/{id}/
    const m = url.match(/tabelog\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)/);
    if (m) {
      const [, pref, area, subarea, storeId] = m;
      result.pref_raw = pref;
      result.area_raw = area;
      result.subarea_raw = subarea;
      result.store_id = storeId;
      result.tabelog_store_id = storeId;

      // 都道府県変換
      const prefecture = TABELOG_PREF[pref.toLowerCase()];
      if (prefecture) {
        result.prefecture = prefecture;
        result.confidence.prefecture = 'high';
      }

      // エリア → 市区町村ヒント
      const areaKey = area.toUpperCase();
      const areaHint = TABELOG_AREA[areaKey];
      if (areaHint) {
        result.city = areaHint;
        result.confidence.city = 'medium';
      } else {
        // エリアコードをそのまま市区への変換試行
        const cityFromCode = guessCityFromAreaCode(area, pref);
        if (cityFromCode) {
          result.city = cityFromCode;
          result.confidence.city = 'low';
        }
      }

      // 小エリア → 駅名・地名
      const subareaKey = subarea.toUpperCase();
      const subareaHint = TABELOG_SUBAREA[subareaKey];
      if (subareaHint) {
        result.station_area = subareaHint;
        result.confidence.station = 'high';
      }
    }
  } catch (e) {
    console.warn('Tabelog parse error:', e);
  }

  return result;
}

// エリアコードから都市名を推測
function guessCityFromAreaCode(areaCode, pref) {
  const code = areaCode.toUpperCase();
  const prefMap = {
    'tokyo': '東京都', 'kanagawa': '神奈川県', 'osaka': '大阪府',
    'aichi': '愛知県', 'fukuoka': '福岡県', 'saitama': '埼玉県',
    'chiba': '千葉県', 'hyogo': '兵庫県', 'kyoto': '京都府'
  };
  return null; // 辞書にない場合はnull
}

// =============================================
// GoogleマップURL解析
// =============================================
function parseGoogleMapsUrl(url) {
  const result = {
    type: 'google_maps',
    source_url: url,
    map_url: url,
    prefecture: '',
    city: '',
    name: '',
    confidence: {}
  };

  try {
    // 通常URL: https://www.google.com/maps/place/店名/@緯度,経度,...
    const placeMatch = url.match(/maps\/place\/([^/@]+)/);
    if (placeMatch) {
      const decoded = decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ');
      if (decoded && !decoded.startsWith('data=')) {
        result.name = decoded;
        result.confidence.name = 'medium';

        // 業態推測
        const genre = guessGenre(decoded);
        if (genre) {
          result.genre = genre;
          result.confidence.genre = 'medium';
        }
      }
    }

    // 検索クエリから名前取得
    const queryMatch = url.match(/[?&]q=([^&]+)/);
    if (!result.name && queryMatch) {
      const q = decodeURIComponent(queryMatch[1]).replace(/\+/g, ' ');
      result.name = q;
      result.confidence.name = 'low';
    }

    // 緯度経度から都市推測は静的環境では困難なのでスキップ
  } catch (e) {
    console.warn('Google Maps parse error:', e);
  }

  return result;
}

// =============================================
// 業態推測
// =============================================
function guessGenre(text) {
  const lower = text.toLowerCase();
  for (const [keyword, genre] of Object.entries(GENRE_KEYWORDS)) {
    if (lower.includes(keyword.toLowerCase())) {
      return genre;
    }
  }
  return '';
}

// =============================================
// OGP取得（allorigins経由）
// =============================================
async function fetchOGPData(url) {
  const result = { name: '', description: '', genre: '', error: null };

  // allorigins.win CORS proxy を使用
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000); // 6秒タイムアウト

    const response = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error('Network error');

    const data = await response.json();
    const html = data.contents || '';

    if (!html) throw new Error('Empty response');

    // OGタグ解析
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
    const ogDesc  = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1];
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    // 食べログのtitleは「店名 - エリア/業態 | 食べログ」形式
    if (titleTag) {
      const cleaned = titleTag.replace(/\s*[|｜]\s*食べログ.*$/i, '').trim();
      const parts = cleaned.split(/\s*[-－]\s*/);
      if (parts.length >= 1 && parts[0]) {
        result.name = parts[0].trim();
      }
      // 業態をtitleから推測
      const genre = guessGenre(cleaned);
      if (genre) result.genre = genre;
    }

    if (ogTitle && !result.name) {
      result.name = ogTitle.replace(/\s*[|｜]\s*食べログ.*$/i, '').trim().split(/[-－]/)[0].trim();
    }

    if (ogDesc) {
      result.description = ogDesc.substring(0, 200);
      // 説明文から業態推測
      if (!result.genre) result.genre = guessGenre(ogDesc);
    }

    // 口コミ件数・評価点数の取得試行
    const ratingMatch = html.match(/(\d+\.\d+)\s*点/);
    if (ratingMatch) result.rating = parseFloat(ratingMatch[1]);

    const reviewCountMatch = html.match(/(\d+)\s*件/);
    if (reviewCountMatch) result.review_count = parseInt(reviewCountMatch[1]);

    // 住所抽出試行
    const addrMatch = html.match(/〒\d{3}-\d{4}\s*([^\s<"']+(?:都|道|府|県)[^\s<"']+)/);
    if (addrMatch) result.address_hint = addrMatch[1];

    // 電話番号
    const telMatch = html.match(/(\d{2,4}[-－]\d{2,4}[-－]\d{4})/);
    if (telMatch) result.phone = telMatch[1];

  } catch (e) {
    if (e.name === 'AbortError') {
      result.error = 'timeout';
    } else {
      result.error = e.message;
    }
  }

  return result;
}

// =============================================
// 解析結果をフォームに適用
// =============================================
function applyParsedData(parsed, ogp = null) {
  const fields = {
    name: '',
    prefecture: '',
    city: '',
    phone: '',
    site_url: '',
    map_url: '',
    instagram_url: '',
    genre: '',
    address: '',
    review_avg: '',
    review_count: '',
    memo: ''
  };

  if (!parsed) return fields;

  // URL由来データ
  if (parsed.prefecture) fields.prefecture = parsed.prefecture;
  if (parsed.city) fields.city = parsed.city;
  if (parsed.name) fields.name = parsed.name;
  if (parsed.genre) fields.genre = parsed.genre;
  if (parsed.map_url) fields.map_url = parsed.map_url;
  if (parsed.tabelog_url) fields.memo = `食べログURL: ${parsed.tabelog_url}`;
  if (parsed.instagram_url) fields.instagram_url = parsed.instagram_url;
  if (parsed.station_area) fields.address = parsed.station_area + '周辺';

  // OGP由来データ（上書き・補完）
  if (ogp) {
    if (ogp.name && ogp.name.length > 0) fields.name = ogp.name;
    if (ogp.genre && !fields.genre) fields.genre = ogp.genre;
    if (ogp.phone) fields.phone = ogp.phone;
    if (ogp.rating) fields.review_avg = ogp.rating;
    if (ogp.review_count) fields.review_count = ogp.review_count;
    if (ogp.address_hint) {
      // 都道府県抽出
      const prefMatch = ogp.address_hint.match(/(東京都|大阪府|京都府|北海道|.+?[都道府県])/);
      if (prefMatch && !fields.prefecture) fields.prefecture = prefMatch[1];
    }
    if (ogp.description && parsed.type === 'tabelog') {
      const existingMemo = fields.memo || '';
      fields.memo = existingMemo + (existingMemo ? '\n' : '') + `概要: ${ogp.description.substring(0, 100)}`;
    }
  }

  return fields;
}
