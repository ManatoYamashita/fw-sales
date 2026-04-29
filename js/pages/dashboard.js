// =============================================
// Dashboard Page
// =============================================

function renderDashboard() {
  const stats = AppDB.getStats();
  const stores = AppDB.getStores();
  const recentStores = stores.slice(0, 5);

  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">ダッシュボード</div>
      <div class="page-desc">Firstweb Lead OS — 飲食店WEB集客支援営業管理</div>
    </div>
    <div class="page-actions">
      <button class="btn-primary" onclick="navigate('store-new')">
        <i class="fas fa-plus"></i> 店舗登録
      </button>
    </div>
  </div>

  <!-- KPI Cards -->
  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-icon blue"><i class="fas fa-store"></i></div>
      <div class="stat-label">登録店舗数</div>
      <div class="stat-value">${stats.total}</div>
      <div class="stat-sub">全登録店舗</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon amber"><i class="fas fa-search"></i></div>
      <div class="stat-label">調査待ち</div>
      <div class="stat-value">${stats.waitResearch}</div>
      <div class="stat-sub">未調査</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><i class="fas fa-envelope"></i></div>
      <div class="stat-label">DM推奨</div>
      <div class="stat-value">${stats.dm}</div>
      <div class="stat-sub">フォームあり判定</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon blue"><i class="fas fa-phone"></i></div>
      <div class="stat-label">テレアポ推奨</div>
      <div class="stat-value">${stats.tel}</div>
      <div class="stat-sub">フォームなし判定</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple"><i class="fas fa-handshake"></i></div>
      <div class="stat-label">商談中</div>
      <div class="stat-value">${stats.deals_stage}</div>
      <div class="stat-sub">商談化〜見積提出</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
      <div class="stat-label">受注件数</div>
      <div class="stat-value">${stats.orders}</div>
      <div class="stat-sub">受注済み</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon amber"><i class="fas fa-yen-sign"></i></div>
      <div class="stat-label">受注総額</div>
      <div class="stat-value" style="font-size:18px">${formatYen(stats.totalRevenue)}</div>
      <div class="stat-sub">初期費用合計</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><i class="fas fa-sync"></i></div>
      <div class="stat-label">月額ストック</div>
      <div class="stat-value" style="font-size:18px">${formatYen(stats.monthlyRev)}</div>
      <div class="stat-sub">月額合計</div>
    </div>
  </div>

  <!-- 2 columns -->
  <div class="two-col">
    <!-- Recent Stores -->
    <div class="card">
      <div class="card-header">
        <div class="card-title"><i class="fas fa-store"></i> 最新登録店舗</div>
        <button class="btn-ghost btn-sm" onclick="navigate('stores')">全件見る</button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>店舗名</th>
              <th>チャネル</th>
              <th>ステージ</th>
              <th>優先</th>
            </tr>
          </thead>
          <tbody>
            ${recentStores.map(s => `
            <tr class="table-row-link" onclick="navigate('store-detail', {id:'${s.id}'})">
              <td>
                <div style="font-weight:600">${s.name}</div>
                <div style="font-size:11px;color:var(--navy-400)">${s.city}</div>
              </td>
              <td>${getChannelBadge(s.channel)}</td>
              <td>${getStageBadge(s.stage)}</td>
              <td>${getPriorityBadge(s.priority)}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Action Queue -->
    <div class="card">
      <div class="card-header">
        <div class="card-title"><i class="fas fa-bolt"></i> アクションキュー</div>
      </div>
      <div class="card-body" style="padding:0">
        ${renderActionQueue()}
      </div>
    </div>
  </div>

  <!-- Pipeline Summary -->
  <div class="card" style="margin-top:20px">
    <div class="card-header">
      <div class="card-title"><i class="fas fa-stream"></i> パイプラインサマリー</div>
      <button class="btn-ghost btn-sm" onclick="navigate('pipeline')">Kanbanを開く</button>
    </div>
    <div class="card-body">
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${renderPipelineSummaryBars()}
      </div>
    </div>
  </div>
  `;
  renderPage(html);
}

function renderActionQueue() {
  const items = [];
  AppDB.getStores().forEach(s => {
    if (s.stage === '調査待ち') {
      items.push({ icon: 'fas fa-search', color: 'var(--amber-500)', label: '調査未着手', name: s.name, action: `navigate('research-detail','${s.id}')`, storeId: s.id });
    }
    if (s.stage === '調査完了') {
      items.push({ icon: 'fas fa-paper-plane', color: 'var(--blue-500)', label: '接触アクション未作成', name: s.name, action: `navigate('actions', {id:'${s.id}'})`, storeId: s.id });
    }
    if (s.stage === '引き継ぎ待ち') {
      items.push({ icon: 'fas fa-exchange-alt', color: 'var(--green-600)', label: '引き継ぎ待ち', name: s.name, action: `navigate('handoffs')`, storeId: s.id });
    }
  });

  if (!items.length) return '<div class="empty-state" style="padding:30px"><i class="fas fa-check-double"></i><p>全てのアクション完了</p></div>';

  return `<ul style="border-top:1px solid var(--slate-100)">
    ${items.slice(0,6).map(it => `
    <li style="padding:12px 20px;border-bottom:1px solid var(--slate-100);display:flex;align-items:center;gap:12px;">
      <span style="width:32px;height:32px;border-radius:50%;background:${it.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="${it.icon}" style="color:${it.color};font-size:13px"></i>
      </span>
      <div style="flex:1;cursor:pointer" onclick="navigate('store-detail',{id:'${it.storeId}'})">
        <div style="font-size:13px;font-weight:600">${it.name}</div>
        <div style="font-size:11px;color:var(--navy-400)">${it.label}</div>
      </div>
      ${it.label === '調査未着手'
        ? `<button class="btn-primary btn-sm" onclick="navigate('research-detail',{id:'${it.storeId}'})">
             <i class="fas fa-search"></i> 調査開始
           </button>`
        : `<button class="btn-ghost btn-sm" onclick="navigate('${it.label === '接触アクション未作成' ? 'actions' : 'handoffs'}',${it.label === '接触アクション未作成' ? '{id:\'' + it.storeId + '\'}' : '{}'})">
             <i class="fas fa-arrow-right"></i>
           </button>`
      }
    </li>
    `).join('')}
  </ul>`;
}

function renderPipelineSummaryBars() {
  return STAGES.slice(0, 10).map(stage => {
    const count = AppDB.getStores().filter(s => s.stage === stage.id).length;
    return `
    <div style="text-align:center;min-width:80px;cursor:pointer" onclick="navigate('pipeline')">
      <div style="font-size:22px;font-weight:800;color:${stage.color}">${count}</div>
      <div style="font-size:10px;color:var(--navy-400);margin-top:2px">${stage.label}</div>
      <div style="height:4px;background:${stage.bg};border-radius:2px;margin-top:4px;border:1px solid ${stage.color}33"></div>
    </div>`;
  }).join('');
}
