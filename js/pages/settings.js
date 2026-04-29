// =============================================
// Settings Page — 設定・データ管理
// ver 1.1  (2026-04-07)
//
// 【手直しガイド】
//   ■ 担当者を増やしたい  → STAFF_LIST 配列に追加
//   ■ 商材を増やしたい    → app.js の initServiceCheckboxes() の services 配列
// =============================================

// 【手直し】担当者リストはここで管理
// この配列を変更すると、設定画面の担当者管理に反映されます
const STAFF_LIST_DEFAULT = ['佐藤', '渡部', '小泉'];

function renderSettings() {
  const stats = AppDB.getStats();
  const storageUsed = (() => {
    try {
      const raw = localStorage.getItem('fw_lead_os_v1') || '';
      return (new Blob([raw]).size / 1024).toFixed(1);
    } catch { return '—'; }
  })();

  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">設定・データ管理</div>
      <div class="page-desc">データのバックアップ・復元・初期化</div>
    </div>
  </div>

  <div class="two-col" style="align-items:start">
    <!-- Left Column -->
    <div>

      <!-- データ概要 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-database"></i> データ概要</div>
        </div>
        <div class="card-body">
          <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);gap:12px">
            <div style="padding:14px;background:var(--slate-50);border-radius:var(--radius);border:1px solid var(--slate-100);text-align:center">
              <div style="font-size:24px;font-weight:800;color:var(--blue-600)">${stats.total}</div>
              <div style="font-size:11px;color:var(--navy-400);margin-top:2px">登録店舗数</div>
            </div>
            <div style="padding:14px;background:var(--slate-50);border-radius:var(--radius);border:1px solid var(--slate-100);text-align:center">
              <div style="font-size:24px;font-weight:800;color:var(--purple-600)">${AppDB.getAllResearch().length}</div>
              <div style="font-size:11px;color:var(--navy-400);margin-top:2px">調査結果数</div>
            </div>
            <div style="padding:14px;background:var(--slate-50);border-radius:var(--radius);border:1px solid var(--slate-100);text-align:center">
              <div style="font-size:24px;font-weight:800;color:var(--amber-600)">${AppDB.getDeals().length}</div>
              <div style="font-size:11px;color:var(--navy-400);margin-top:2px">商談数</div>
            </div>
            <div style="padding:14px;background:var(--slate-50);border-radius:var(--radius);border:1px solid var(--slate-100);text-align:center">
              <div style="font-size:24px;font-weight:800;color:var(--green-600)">${AppDB.getHandoffs().length}</div>
              <div style="font-size:11px;color:var(--navy-400);margin-top:2px">引き継ぎ数</div>
            </div>
          </div>
          <div style="margin-top:12px;padding:10px 14px;background:var(--slate-50);border-radius:var(--radius-sm);border:1px solid var(--slate-100);display:flex;align-items:center;gap:8px">
            <i class="fas fa-hdd" style="color:var(--navy-400)"></i>
            <span style="font-size:12px;color:var(--navy-500)">ローカルストレージ使用量：<strong>${storageUsed} KB</strong></span>
          </div>
        </div>
      </div>

      <!-- バックアップ -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-download"></i> データバックアップ（エクスポート）</div>
        </div>
        <div class="card-body">
          <p style="font-size:13px;color:var(--navy-600);margin-bottom:14px;line-height:1.7">
            全データ（店舗・調査・商談・引き継ぎ）をJSONファイルとしてダウンロードできます。<br>
            定期的にバックアップを取ることを推奨します。
          </p>
          <button class="btn-primary" onclick="doExportData()">
            <i class="fas fa-download"></i> JSONファイルをダウンロード
          </button>
        </div>
      </div>

      <!-- インポート -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-upload"></i> データ復元（インポート）</div>
        </div>
        <div class="card-body">
          <div class="alert alert-warning" style="margin-bottom:14px">
            <i class="fas fa-exclamation-triangle"></i>
            <div>インポートすると現在のデータが上書きされます。事前にバックアップを取ってください。</div>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">JSONファイルを選択</label>
            <input type="file" accept=".json" id="import-file" class="form-control" style="padding:6px">
          </div>
          <button class="btn-secondary" onclick="doImportData()">
            <i class="fas fa-upload"></i> データを復元する
          </button>
        </div>
      </div>

    </div>

    <!-- Right Column -->
    <div>

      <!-- 使い方ガイド -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-book"></i> 手直しガイド</div>
        </div>
        <div class="card-body" style="padding:0">
          ${[
            { icon: 'fas fa-store', title: '担当者を増やしたい', desc: 'js/pages/settings.js の STAFF_LIST_DEFAULT に名前を追加してください。' },
            { icon: 'fas fa-boxes', title: '商材（サービス）を追加したい', desc: 'js/app.js の initServiceCheckboxes() 内の services 配列に追加してください。' },
            { icon: 'fas fa-stream', title: 'ステージ名を変えたい', desc: 'js/data.js の STAGES 配列の id/label を変更してください。' },
            { icon: 'fas fa-palette', title: 'デザインを変えたい', desc: 'css/style.css の :root 内のカラー変数を変更してください。' },
            { icon: 'fas fa-plus-circle', title: '新しい画面を追加したい', desc: 'js/pages/ に新しいJSファイルを作成し、app.js の switch 文と index.html のナビゲーションに追記してください。' },
          ].map(item => `
          <div style="padding:12px 16px;border-bottom:1px solid var(--slate-100);display:flex;gap:12px;align-items:flex-start">
            <span style="width:28px;height:28px;border-radius:50%;background:var(--blue-50);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
              <i class="${item.icon}" style="font-size:11px;color:var(--blue-600)"></i>
            </span>
            <div>
              <div style="font-size:12px;font-weight:700;color:var(--navy-700)">${item.title}</div>
              <div style="font-size:11px;color:var(--navy-400);margin-top:2px;line-height:1.6">${item.desc}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <!-- データリセット -->
      <div class="card" style="border:1px solid var(--red-100)">
        <div class="card-header" style="background:var(--red-50)">
          <div class="card-title" style="color:var(--red-600)"><i class="fas fa-exclamation-triangle"></i> 危険操作</div>
        </div>
        <div class="card-body">
          <p style="font-size:13px;color:var(--navy-600);margin-bottom:14px;line-height:1.7">
            以下の操作は<strong>元に戻せません</strong>。必ずバックアップを取ってから実行してください。
          </p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button class="btn-secondary" style="border-color:var(--amber-300);color:var(--amber-600)" onclick="confirmResetToSeed()">
              <i class="fas fa-undo"></i> サンプルデータに戻す
            </button>
            <button class="btn-danger" onclick="confirmClearAll()">
              <i class="fas fa-trash-alt"></i> 全データを削除する
            </button>
          </div>
        </div>
      </div>

    </div>
  </div>
  `;
  renderPage(html);
}

// ---- エクスポート ----
function doExportData() {
  try {
    AppDB.exportJSON();
    showToast('データをエクスポートしました', 'success');
  } catch(e) {
    showToast('エクスポートに失敗しました', 'error');
    console.error(e);
  }
}

// ---- インポート ----
function doImportData() {
  const file = document.getElementById('import-file')?.files[0];
  if (!file) { showToast('ファイルを選択してください', 'error'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    const ok = AppDB.importJSON(e.target.result);
    if (ok) {
      showToast('データをインポートしました', 'success');
      setTimeout(() => navigate('dashboard'), 800);
    } else {
      showToast('インポートに失敗しました。JSONファイルを確認してください', 'error');
    }
  };
  reader.readAsText(file);
}

// ---- リセット確認 ----
function confirmResetToSeed() {
  openModal('サンプルデータに戻す', `
    <div class="alert alert-warning">
      <i class="fas fa-exclamation-triangle"></i>
      <div>
        <strong>現在のデータが全て削除されます。</strong><br>
        サンプルの5店舗データに戻ります。この操作は元に戻せません。
      </div>
    </div>
  `, `
    <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
    <button class="btn-secondary" style="border-color:var(--amber-300);color:var(--amber-600)" onclick="doResetToSeed()">
      <i class="fas fa-undo"></i> リセットする
    </button>
  `);
}

function doResetToSeed() {
  AppDB.resetToSeed();
  closeModal();
  showToast('サンプルデータにリセットしました', 'success');
  setTimeout(() => navigate('dashboard'), 600);
}

// ---- 全削除確認 ----
function confirmClearAll() {
  openModal('全データを削除', `
    <div class="alert alert-error">
      <i class="fas fa-trash-alt"></i>
      <div>
        <strong>全てのデータが削除されます。</strong><br>
        店舗・調査・商談・引き継ぎデータが全て消えます。<br>
        この操作は<strong>絶対に元に戻せません。</strong>
      </div>
    </div>
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">確認のため「削除する」と入力してください</label>
      <input class="form-control" id="confirm-delete-text" placeholder="削除する">
    </div>
  `, `
    <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
    <button class="btn-danger" onclick="doClearAll()"><i class="fas fa-trash-alt"></i> 全て削除</button>
  `);
}

function doClearAll() {
  const val = document.getElementById('confirm-delete-text')?.value;
  if (val !== '削除する') {
    showToast('「削除する」と入力してください', 'error');
    return;
  }
  AppDB.clearAll();
  closeModal();
  showToast('全データを削除しました');
  setTimeout(() => navigate('dashboard'), 600);
}
