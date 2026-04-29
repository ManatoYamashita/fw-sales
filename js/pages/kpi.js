// =============================================
// KPI Page
// =============================================

function renderKPI() {
  const stores = AppDB.getStores();
  const stats = AppDB.getStats();

  const total = stores.length || 1;
  const surveyed = stores.filter(s => s.stage !== '調査待ち').length;
  const dm = stores.filter(s => s.channel === 'DM推奨').length;
  const tel = stores.filter(s => s.channel === 'テレアポ推奨').length;
  const contacted = stores.filter(s => ['DM送信済み','テレアポ済み','反応あり','商談化','見積提出','受注','引き継ぎ待ち','引き継ぎ完了'].includes(s.stage)).length;
  const negotiating = stores.filter(s => ['商談化','見積提出'].includes(s.stage)).length;
  const orders = stores.filter(s => ['受注','引き継ぎ待ち','引き継ぎ完了'].includes(s.stage)).length;

  const surveyRate = Math.round((surveyed / total) * 100);
  const contactRate = surveyed > 0 ? Math.round((contacted / surveyed) * 100) : 0;
  const dealRate = contacted > 0 ? Math.round((negotiating / contacted) * 100) : 0;
  const orderRate = negotiating > 0 ? Math.round((orders / (orders + negotiating)) * 100) : 0;

  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">KPI分析</div>
      <div class="page-desc">営業プロセスの変換率・実績サマリー</div>
    </div>
  </div>

  <!-- Funnel -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-header"><div class="card-title"><i class="fas fa-filter"></i> 営業ファネル</div></div>
    <div class="card-body">
      <div style="display:flex;align-items:stretch;gap:0;overflow-x:auto">
        ${renderFunnelBar('店舗登録', total, total, '#3b82f6', '#dbeafe')}
        <div style="display:flex;align-items:center;padding:0 4px;color:var(--slate-300)"><i class="fas fa-arrow-right"></i></div>
        ${renderFunnelBar('調査完了', surveyed, total, '#7c3aed', '#ede9fe')}
        <div style="display:flex;align-items:center;padding:0 4px;color:var(--slate-300)"><i class="fas fa-arrow-right"></i></div>
        ${renderFunnelBar('一次接触', contacted, total, '#d97706', '#fef3c7')}
        <div style="display:flex;align-items:center;padding:0 4px;color:var(--slate-300)"><i class="fas fa-arrow-right"></i></div>
        ${renderFunnelBar('商談化', negotiating, total, '#16a34a', '#dcfce7')}
        <div style="display:flex;align-items:center;padding:0 4px;color:var(--slate-300)"><i class="fas fa-arrow-right"></i></div>
        ${renderFunnelBar('受注', orders, total, '#166534', '#86efac')}
      </div>
    </div>
  </div>

  <!-- Rates -->
  <div class="stat-grid" style="margin-bottom:24px">
    <div class="stat-card">
      <div class="stat-icon purple"><i class="fas fa-percentage"></i></div>
      <div class="stat-label">調査完了率</div>
      <div class="stat-value">${surveyRate}%</div>
      <div class="stat-sub">${surveyed} / ${total}件</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon amber"><i class="fas fa-paper-plane"></i></div>
      <div class="stat-label">接触率</div>
      <div class="stat-value">${contactRate}%</div>
      <div class="stat-sub">${contacted} / ${surveyed}件</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><i class="fas fa-handshake"></i></div>
      <div class="stat-label">商談化率</div>
      <div class="stat-value">${dealRate}%</div>
      <div class="stat-sub">${negotiating} / ${contacted}件</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon blue"><i class="fas fa-check-circle"></i></div>
      <div class="stat-label">受注率</div>
      <div class="stat-value">${orderRate}%</div>
      <div class="stat-sub">${orders}件受注</div>
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

  <!-- Channel breakdown -->
  <div class="two-col">
    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fas fa-chart-pie"></i> チャネル内訳</div></div>
      <div class="card-body">
        ${renderChannelBreakdown(dm, tel, stores.length - dm - tel)}
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fas fa-store"></i> ステージ別件数</div></div>
      <div class="card-body">
        ${renderStageCounts()}
      </div>
    </div>
  </div>

  <!-- Priority breakdown -->
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title"><i class="fas fa-list"></i> 商材別提案状況</div></div>
    <div class="card-body">
      ${renderServiceBreakdown()}
    </div>
  </div>
  `;
  renderPage(html);
}

function renderFunnelBar(label, count, total, color, bg) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
  <div style="text-align:center;min-width:90px;flex:1">
    <div style="font-size:28px;font-weight:800;color:${color}">${count}</div>
    <div style="font-size:11px;color:var(--navy-400);margin:2px 0">${label}</div>
    <div style="height:6px;background:${bg};border-radius:3px;margin-top:4px;position:relative">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width 0.5s"></div>
    </div>
    <div style="font-size:10px;color:var(--slate-300);margin-top:2px">${pct}%</div>
  </div>`;
}

function renderChannelBreakdown(dm, tel, other) {
  const total = dm + tel + other || 1;
  const items = [
    { label: 'DM推奨', count: dm, color: 'var(--green-500)', bg: 'var(--green-100)' },
    { label: 'テレアポ推奨', count: tel, color: 'var(--blue-500)', bg: 'var(--blue-100)' },
    { label: '未判定', count: other, color: 'var(--slate-300)', bg: 'var(--slate-100)' }
  ];
  return items.map(it => `
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
    <div style="width:12px;height:12px;border-radius:50%;background:${it.color};flex-shrink:0"></div>
    <div style="flex:1">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:13px;font-weight:600">${it.label}</span>
        <span style="font-size:13px;font-weight:700">${it.count}件</span>
      </div>
      <div style="height:8px;background:var(--slate-100);border-radius:4px">
        <div style="height:100%;width:${Math.round((it.count/total)*100)}%;background:${it.color};border-radius:4px;transition:width 0.5s"></div>
      </div>
    </div>
  </div>`).join('');
}

function renderStageCounts() {
  const stores = AppDB.getStores();
  return STAGES.slice(0, 8).map(s => {
    const count = stores.filter(st => st.stage === s.id).length;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--slate-100)">
      <span class="stage-badge" style="background:${s.bg};color:${s.color}">${s.label}</span>
      <span style="font-weight:700;font-size:16px;color:${s.color}">${count}</span>
    </div>`;
  }).join('');
}

function renderServiceBreakdown() {
  const services = ['MEO', 'HP', 'インスタ', '動画', 'コンサル'];
  const stores = AppDB.getStores();
  return `<div style="display:flex;flex-wrap:wrap;gap:20px">
    ${services.map(svc => {
      const count = stores.filter(s => (s.target_service||'').includes(svc)).length;
      return `
      <div style="text-align:center;min-width:80px">
        <div style="font-size:26px;font-weight:800;color:var(--blue-600)">${count}</div>
        <div style="font-size:12px;color:var(--navy-400);margin-top:2px">${svc}</div>
        <div class="badge badge-blue" style="margin-top:4px;font-size:10px">提案対象</div>
      </div>`;
    }).join('')}
  </div>`;
}
