// =============================================
// Stores Page (List + New + Detail)
// =============================================

function renderStores() {
  const stores = AppDB.getStores();
  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">店舗一覧</div>
      <div class="page-desc">${stores.length}件の店舗が登録されています</div>
    </div>
    <div class="page-actions">
      <button class="btn-primary" onclick="navigate('store-new')">
        <i class="fas fa-plus"></i> 店舗登録
      </button>
    </div>
  </div>

  <div class="card">
    <div class="card-body" style="padding-bottom:0">
      <div class="filter-bar">
        <div class="search-box">
          <i class="fas fa-search"></i>
          <input class="form-control" id="store-search" placeholder="店名・エリアで検索..." onkeyup="filterStores()">
        </div>
        <select class="form-control" id="filter-stage" onchange="filterStores()">
          <option value="">全ステージ</option>
          ${STAGES.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
        </select>
        <select class="form-control" id="filter-channel" onchange="filterStores()">
          <option value="">全チャネル</option>
          <option value="DM推奨">DM推奨</option>
          <option value="テレアポ推奨">テレアポ推奨</option>
          <option value="未判定">未判定</option>
        </select>
        <select class="form-control" id="filter-priority" onchange="filterStores()">
          <option value="">全優先度</option>
          <option value="高">高</option>
          <option value="中">中</option>
          <option value="低">低</option>
        </select>
      </div>
    </div>
    <div class="table-container" id="stores-table-container">
      ${renderStoresTable(stores)}
    </div>
  </div>
  `;
  renderPage(html);
}

function renderStoresTable(stores) {
  if (!stores.length) return '<div class="empty-state"><i class="fas fa-store"></i><p>条件に一致する店舗がありません</p></div>';
  return `
  <table>
    <thead>
      <tr>
        <th>店舗名</th>
        <th>エリア</th>
        <th>業態</th>
        <th>チャネル</th>
        <th>ステージ</th>
        <th>優先</th>
        <th>口コミ</th>
        <th>担当</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${stores.map(s => `
      <tr class="table-row-link" onclick="navigate('store-detail',{id:'${s.id}'})">
        <td>
          <div style="font-weight:700">${s.name}</div>
          <div class="text-muted">${s.genre||'—'}</div>
        </td>
        <td>${s.city||s.prefecture||'—'}</td>
        <td><span class="badge badge-gray">${s.genre||'—'}</span></td>
        <td>${getChannelBadge(s.channel)}</td>
        <td>${getStageBadge(s.stage)}</td>
        <td>${getPriorityBadge(s.priority)}</td>
        <td>
          <span style="color:var(--amber-600);font-weight:700">${s.review_avg||'—'}</span>
          <span class="text-muted"> / ${s.review_count||0}件</span>
        </td>
        <td class="text-muted">${s.assigned_sales||'—'}</td>
        <td>
          ${s.stage === '調査待ち'
            ? `<button class="btn-primary btn-sm" onclick="event.stopPropagation();navigate('research-detail',{id:'${s.id}'})">
                <i class="fas fa-search"></i> 調査開始
               </button>`
            : `<button class="btn-icon" onclick="event.stopPropagation();navigate('store-detail',{id:'${s.id}'})">
                <i class="fas fa-chevron-right"></i>
               </button>`
          }
        </td>
      </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function filterStores() {
  const q = document.getElementById('store-search')?.value || '';
  const stage = document.getElementById('filter-stage')?.value || '';
  const channel = document.getElementById('filter-channel')?.value || '';
  const priority = document.getElementById('filter-priority')?.value || '';
  const filtered = AppDB.getStores({ q, stage, channel, priority });
  const container = document.getElementById('stores-table-container');
  if (container) container.innerHTML = renderStoresTable(filtered);
}

// ---- Store New ----
function renderStoreNew(prefill = {}) {
  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">店舗登録</div>
      <div class="page-desc">食べログ・GoogleマップのURLを貼るだけで基本情報を自動入力します</div>
    </div>
  </div>

  <div class="detail-layout">
    <div>
      <!-- ① URL入力パネル -->
      <div class="card" style="margin-bottom:16px" id="url-input-card">
        <div class="card-header">
          <div class="card-title">
            <i class="fas fa-magic" style="color:var(--purple-500)"></i>
            URLから自動入力
          </div>
          <span class="badge badge-purple">STEP 1</span>
        </div>
        <div class="card-body">
          <div class="alert alert-info" style="margin-bottom:16px">
            <i class="fas fa-info-circle"></i>
            <div>食べログ・GoogleマップのURLを貼り付けると、店名・エリア・業態を自動で取得します。<br>
            取得できなかった項目は手動で補完できます。</div>
          </div>

          <!-- URL入力エリア -->
          <div id="url-inputs-container">
            <div class="url-input-row" id="url-row-tabelog">
              <div class="form-group" style="margin-bottom:10px">
                <label class="form-label">
                  <i class="fas fa-utensils" style="color:#e85534"></i>
                  食べログ URL
                </label>
                <div style="display:flex;gap:8px">
                  <input class="form-control" id="url-tabelog"
                    placeholder="https://tabelog.com/kanagawa/A1405/A140504/14096697/"
                    value="${prefill._tabelog_url||''}"
                    oninput="onUrlInput('tabelog')">
                  <button class="btn-secondary btn-sm" style="flex-shrink:0;white-space:nowrap"
                    onclick="triggerUrlFetch('tabelog')">
                    <i class="fas fa-search"></i> 読込
                  </button>
                </div>
                <div class="form-hint">食べログの店舗ページURLをそのまま貼り付けてください</div>
              </div>
            </div>

            <div class="url-input-row" id="url-row-gmap">
              <div class="form-group" style="margin-bottom:10px">
                <label class="form-label">
                  <i class="fab fa-google" style="color:#4285F4"></i>
                  Googleマップ URL
                  <span style="font-size:10px;color:var(--navy-400);margin-left:6px">（任意）</span>
                </label>
                <div style="display:flex;gap:8px">
                  <input class="form-control" id="url-gmap"
                    placeholder="https://maps.google.com/maps/place/..."
                    value="${prefill._gmap_url||''}"
                    oninput="onUrlInput('gmap')">
                  <button class="btn-secondary btn-sm" style="flex-shrink:0;white-space:nowrap"
                    onclick="triggerUrlFetch('gmap')">
                    <i class="fas fa-search"></i> 読込
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- ステータス表示 -->
          <div id="url-fetch-status" style="display:none">
            <div class="alert alert-info" id="url-fetch-msg">
              <i class="fas fa-spinner fa-spin"></i> <span id="url-status-text">読み込み中...</span>
            </div>
          </div>

          <!-- 取得結果プレビュー -->
          <div id="url-preview-panel" style="display:none">
            <div class="divider"></div>
            <div style="font-size:12px;font-weight:700;color:var(--navy-400);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">
              <i class="fas fa-check-circle" style="color:var(--green-500)"></i> 取得結果プレビュー
            </div>
            <div id="url-preview-content"></div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-success btn-sm" onclick="applyUrlPreview()">
                <i class="fas fa-file-import"></i> フォームに適用する
              </button>
              <button class="btn-secondary btn-sm" onclick="resetUrlPreview()">
                <i class="fas fa-redo"></i> やり直し
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ② 基本情報フォーム -->
      <div class="card" id="form-card">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-store"></i> 基本情報</div>
          <span class="badge badge-gray">STEP 2 — 確認・添削</span>
        </div>
        <div class="card-body">

          <!-- 店名 + 業態 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">
                店名 <span class="required">*</span>
              </label>
              <div style="position:relative">
                <input class="form-control autofilled-field" id="f-name"
                  placeholder="例：導楽"
                  value="${prefill.name||''}">
                <span class="autofill-badge" id="badge-name" style="display:none">自動入力</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">業態</label>
              <div style="position:relative">
                <select class="form-control autofilled-field" id="f-genre">
                  <option value="">選択してください</option>
                  ${['居酒屋','ラーメン','カフェ','イタリアン','焼肉','寿司','中華','定食','カレー','その他'].map(g => `<option value="${g}" ${prefill.genre===g?'selected':''}>${g}</option>`).join('')}
                </select>
                <span class="autofill-badge" id="badge-genre" style="display:none">自動入力</span>
              </div>
            </div>
          </div>

          <!-- エリア 3列 -->
          <div class="form-row-3">
            <div class="form-group">
              <label class="form-label">都道府県</label>
              <div style="position:relative">
                <input class="form-control autofilled-field" id="f-prefecture"
                  placeholder="例：神奈川県"
                  value="${prefill.prefecture||''}">
                <span class="autofill-badge" id="badge-prefecture" style="display:none">自動入力</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">市区町村</label>
              <div style="position:relative">
                <input class="form-control autofilled-field" id="f-city"
                  placeholder="例：川崎市中原区"
                  value="${prefill.city||''}">
                <span class="autofill-badge" id="badge-city" style="display:none">自動入力</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">住所・エリア詳細</label>
              <div style="position:relative">
                <input class="form-control autofilled-field" id="f-address"
                  placeholder="例：新丸子駅周辺"
                  value="${prefill.address||''}">
                <span class="autofill-badge" id="badge-address" style="display:none">自動入力</span>
              </div>
            </div>
          </div>

          <!-- 電話 + 優先度 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">電話番号</label>
              <div style="position:relative">
                <input class="form-control autofilled-field" id="f-phone"
                  placeholder="例：044-XXX-XXXX"
                  value="${prefill.phone||''}">
                <span class="autofill-badge" id="badge-phone" style="display:none">自動入力</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">優先度</label>
              <select class="form-control" id="f-priority">
                <option value="中">中</option>
                <option value="高">高</option>
                <option value="低">低</option>
              </select>
            </div>
          </div>

          <div class="divider"></div>
          <div class="detail-section-title"><i class="fas fa-link"></i> WEB資産</div>

          <!-- URL確認欄（自動入力 + 手動編集可） -->
          <div class="form-group">
            <label class="form-label">食べログURL</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input class="form-control autofilled-field" id="f-tabelog"
                placeholder="https://tabelog.com/..."
                value="${prefill._tabelog_url||''}">
              ${prefill._tabelog_url ? `<a href="${prefill._tabelog_url}" target="_blank" class="btn-secondary btn-sm" style="flex-shrink:0;white-space:nowrap"><i class="fas fa-external-link-alt"></i> 確認</a>` : ''}
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">公式サイトURL</label>
            <input class="form-control" id="f-site"
              placeholder="https://..."
              value="${prefill.site_url||''}">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">GoogleマップURL</label>
              <div style="position:relative">
                <input class="form-control autofilled-field" id="f-map"
                  placeholder="https://maps.google.com/..."
                  value="${prefill.map_url||''}">
                <span class="autofill-badge" id="badge-map" style="display:none">自動入力</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Instagram URL</label>
              <input class="form-control" id="f-instagram"
                placeholder="https://instagram.com/..."
                value="${prefill.instagram_url||''}">
            </div>
          </div>

          <!-- 口コミ -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">口コミ件数</label>
              <div style="position:relative">
                <input class="form-control autofilled-field" type="number" id="f-rcount"
                  placeholder="0"
                  value="${prefill.review_count||''}">
                <span class="autofill-badge" id="badge-rcount" style="display:none">自動入力</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">平均評価（点）</label>
              <div style="position:relative">
                <input class="form-control autofilled-field" type="number" id="f-ravg"
                  step="0.1" min="0" max="5" placeholder="3.5"
                  value="${prefill.review_avg||''}">
                <span class="autofill-badge" id="badge-ravg" style="display:none">自動入力</span>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <!-- フォーム判定 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">問い合わせフォーム</label>
              <select class="form-control" id="f-form" onchange="onFormChange()">
                <option value="未確認">未確認</option>
                <option value="あり">あり</option>
                <option value="なし">なし</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">推奨チャネル</label>
              <div id="f-channel-display" class="channel-judge-inline">
                <span class="badge badge-gray" id="channel-badge-inline">未判定</span>
              </div>
            </div>
          </div>

          <div class="divider"></div>
          <div class="detail-section-title"><i class="fas fa-bullseye"></i> 営業方針</div>

          <div class="form-group">
            <label class="form-label">狙いたい商材</label>
            <div class="checkbox-group" id="f-services"></div>
          </div>
          <div class="form-group">
            <label class="form-label">指示メモ</label>
            <div style="position:relative">
              <textarea class="form-control autofilled-field" id="f-memo"
                rows="3"
                placeholder="気になる点、注意事項など...">${prefill.memo||''}</textarea>
              <span class="autofill-badge" id="badge-memo" style="display:none">自動入力</span>
            </div>
          </div>
        </div>

        <div class="card-footer" style="display:flex;gap:10px;justify-content:flex-end;align-items:center">
          <span class="text-muted" id="autofill-summary" style="flex:1;font-size:12px"></span>
          <button class="btn-secondary" onclick="navigate('stores')">キャンセル</button>
          <button class="btn-primary" onclick="submitNewStore()">
            <i class="fas fa-save"></i> 保存して調査キューへ
          </button>
        </div>
      </div>
    </div>

    <!-- Sidebar -->
    <div>
      <!-- 使い方ガイド -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title"><i class="fas fa-book"></i> 使い方</div></div>
        <div class="card-body" style="padding:0">
          <div style="padding:12px 16px;border-bottom:1px solid var(--slate-100);display:flex;gap:10px;align-items:flex-start">
            <span style="width:22px;height:22px;border-radius:50%;background:var(--blue-100);color:var(--blue-600);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">1</span>
            <div>
              <div style="font-size:13px;font-weight:600">食べログURLを貼る</div>
              <div class="text-muted">都道府県・エリアが自動で入力されます</div>
            </div>
          </div>
          <div style="padding:12px 16px;border-bottom:1px solid var(--slate-100);display:flex;gap:10px;align-items:flex-start">
            <span style="width:22px;height:22px;border-radius:50%;background:var(--blue-100);color:var(--blue-600);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">2</span>
            <div>
              <div style="font-size:13px;font-weight:600">「読込」ボタンを押す</div>
              <div class="text-muted">ページ情報の取得を試みます（3〜6秒）</div>
            </div>
          </div>
          <div style="padding:12px 16px;border-bottom:1px solid var(--slate-100);display:flex;gap:10px;align-items:flex-start">
            <span style="width:22px;height:22px;border-radius:50%;background:var(--blue-100);color:var(--blue-600);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">3</span>
            <div>
              <div style="font-size:13px;font-weight:600">内容を確認・添削</div>
              <div class="text-muted">黄色バッジは自動入力された項目です</div>
            </div>
          </div>
          <div style="padding:12px 16px;display:flex;gap:10px;align-items:flex-start">
            <span style="width:22px;height:22px;border-radius:50%;background:var(--blue-100);color:var(--blue-600);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">4</span>
            <div>
              <div style="font-size:13px;font-weight:600">保存する</div>
              <div class="text-muted">調査キューに登録されます</div>
            </div>
          </div>
        </div>
      </div>

      <!-- チャネル判定ルール -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title"><i class="fas fa-route"></i> チャネル判定ルール</div></div>
        <div class="card-body">
          <div class="alert alert-success" style="margin-bottom:8px">
            <i class="fas fa-envelope"></i>
            <div><strong>DM推奨</strong><br>問い合わせフォームがある場合</div>
          </div>
          <div class="alert alert-info" style="margin-bottom:8px">
            <i class="fas fa-phone"></i>
            <div><strong>テレアポ推奨</strong><br>フォームがない・電話のみの場合</div>
          </div>
          <div class="alert alert-warning" style="margin-bottom:0">
            <i class="fas fa-question-circle"></i>
            <div><strong>要確認</strong><br>予約フォームのみ・情報不足の場合</div>
          </div>
          <p class="text-muted" style="margin-top:8px;font-size:11px">※予約フォームのみは「フォームなし」扱い</p>
        </div>
      </div>

      <!-- 自動入力できる項目 -->
      <div class="card">
        <div class="card-header"><div class="card-title"><i class="fas fa-magic"></i> 自動入力される項目</div></div>
        <div class="card-body" style="padding:0">
          ${['店名（OGP取得時）','都道府県（URLから）','市区町村ヒント（URLから）','エリア・駅名（URLから）','業態ヒント（テキスト推測）','口コミ件数（OGP取得時）','平均評価（OGP取得時）','電話番号（OGP取得時）','食べログURL（自動保存）'].map(item => `
          <div style="padding:8px 16px;border-bottom:1px solid var(--slate-100);display:flex;align-items:center;gap:8px">
            <i class="fas fa-check" style="color:var(--green-500);font-size:11px;flex-shrink:0"></i>
            <span style="font-size:12px;color:var(--navy-700)">${item}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>
  `;

  renderPage(html);
  initServiceCheckboxes('f-services', prefill.target_service || '');
  updateChannelBadge(prefill.has_contact_form || '未確認');
  if (prefill.has_contact_form) {
    document.getElementById('f-form').value = prefill.has_contact_form;
  }

  // 自動入力バッジ適用（prefillから来た場合）
  if (prefill._autofilled) {
    prefill._autofilled.forEach(fieldId => showAutofillBadge(fieldId));
    updateAutofillSummary(prefill._autofilled.length);
  }
}

// =============================================
// URL入力 → 解析 → プレビュー → 適用
// =============================================
let _lastParsed = null;    // 最後に解析した結果
let _lastOgp = null;       // OGP取得結果

function onUrlInput(type) {
  // URLを貼るだけで即時URLパターン解析（エリアコード変換）
  const inputId = type === 'tabelog' ? 'url-tabelog' : 'url-gmap';
  const url = document.getElementById(inputId)?.value?.trim();
  if (!url) return;

  // 即時解析（軽量・同期）
  const parsed = parseStoreUrl(url);
  if (!parsed || parsed.type === 'unknown') return;

  // エリアコードだけ即時反映（OGP不要な部分）
  if (parsed.type === 'tabelog' && parsed.prefecture) {
    const prefEl = document.getElementById('f-prefecture');
    if (prefEl && !prefEl.value) {
      prefEl.value = parsed.prefecture;
      markAutofill('f-prefecture', 'prefecture');
    }
    if (parsed.city) {
      const cityEl = document.getElementById('f-city');
      if (cityEl && !cityEl.value) {
        cityEl.value = parsed.city;
        markAutofill('f-city', 'city');
      }
    }
    if (parsed.station_area) {
      const addrEl = document.getElementById('f-address');
      if (addrEl && !addrEl.value) {
        addrEl.value = parsed.station_area + '周辺';
        markAutofill('f-address', 'address');
      }
    }
    // 食べログURLをf-tabelogにも入れる
    const tabelogEl = document.getElementById('f-tabelog');
    if (tabelogEl && !tabelogEl.value) tabelogEl.value = url;
    // メモにURL記録
    const memoEl = document.getElementById('f-memo');
    if (memoEl && !memoEl.value) {
      memoEl.value = `食べログURL: ${url}`;
      markAutofill('f-memo', 'memo');
    }
  }

  if (parsed.type === 'google_maps') {
    if (parsed.name) {
      const nameEl = document.getElementById('f-name');
      if (nameEl && !nameEl.value) {
        nameEl.value = parsed.name;
        markAutofill('f-name', 'name');
      }
    }
    const mapEl = document.getElementById('f-map');
    if (mapEl && !mapEl.value) {
      mapEl.value = url;
      markAutofill('f-map', 'map');
    }
  }
}

async function triggerUrlFetch(type) {
  const inputId = type === 'tabelog' ? 'url-tabelog' : 'url-gmap';
  const url = document.getElementById(inputId)?.value?.trim();
  if (!url) {
    showToast('URLを入力してください', 'error');
    return;
  }

  // ステータス表示
  showUrlStatus('loading', '情報を取得しています...');

  try {
    // 1. URL解析（同期）
    const parsed = parseStoreUrl(url);
    _lastParsed = parsed;

    // 2. OGP取得（非同期・タイムアウト付き）
    let ogp = null;
    try {
      ogp = await fetchOGPData(url);
      _lastOgp = ogp;
    } catch (e) {
      // OGP失敗は無視してURL解析結果だけ使う
    }

    // 3. データ統合
    const fields = applyParsedData(parsed, ogp);

    // 4. プレビュー表示
    showUrlPreview(fields, parsed, ogp, url);

  } catch (e) {
    showUrlStatus('error', '取得に失敗しました。手動で入力してください。');
    console.warn('URL fetch error:', e);
  }
}

function showUrlStatus(type, msg) {
  const panel = document.getElementById('url-fetch-status');
  const msgEl = document.getElementById('url-fetch-msg');
  const textEl = document.getElementById('url-status-text');
  if (!panel) return;
  panel.style.display = 'block';
  if (msgEl) {
    msgEl.className = `alert alert-${type === 'loading' ? 'info' : type === 'error' ? 'error' : 'success'}`;
    msgEl.innerHTML = `<i class="fas ${type === 'loading' ? 'fa-spinner fa-spin' : type === 'error' ? 'fa-exclamation-triangle' : 'fa-check-circle'}"></i><span>${msg}</span>`;
  }
}

function showUrlPreview(fields, parsed, ogp, sourceUrl) {
  const previewPanel = document.getElementById('url-preview-panel');
  const previewContent = document.getElementById('url-preview-content');
  if (!previewPanel || !previewContent) return;

  const fetchedCount = Object.values(fields).filter(v => v && v !== '').length;
  const sourceType = parsed?.type === 'tabelog' ? '食べログ' : parsed?.type === 'google_maps' ? 'Googleマップ' : 'URL';

  const items = [
    { key: '店名', val: fields.name, field: 'name' },
    { key: '都道府県', val: fields.prefecture, field: 'prefecture' },
    { key: '市区町村', val: fields.city, field: 'city' },
    { key: '住所・エリア', val: fields.address, field: 'address' },
    { key: '電話番号', val: fields.phone, field: 'phone' },
    { key: '業態', val: fields.genre, field: 'genre' },
    { key: '口コミ件数', val: fields.review_count ? `${fields.review_count}件` : '', field: 'rcount' },
    { key: '平均評価', val: fields.review_avg ? `${fields.review_avg}点` : '', field: 'ravg' },
    { key: 'GoogleマップURL', val: fields.map_url ? '設定あり' : '', field: 'map' },
  ].filter(it => it.val);

  const confidence = parsed?.confidence || {};
  const ogpSuccess = ogp && !ogp.error;

  previewContent.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <span class="badge badge-green"><i class="fas fa-check"></i> ${sourceType}から ${items.length}項目取得</span>
      ${ogpSuccess ? '<span class="badge badge-blue"><i class="fas fa-cloud-download-alt"></i> ページ取得成功</span>' : '<span class="badge badge-gray"><i class="fas fa-wifi"></i> URLパターンのみ解析</span>'}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${items.map(it => `
      <div style="padding:8px 12px;background:var(--slate-50);border-radius:var(--radius-sm);border:1px solid var(--slate-100)">
        <div style="font-size:10px;color:var(--navy-400);font-weight:700;text-transform:uppercase;margin-bottom:2px">${it.key}</div>
        <div style="font-size:13px;font-weight:600;color:var(--navy-800)">${it.val}</div>
      </div>`).join('')}
    </div>
    ${!ogpSuccess && parsed?.type === 'tabelog' ? `
    <div class="alert alert-warning" style="margin-top:12px">
      <i class="fas fa-exclamation-triangle"></i>
      <div>食べログのページ取得は制限があります。URLから読み取れた情報のみ表示しています。<br>
      店名など不足している項目は手動で補完してください。
      <a href="${sourceUrl}" target="_blank" style="font-weight:700;margin-left:4px">食べログで確認 <i class="fas fa-external-link-alt"></i></a></div>
    </div>` : ''}
  `;

  previewPanel.style.display = 'block';
  document.getElementById('url-fetch-status').style.display = 'none';

  // プレビューデータを一時保存
  window._previewFields = { ...fields, _source_url: sourceUrl };
}

function applyUrlPreview() {
  const fields = window._previewFields;
  if (!fields) return;

  const autofilled = [];

  if (fields.name) { setField('f-name', fields.name); autofilled.push('name'); }
  if (fields.genre) { setSelectField('f-genre', fields.genre); autofilled.push('genre'); }
  if (fields.prefecture) { setField('f-prefecture', fields.prefecture); autofilled.push('prefecture'); }
  if (fields.city) { setField('f-city', fields.city); autofilled.push('city'); }
  if (fields.address) { setField('f-address', fields.address); autofilled.push('address'); }
  if (fields.phone) { setField('f-phone', fields.phone); autofilled.push('phone'); }
  if (fields.map_url) { setField('f-map', fields.map_url); autofilled.push('map'); }
  if (fields.review_count) { setField('f-rcount', fields.review_count); autofilled.push('rcount'); }
  if (fields.review_avg) { setField('f-ravg', fields.review_avg); autofilled.push('ravg'); }
  if (fields.memo) {
    const memo = document.getElementById('f-memo');
    if (memo && !memo.value) { memo.value = fields.memo; autofilled.push('memo'); }
  }
  if (fields._source_url) {
    const tabel = document.getElementById('f-tabelog');
    if (tabel) tabel.value = fields._source_url;
  }

  // バッジ表示
  autofilled.forEach(id => markAutofill('f-' + id, id));
  updateAutofillSummary(autofilled.length);

  // URLカードを折りたたむ
  const urlCard = document.getElementById('url-input-card');
  if (urlCard) {
    const body = urlCard.querySelector('.card-body');
    if (body) body.style.display = 'none';
    urlCard.querySelector('.card-header').insertAdjacentHTML('afterend', `
      <div style="padding:10px 20px;background:var(--green-50);border-bottom:1px solid var(--green-100);font-size:12px;color:var(--green-600);display:flex;align-items:center;gap:8px">
        <i class="fas fa-check-circle"></i> ${autofilled.length}項目を自動入力しました。フォームを確認・添削してください。
        <button class="btn-ghost btn-sm" style="color:var(--green-600);margin-left:auto" onclick="expandUrlCard()">再入力</button>
      </div>
    `);
  }

  showToast(`${autofilled.length}項目を自動入力しました`, 'success');

  // フォームにスクロール
  const formCard = document.getElementById('form-card');
  if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function expandUrlCard() {
  const urlCard = document.getElementById('url-input-card');
  if (!urlCard) return;
  const successBar = urlCard.querySelector('.card-header + div');
  if (successBar) successBar.remove();
  const body = urlCard.querySelector('.card-body');
  if (body) body.style.display = '';
  resetUrlPreview();
}

function resetUrlPreview() {
  const previewPanel = document.getElementById('url-preview-panel');
  const statusPanel = document.getElementById('url-fetch-status');
  if (previewPanel) previewPanel.style.display = 'none';
  if (statusPanel) statusPanel.style.display = 'none';
  window._previewFields = null;
  _lastParsed = null;
  _lastOgp = null;
}

function setField(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null && val !== '') el.value = val;
}

function setSelectField(id, val) {
  const el = document.getElementById(id);
  if (!el || !val) return;
  for (let opt of el.options) {
    if (opt.value === val || opt.text === val) { opt.selected = true; break; }
  }
}

function markAutofill(fieldId, badgeId) {
  showAutofillBadge(badgeId);
  // フィールドにハイライト
  const el = document.getElementById(fieldId);
  if (el) {
    el.style.borderColor = 'var(--amber-400)';
    el.style.background = 'var(--amber-50)';
    // ユーザーが編集したらハイライトを消す
    el.addEventListener('input', function() {
      this.style.borderColor = '';
      this.style.background = '';
      hideBadge(badgeId);
    }, { once: true });
  }
}

function showAutofillBadge(id) {
  const badge = document.getElementById('badge-' + id);
  if (badge) badge.style.display = 'inline-flex';
}

function hideBadge(id) {
  const badge = document.getElementById('badge-' + id);
  if (badge) badge.style.display = 'none';
}

function updateAutofillSummary(count) {
  const el = document.getElementById('autofill-summary');
  if (el) {
    el.innerHTML = count > 0
      ? `<i class="fas fa-magic" style="color:var(--amber-500)"></i> ${count}項目を自動入力済み。黄色の項目を確認してください。`
      : '';
  }
}

function onFormChange() {
  const val = document.getElementById('f-form')?.value;
  updateChannelBadge(val);
}

function updateChannelBadge(val) {
  const badge = document.getElementById('channel-badge-inline');
  if (!badge) return;
  if (val === 'あり') {
    badge.className = 'badge channel-dm';
    badge.innerHTML = '<i class="fas fa-envelope"></i> DM推奨';
  } else if (val === 'なし') {
    badge.className = 'badge channel-tel';
    badge.innerHTML = '<i class="fas fa-phone"></i> テレアポ推奨';
  } else {
    badge.className = 'badge badge-gray';
    badge.innerHTML = '未判定';
  }
}

function submitNewStore() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { showToast('店名を入力してください', 'error'); return; }

  const form_val = document.getElementById('f-form').value;
  const channel = form_val === 'あり' ? 'DM推奨' : form_val === 'なし' ? 'テレアポ推奨' : '未判定';

  // 食べログURLをメモに含める
  const tabelogUrl = document.getElementById('f-tabelog')?.value?.trim() || '';
  let memo = document.getElementById('f-memo').value || '';
  if (tabelogUrl && !memo.includes('tabelog.com')) {
    memo = (memo ? memo + '\n' : '') + `食べログURL: ${tabelogUrl}`;
  }

  const store = AppDB.addStore({
    name,
    prefecture: document.getElementById('f-prefecture').value,
    city: document.getElementById('f-city').value,
    address: document.getElementById('f-address').value,
    genre: document.getElementById('f-genre').value,
    priority: document.getElementById('f-priority').value,
    phone: document.getElementById('f-phone').value,
    site_url: document.getElementById('f-site').value,
    map_url: document.getElementById('f-map').value,
    instagram_url: document.getElementById('f-instagram').value,
    has_contact_form: form_val,
    channel,
    target_service: getServiceValues('f-services'),
    memo,
    review_count: parseInt(document.getElementById('f-rcount').value) || 0,
    review_avg: parseFloat(document.getElementById('f-ravg').value) || 0,
    stage: '調査待ち',
    assigned_planner: '佐藤',
    assigned_sales: ''
  });

  showToast(`「${name}」を登録しました。続けて調査を入力してください。`, 'success');
  // 登録後すぐ調査画面へ遷移
  navigate('research-detail', { id: store.id });
}

// ---- Store Detail ----
function renderStoreDetail(id) {
  const store = AppDB.getStore(id);
  if (!store) { renderPage('<div class="empty-state"><i class="fas fa-store"></i><p>店舗が見つかりません</p></div>'); return; }

  const research = AppDB.getResearch(id);
  const deals = AppDB.getDeals(id);

  const html = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn-secondary btn-sm" onclick="navigate('stores')"><i class="fas fa-arrow-left"></i></button>
      <div>
        <div class="page-title">${store.name}</div>
        <div class="page-desc">${store.genre||''} ・ ${store.city||''}</div>
      </div>
    </div>
    <div class="page-actions">
      ${getStageBadge(store.stage)}
      ${getPriorityBadge(store.priority)}
      <button class="btn-secondary btn-sm" onclick="openStageModal('${id}')">
        <i class="fas fa-exchange-alt"></i> ステージ変更
      </button>
      <button class="btn-primary btn-sm" onclick="navigate('research-detail',{id:'${id}'})"
        style="${!research ? 'background:var(--purple-600);' : ''}">
        <i class="fas fa-search"></i> ${!research ? '🔍 今すぐ調査開始' : '調査結果を見る'}
      </button>
    </div>
  </div>

  <div class="detail-layout">
    <!-- Left -->
    <div>
      <!-- 基本情報 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-info-circle"></i> 基本情報</div>
          <button class="btn-ghost btn-sm" onclick="navigate('store-edit',{id:'${id}'})">
            <i class="fas fa-edit"></i> 編集
          </button>
        </div>
        <div class="card-body">
          <div class="info-grid">
            <div class="info-item"><div class="info-key">店名</div><div class="info-val">${store.name}</div></div>
            <div class="info-item"><div class="info-key">業態</div><div class="info-val">${store.genre||'—'}</div></div>
            <div class="info-item"><div class="info-key">都道府県</div><div class="info-val">${store.prefecture||'—'}</div></div>
            <div class="info-item"><div class="info-key">市区町村</div><div class="info-val">${store.city||'—'}</div></div>
            <div class="info-item"><div class="info-key">住所</div><div class="info-val">${store.address||'—'}</div></div>
            <div class="info-item"><div class="info-key">電話番号</div><div class="info-val">${store.phone||'<span class="empty">未取得</span>'}</div></div>
            <div class="info-item"><div class="info-key">担当営業企画</div><div class="info-val">${store.assigned_planner||'—'}</div></div>
            <div class="info-item"><div class="info-key">担当営業</div><div class="info-val">${store.assigned_sales||'未アサイン'}</div></div>
          </div>
        </div>
      </div>

      <!-- WEB資産 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-globe"></i> WEB資産・接触判定</div>
        </div>
        <div class="card-body">
          <!-- Channel Judge -->
          <div class="channel-card ${store.channel === 'DM推奨' ? 'dm' : store.channel === 'テレアポ推奨' ? 'tel' : 'check'}">
            <div class="channel-icon">
              <i class="${store.channel === 'DM推奨' ? 'fas fa-envelope' : store.channel === 'テレアポ推奨' ? 'fas fa-phone' : 'fas fa-question-circle'}"></i>
            </div>
            <div>
              <div class="channel-label">推奨接触チャネル</div>
              <div class="channel-title">${store.channel || '未判定'}</div>
              <div class="channel-reason">
                問い合わせフォーム：<strong>${store.has_contact_form||'未確認'}</strong>
                ${store.channel === 'DM推奨' ? '→ フォーム経由でのDM送信を優先します。' : store.channel === 'テレアポ推奨' ? '→ 非同期窓口がないため、電話による一次接触を推奨します。' : '→ 追加確認が必要です。'}
              </div>
            </div>
          </div>

          <div class="info-grid">
            <div class="info-item">
              <div class="info-key">公式サイト</div>
              <div class="info-val">${store.site_url ? `<a href="${store.site_url}" target="_blank">${store.site_url.substring(0,30)}...</a>` : '<span class="empty">なし</span>'}</div>
            </div>
            <div class="info-item">
              <div class="info-key">Instagram</div>
              <div class="info-val">${store.instagram_url ? `<a href="${store.instagram_url}" target="_blank">リンクあり</a>` : '<span class="empty">なし</span>'}</div>
            </div>
            <div class="info-item">
              <div class="info-key">Googleマップ</div>
              <div class="info-val">${store.map_url ? `<a href="${store.map_url}" target="_blank">リンクあり</a>` : '<span class="empty">なし</span>'}</div>
            </div>
            <div class="info-item">
              <div class="info-key">問い合わせフォーム</div>
              <div class="info-val">${store.has_contact_form||'未確認'}</div>
            </div>
          </div>

          <div class="divider"></div>
          <div class="info-item">
            <div class="info-key">口コミ評価</div>
            <div class="review-summary" style="margin-top:8px">
              <div class="review-score">
                <div class="score">${store.review_avg||'—'}</div>
                <div>${getStarRating(store.review_avg||0)}</div>
                <div class="score-label">${store.review_count||0}件</div>
              </div>
              <div class="review-meta">
                <div class="review-meta-item"><i class="fas fa-map-marker-alt"></i> ${store.city||store.prefecture||'—'}</div>
                <div class="review-meta-item"><i class="fas fa-utensils"></i> ${store.genre||'—'}</div>
                ${store.review_avg >= 4.0 ? '<div class="review-meta-item"><i class="fas fa-star" style="color:var(--amber-500)"></i> 高評価店舗</div>' : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 狙い商材 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-bullseye"></i> 提案方針</div>
        </div>
        <div class="card-body">
          <div class="form-group">
            <div class="info-key" style="margin-bottom:8px">狙い商材</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${(store.target_service||'').split(',').filter(Boolean).map(s => `<span class="badge badge-blue">${s.trim()}</span>`).join('') || '<span class="text-muted">未設定</span>'}
            </div>
          </div>
          ${store.memo ? `<div class="form-group"><div class="info-key" style="margin-bottom:4px">指示メモ</div><div style="font-size:13px;line-height:1.7;color:var(--navy-700)">${store.memo}</div></div>` : ''}
        </div>
      </div>
    </div>

    <!-- Right Panel -->
    <div>
      <!-- Workflow -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title"><i class="fas fa-tasks"></i> アクション</div></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
          <button class="${!research ? 'btn-success' : 'btn-primary'}" onclick="navigate('research-detail',{id:'${id}'})"
            style="${!research ? 'font-size:14px;padding:12px 18px;' : ''}">
            <i class="fas fa-search"></i> ${!research ? '🔍 今すぐ調査開始' : '調査・分析を開く'}
          </button>
          <button class="btn-secondary" onclick="navigate('actions',{id:'${id}'})">
            <i class="fas fa-paper-plane"></i> 営業アクション
          </button>
          <button class="btn-secondary" onclick="navigate('pipeline')">
            <i class="fas fa-stream"></i> パイプラインで確認
          </button>
          ${deals.length ? `<button class="btn-secondary" onclick="navigate('deal-detail',{id:'${deals[0].id}'})">
            <i class="fas fa-handshake"></i> 商談詳細を見る
          </button>` : `<button class="btn-success" onclick="openNewDealModal('${id}')">
            <i class="fas fa-plus"></i> 商談を作成
          </button>`}
        </div>
      </div>

      <!-- Research Summary -->
      ${research ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-clipboard-check"></i> 調査サマリー</div>
          <button class="btn-ghost btn-sm" onclick="navigate('research-detail',{id:'${id}'})">詳細</button>
        </div>
        <div class="card-body">
          <div class="sw-grid">
            <div class="sw-card strength">
              <div class="sw-card-title"><i class="fas fa-thumbs-up"></i> 強み</div>
              <div class="sw-list">
                ${[research.strength1, research.strength2, research.strength3].filter(Boolean).map(s => `<div class="sw-item"><i class="fas fa-check-circle"></i><span>${s}</span></div>`).join('')}
              </div>
            </div>
            <div class="sw-card weakness">
              <div class="sw-card-title"><i class="fas fa-thumbs-down"></i> 弱み</div>
              <div class="sw-list">
                ${[research.weakness1, research.weakness2, research.weakness3].filter(Boolean).map(w => `<div class="sw-item"><i class="fas fa-times-circle"></i><span>${w}</span></div>`).join('')}
              </div>
            </div>
          </div>
          <div class="alert alert-info" style="margin-top:8px">
            <i class="fas fa-rocket"></i>
            <div><strong>営業フック</strong><br>${research.sales_hook||'—'}</div>
          </div>
        </div>
      </div>
      ` : `
      <div class="card" style="margin-bottom:16px">
        <div class="card-body" style="text-align:center;padding:30px">
          <i class="fas fa-search" style="font-size:28px;color:var(--slate-300);display:block;margin-bottom:10px"></i>
          <p class="text-muted" style="margin-bottom:12px">調査がまだ完了していません</p>
          <button class="btn-primary btn-sm" onclick="navigate('research-detail',{id:'${id}'})">
            <i class="fas fa-search"></i> 調査を開始
          </button>
        </div>
      </div>
      `}

      <!-- Deals -->
      ${deals.length ? `
      <div class="card">
        <div class="card-header"><div class="card-title"><i class="fas fa-handshake"></i> 商談履歴</div></div>
        <div class="card-body" style="padding:0">
          ${deals.map(d => `
          <div style="padding:12px 16px;border-bottom:1px solid var(--slate-100);cursor:pointer" onclick="navigate('deal-detail',{id:'${d.id}'})">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:13px;font-weight:600">${formatDate(d.date)}</span>
              <span class="badge ${d.status === '受注' ? 'badge-green' : d.status === '失注' ? 'badge-red' : 'badge-amber'}">${d.status}</span>
            </div>
            <div class="text-muted" style="margin-top:2px">${d.proposal||'—'}</div>
            <div style="font-size:13px;font-weight:700;color:var(--blue-600);margin-top:2px">${formatYen(d.estimate_amount)}</div>
          </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    </div>
  </div>
  `;
  renderPage(html);
}

function openStageModal(storeId) {
  const store = AppDB.getStore(storeId);
  const body = `
    <div class="form-group">
      <label class="form-label">ステージを変更</label>
      <select class="form-control" id="new-stage">
        ${STAGES.map(s => `<option value="${s.id}" ${store.stage === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
    </div>
  `;
  openModal('ステージ変更', body, `
    <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
    <button class="btn-primary" onclick="doUpdateStage('${storeId}')">更新</button>
  `);
}

function doUpdateStage(storeId) {
  const stage = document.getElementById('new-stage').value;
  AppDB.updateStore(storeId, { stage });
  closeModal();
  showToast('ステージを更新しました', 'success');
  navigate('store-detail', { id: storeId });
}

function openNewDealModal(storeId) {
  const store = AppDB.getStore(storeId);
  const body = `
    <div class="form-group">
      <label class="form-label">商談日</label>
      <input class="form-control" type="date" id="nd-date" value="${today()}">
    </div>
    <div class="form-group">
      <label class="form-label">商談形式</label>
      <select class="form-control" id="nd-type">
        <option>対面</option><option>オンライン</option><option>電話</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">提案内容</label>
      <input class="form-control" id="nd-proposal" placeholder="例：MEO対策初期+月額セット">
    </div>
    <div class="form-group">
      <label class="form-label">見積金額（円）</label>
      <input class="form-control" type="number" id="nd-amount" placeholder="110000">
    </div>
    <div class="form-group">
      <label class="form-label">ヒアリング内容</label>
      <textarea class="form-control" id="nd-disc" rows="3"></textarea>
    </div>
  `;
  openModal('商談を作成', body, `
    <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
    <button class="btn-primary" onclick="doCreateDeal('${storeId}')">作成</button>
  `);
}

function doCreateDeal(storeId) {
  const store = AppDB.getStore(storeId);
  const deal = AppDB.addDeal({
    store_id: storeId,
    store_name: store.name,
    date: document.getElementById('nd-date').value,
    meeting_type: document.getElementById('nd-type').value,
    proposal: document.getElementById('nd-proposal').value,
    estimate_amount: parseInt(document.getElementById('nd-amount').value) || 0,
    discussion: document.getElementById('nd-disc').value,
    status: '継続追客',
    assigned_sales: store.assigned_sales || '佐藤'
  });
  AppDB.updateStore(storeId, { stage: '商談化' });
  closeModal();
  showToast('商談を作成しました', 'success');
  navigate('deal-detail', { id: deal.id });
}

// =============================================
// Store Edit — 店舗情報編集
// 既存の store データをフォームに pre-fill して編集できる
// =============================================
function renderStoreEdit(id) {
  const store = AppDB.getStore(id);
  if (!store) {
    renderPage('<div class="empty-state"><i class="fas fa-store"></i><p>店舗が見つかりません</p></div>');
    return;
  }

  const html = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn-secondary btn-sm" onclick="navigate('store-detail',{id:'${id}'})">
        <i class="fas fa-arrow-left"></i>
      </button>
      <div>
        <div class="page-title">店舗情報編集</div>
        <div class="page-desc">${store.name} — 登録情報の修正・更新</div>
      </div>
    </div>
  </div>

  <div class="detail-layout">
    <div>
      <!-- 基本情報フォーム -->
      <div class="card" id="form-card">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-store"></i> 基本情報</div>
          <span class="badge badge-amber"><i class="fas fa-edit"></i> 編集モード</span>
        </div>
        <div class="card-body">

          <!-- 店名 + 業態 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">店名 <span class="required">*</span></label>
              <input class="form-control" id="fe-name" value="${escapeHtml(store.name||'')}">
            </div>
            <div class="form-group">
              <label class="form-label">業態</label>
              <select class="form-control" id="fe-genre">
                <option value="">選択してください</option>
                ${['居酒屋','ラーメン','カフェ','イタリアン','焼肉','寿司','中華','定食','カレー','その他'].map(g =>
                  `<option value="${g}" ${store.genre===g?'selected':''}>${g}</option>`
                ).join('')}
              </select>
            </div>
          </div>

          <!-- エリア -->
          <div class="form-row-3">
            <div class="form-group">
              <label class="form-label">都道府県</label>
              <input class="form-control" id="fe-prefecture" value="${escapeHtml(store.prefecture||'')}">
            </div>
            <div class="form-group">
              <label class="form-label">市区町村</label>
              <input class="form-control" id="fe-city" value="${escapeHtml(store.city||'')}">
            </div>
            <div class="form-group">
              <label class="form-label">住所・エリア詳細</label>
              <input class="form-control" id="fe-address" value="${escapeHtml(store.address||'')}">
            </div>
          </div>

          <!-- 電話 + 優先度 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">電話番号</label>
              <input class="form-control" id="fe-phone" value="${escapeHtml(store.phone||'')}">
            </div>
            <div class="form-group">
              <label class="form-label">優先度</label>
              <select class="form-control" id="fe-priority">
                <option value="高" ${store.priority==='高'?'selected':''}>高</option>
                <option value="中" ${store.priority==='中'?'selected':''}>中</option>
                <option value="低" ${store.priority==='低'?'selected':''}>低</option>
              </select>
            </div>
          </div>

          <!-- 担当者 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">担当企画</label>
              <select class="form-control" id="fe-planner">
                <option value="">未アサイン</option>
                <option value="佐藤" ${store.assigned_planner==='佐藤'?'selected':''}>佐藤</option>
                <option value="渡部" ${store.assigned_planner==='渡部'?'selected':''}>渡部</option>
                <option value="小泉" ${store.assigned_planner==='小泉'?'selected':''}>小泉</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">担当営業</label>
              <select class="form-control" id="fe-sales">
                <option value="">未アサイン</option>
                <option value="佐藤" ${store.assigned_sales==='佐藤'?'selected':''}>佐藤</option>
                <option value="渡部" ${store.assigned_sales==='渡部'?'selected':''}>渡部</option>
                <option value="小泉" ${store.assigned_sales==='小泉'?'selected':''}>小泉</option>
              </select>
            </div>
          </div>

          <div class="divider"></div>
          <div class="detail-section-title"><i class="fas fa-link"></i> WEB資産</div>

          <div class="form-group">
            <label class="form-label">食べログURL</label>
            <input class="form-control" id="fe-tabelog" value="${escapeHtml(store.memo?.match(/https:\/\/tabelog\.com\/[^\s]+/)?.[0]||'')}" placeholder="https://tabelog.com/...">
          </div>

          <div class="form-group">
            <label class="form-label">公式サイトURL</label>
            <input class="form-control" id="fe-site" value="${escapeHtml(store.site_url||'')}" placeholder="https://...">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">GoogleマップURL</label>
              <input class="form-control" id="fe-map" value="${escapeHtml(store.map_url||'')}" placeholder="https://maps.google.com/...">
            </div>
            <div class="form-group">
              <label class="form-label">Instagram URL</label>
              <input class="form-control" id="fe-instagram" value="${escapeHtml(store.instagram_url||'')}" placeholder="https://instagram.com/...">
            </div>
          </div>

          <!-- 口コミ -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">口コミ件数</label>
              <input class="form-control" type="number" id="fe-rcount" value="${store.review_count||0}">
            </div>
            <div class="form-group">
              <label class="form-label">平均評価（点）</label>
              <input class="form-control" type="number" id="fe-ravg" step="0.1" min="0" max="5" value="${store.review_avg||0}">
            </div>
          </div>

          <div class="divider"></div>

          <!-- フォーム判定 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">問い合わせフォーム</label>
              <select class="form-control" id="fe-form" onchange="onEditFormChange()">
                <option value="未確認" ${store.has_contact_form==='未確認'?'selected':''}>未確認</option>
                <option value="あり" ${store.has_contact_form==='あり'?'selected':''}>あり</option>
                <option value="なし" ${store.has_contact_form==='なし'?'selected':''}>なし</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">推奨チャネル</label>
              <div id="fe-channel-display">
                ${getChannelBadge(store.channel)}
              </div>
            </div>
          </div>

          <div class="divider"></div>
          <div class="detail-section-title"><i class="fas fa-bullseye"></i> 営業方針</div>

          <div class="form-group">
            <label class="form-label">狙いたい商材</label>
            <div class="checkbox-group" id="fe-services"></div>
          </div>

          <div class="form-group">
            <label class="form-label">指示メモ</label>
            <textarea class="form-control" id="fe-memo" rows="4">${escapeHtml(store.memo||'')}</textarea>
          </div>
        </div>

        <div class="card-footer" style="display:flex;gap:10px;justify-content:flex-end;align-items:center">
          <button class="btn-secondary" onclick="navigate('store-detail',{id:'${id}'})">キャンセル</button>
          <button class="btn-danger btn-sm" onclick="confirmDeleteStore('${id}')">
            <i class="fas fa-trash"></i> 削除
          </button>
          <button class="btn-primary" onclick="submitEditStore('${id}')">
            <i class="fas fa-save"></i> 保存
          </button>
        </div>
      </div>
    </div>

    <!-- Right sidebar -->
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title"><i class="fas fa-info-circle"></i> 登録情報</div></div>
        <div class="card-body">
          <div class="info-item" style="margin-bottom:8px">
            <div class="info-key">登録日</div>
            <div class="info-val text-muted">${formatDate(store.created_at)}</div>
          </div>
          <div class="info-item" style="margin-bottom:8px">
            <div class="info-key">最終更新</div>
            <div class="info-val text-muted">${formatDate(store.updated_at)}</div>
          </div>
          <div class="info-item">
            <div class="info-key">現在のステージ</div>
            <div class="info-val">${getStageBadge(store.stage)}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title"><i class="fas fa-exclamation-triangle" style="color:var(--amber-500)"></i> 注意</div></div>
        <div class="card-body">
          <p class="text-muted" style="font-size:12px;line-height:1.7">
            この画面では基本情報・WEB資産・方針を編集できます。<br>
            ステージの変更は店舗詳細画面から行ってください。<br><br>
            <strong>削除すると復元できません。</strong>
          </p>
        </div>
      </div>
    </div>
  </div>
  `;

  renderPage(html);
  initServiceCheckboxes('fe-services', store.target_service || '');
  onEditFormChange();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function onEditFormChange() {
  const val = document.getElementById('fe-form')?.value;
  const display = document.getElementById('fe-channel-display');
  if (!display) return;
  const channel = val === 'あり' ? 'DM推奨' : val === 'なし' ? 'テレアポ推奨' : '未判定';
  display.innerHTML = getChannelBadge(channel);
}

function submitEditStore(id) {
  const name = document.getElementById('fe-name').value.trim();
  if (!name) { showToast('店名を入力してください', 'error'); return; }

  const form_val = document.getElementById('fe-form').value;
  const channel = form_val === 'あり' ? 'DM推奨' : form_val === 'なし' ? 'テレアポ推奨' : '未判定';

  // 食べログURLをメモに記録
  const tabelogUrl = document.getElementById('fe-tabelog')?.value?.trim() || '';
  let memo = document.getElementById('fe-memo').value || '';
  if (tabelogUrl && !memo.includes('tabelog.com')) {
    memo = (memo ? memo + '\n' : '') + `食べログURL: ${tabelogUrl}`;
  }

  AppDB.updateStore(id, {
    name,
    prefecture: document.getElementById('fe-prefecture').value,
    city: document.getElementById('fe-city').value,
    address: document.getElementById('fe-address').value,
    genre: document.getElementById('fe-genre').value,
    priority: document.getElementById('fe-priority').value,
    phone: document.getElementById('fe-phone').value,
    site_url: document.getElementById('fe-site').value,
    map_url: document.getElementById('fe-map').value,
    instagram_url: document.getElementById('fe-instagram').value,
    has_contact_form: form_val,
    channel,
    target_service: getServiceValues('fe-services'),
    memo,
    review_count: parseInt(document.getElementById('fe-rcount').value) || 0,
    review_avg: parseFloat(document.getElementById('fe-ravg').value) || 0,
    assigned_planner: document.getElementById('fe-planner').value,
    assigned_sales: document.getElementById('fe-sales').value,
  });

  showToast(`「${name}」を更新しました`, 'success');
  navigate('store-detail', { id });
}

function confirmDeleteStore(id) {
  const store = AppDB.getStore(id);
  if (!store) return;
  openModal('店舗を削除', `
    <div class="alert alert-error">
      <i class="fas fa-exclamation-triangle"></i>
      <div>
        <strong>「${store.name}」を削除しますか？</strong><br>
        この操作は元に戻せません。関連する調査・商談データは残ります。
      </div>
    </div>
  `, `
    <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
    <button class="btn-danger" onclick="doDeleteStore('${id}')"><i class="fas fa-trash"></i> 削除する</button>
  `);
}

function doDeleteStore(id) {
  const store = AppDB.getStore(id);
  const name = store?.name || '店舗';
  AppDB.deleteStore(id);
  closeModal();
  showToast(`「${name}」を削除しました`);
  navigate('stores');
}
