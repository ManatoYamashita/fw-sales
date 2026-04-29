// =============================================
// Firstweb Lead OS — App Core
// ver 1.1  (2026-04-07)
//
// 【手直しガイド】
//   ■ 画面を追加する    → navigate() の switch 文に case を追加
//                         → sidebar の nav-item を追加
//                         → js/pages/xxx.js を新規作成
//   ■ 商材を追加・変更  → initServiceCheckboxes() の services 配列
//   ■ 担当者を変更      → 各 select の option / SEED_STORES の assigned_*
//   ■ ページタイトルを変える → breadcrumbs オブジェクト
//
// 【将来の拡張ポイント】
//   ■ データ永続化      → AppDB は localStorage + シードデータ構成。
//                         サーバーAPIが用意できたら _save() を fetch に差し替え可。
//   ■ ユーザー認証      → sidebar-footer のユーザー情報は静的。
//                         将来は localStorage に現ユーザーを保存する想定。
// =============================================

let currentPage  = 'dashboard';
let currentParams = {};
let sidebarOpen  = false;

// =============================================
// ページルーター
// =============================================
function navigate(page, params = {}) {
  currentPage   = page;
  currentParams = params;

  // ---- ナビのアクティブ更新 ----
  document.querySelectorAll('.nav-item').forEach(el => {
    const dp = el.dataset.page;
    el.classList.toggle('active',
      dp === page ||
      (dp === 'stores'   && page === 'store-detail') ||
      (dp === 'stores'   && page === 'store-new')    ||
      (dp === 'stores'   && page === 'store-edit')   ||
      (dp === 'research' && page === 'research-detail') ||
      (dp === 'deals'    && page === 'deal-detail')  ||
      (dp === 'handoffs' && page === 'handoff-detail') ||
      (dp === 'actions'  && page === 'actions')
    );
  });

  // ---- パンくず ----
  const breadcrumbs = {
    'dashboard':        'ダッシュボード',
    'stores':           '店舗一覧',
    'store-new':        '店舗登録',
    'store-edit':       '店舗情報編集',
    'store-detail':     '店舗詳細',
    'research':         '調査キュー',
    'research-detail':  '調査結果',
    'actions':          '営業アクション',
    'pipeline':         'パイプライン',
    'deals':            '商談管理',
    'deal-detail':      '商談詳細',
    'handoffs':         '引き継ぎ',
    'handoff-detail':   '引き継ぎ詳細',
    'kpi':              'KPI分析',
    'settings':         '設定・データ管理'
  };
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = breadcrumbs[page] || page;

  // ---- ローディング ----
  const main = document.getElementById('main-content');
  if (!main) return;
  main.innerHTML = '<div class="loading"><div class="spinner"></div>読み込み中...</div>';

  // 非同期で描画（UIブロックしない）
  requestAnimationFrame(() => {
    setTimeout(() => {
      try {
        switch (page) {
          case 'dashboard':       renderDashboard();              break;
          case 'stores':          renderStores();                 break;
          case 'store-new':       renderStoreNew();               break;
          case 'store-edit':      renderStoreEdit(params.id);     break;
          case 'store-detail':    renderStoreDetail(params.id);   break;
          case 'research':        renderResearch();               break;
          case 'research-detail': renderResearchDetail(params.id);break;
          case 'actions':         renderActions(params.id);       break;
          case 'pipeline':        renderPipeline();               break;
          case 'deals':           renderDeals();                  break;
          case 'deal-detail':     renderDealDetail(params.id);    break;
          case 'handoffs':        renderHandoffs();               break;
          case 'handoff-detail':  renderHandoffDetail(params.id); break;
          case 'kpi':             renderKPI();                    break;
          case 'settings':        renderSettings();               break;
          default:
            main.innerHTML = '<div class="empty-state"><i class="fas fa-map"></i><p>ページが見つかりません</p></div>';
        }
      } catch (e) {
        console.error('[LeadOS] render error:', e);
        main.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-exclamation-triangle" style="color:var(--amber-500)"></i>
            <p style="margin-top:8px;color:var(--navy-600)">表示中にエラーが発生しました</p>
            <p class="text-muted" style="font-size:11px;margin-top:4px">${e.message}</p>
            <button class="btn-secondary btn-sm" style="margin-top:12px" onclick="navigate('dashboard')">
              ダッシュボードへ戻る
            </button>
          </div>`;
      }
      updateBadges();
      if (window.innerWidth <= 768) closeSidebar();
    }, 30);
  });
}

// =============================================
// サイドバー開閉
// =============================================
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open', sidebarOpen);
}
function closeSidebar() {
  sidebarOpen = false;
  document.getElementById('sidebar')?.classList.remove('open');
}

// =============================================
// バッジ更新
// =============================================
function updateBadges() {
  const stats = AppDB.getStats();
  setElText('badge-stores',   stats.total);
  setElText('badge-research', stats.waitResearch);
  setElText('badge-pipeline', stats.deals_stage);
  setElText('badge-handoffs', AppDB.getHandoffs().filter(h => h.status !== '完了').length);
}
function setElText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// =============================================
// モーダル
// =============================================
function openModal(title, bodyHTML, footerHTML = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = bodyHTML;
  document.getElementById('modal-footer').innerHTML  = footerHTML;
  document.getElementById('modal-overlay').classList.add('show');
  document.getElementById('modal').classList.add('show');
  // Esc で閉じる
  document._modalEscHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', document._modalEscHandler);
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
  document.getElementById('modal').classList.remove('show');
  if (document._modalEscHandler) {
    document.removeEventListener('keydown', document._modalEscHandler);
    document._modalEscHandler = null;
  }
}

// =============================================
// トースト通知
// =============================================
let _toastTimer;
function showToast(msg, type = 'default') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : '✓';
  toast.innerHTML = `<span>${icon}</span> ${msg}`;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// =============================================
// タブ切替
// =============================================
function switchTab(tabsId, tabId) {
  document.querySelectorAll(`#${tabsId} .tab`).forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('[data-tab-content]').forEach(c =>
    c.classList.toggle('active', c.dataset.tabContent === tabId));
}

// =============================================
// ページレンダリング（共通）
// =============================================
function renderPage(html) {
  const main = document.getElementById('main-content');
  if (main) main.innerHTML = html;
}

// =============================================
// サービスチェックボックス
// 【手直し】商材を追加・変更する場合はここの services 配列を編集
// =============================================
function initServiceCheckboxes(containerId, currentVal = '') {
  const services = ['MEO', 'HP', 'インスタ', '動画', 'コンサル', 'グルメサイト', 'おまかせ'];
  const selected = currentVal ? currentVal.split(',').map(s => s.trim()).filter(Boolean) : [];
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  services.forEach(s => {
    const label = document.createElement('label');
    label.className = 'checkbox-item' + (selected.includes(s) ? ' active' : '');
    label.innerHTML = `<input type="checkbox" value="${s}" ${selected.includes(s) ? 'checked' : ''}><span>${s}</span>`;
    label.addEventListener('click', function() {
      const cb = this.querySelector('input');
      cb.checked = !cb.checked;
      this.classList.toggle('active', cb.checked);
    });
    container.appendChild(label);
  });
}

function getServiceValues(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return '';
  return Array.from(container.querySelectorAll('input:checked')).map(i => i.value).join(',');
}

// =============================================
// 初期化
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  // サイドバー外クリックで閉じる（モバイル）
  document.addEventListener('click', (e) => {
    if (sidebarOpen && !e.target.closest('#sidebar') && !e.target.closest('.hamburger')) {
      closeSidebar();
    }
  });
  navigate('dashboard');
});
