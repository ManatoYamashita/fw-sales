// =============================================
// Pipeline Page (Kanban)
// =============================================

function renderPipeline() {
  const stores = AppDB.getStores();

  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">パイプライン</div>
      <div class="page-desc">営業進捗をKanban形式で管理</div>
    </div>
    <div class="page-actions">
      <button class="btn-secondary btn-sm" onclick="navigate('store-new')">
        <i class="fas fa-plus"></i> 店舗追加
      </button>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-body" style="padding:12px 20px">
      <div class="filter-bar" style="margin:0">
        <div class="search-box">
          <i class="fas fa-search"></i>
          <input class="form-control" id="pipe-search" placeholder="店名で検索..." onkeyup="renderKanbanBoard()">
        </div>
        <select class="form-control" id="pipe-priority" onchange="renderKanbanBoard()">
          <option value="">全優先度</option>
          <option value="高">高のみ</option>
          <option value="中">中のみ</option>
        </select>
        <select class="form-control" id="pipe-sales" onchange="renderKanbanBoard()">
          <option value="">全担当</option>
          <option value="渡部">渡部</option>
          <option value="佐藤">佐藤</option>
        </select>
      </div>
    </div>
  </div>

  <div class="kanban-board" id="kanban-board">
    <!-- Rendered by JS -->
  </div>
  `;
  renderPage(html);
  renderKanbanBoard();
}

function renderKanbanBoard() {
  const q = document.getElementById('pipe-search')?.value?.toLowerCase() || '';
  const priority = document.getElementById('pipe-priority')?.value || '';
  const sales = document.getElementById('pipe-sales')?.value || '';

  let stores = AppDB.getStores();
  if (q) stores = stores.filter(s => s.name.toLowerCase().includes(q));
  if (priority) stores = stores.filter(s => s.priority === priority);
  if (sales) stores = stores.filter(s => s.assigned_sales === sales);

  const board = document.getElementById('kanban-board');
  if (!board) return;

  board.innerHTML = STAGES.map(stage => {
    const cards = stores.filter(s => s.stage === stage.id);
    return `
    <div class="kanban-column">
      <div class="kanban-column-header">
        <span class="kanban-column-title" style="color:${stage.color}">${stage.label}</span>
        <span class="kanban-count">${cards.length}</span>
      </div>
      <div class="kanban-cards">
        ${cards.map(s => renderKanbanCard(s, stage)).join('') || `<div style="text-align:center;padding:20px;color:var(--slate-300);font-size:12px">なし</div>`}
      </div>
    </div>`;
  }).join('');
}

function renderKanbanCard(store, stage) {
  const research = AppDB.getResearch(store.id);
  return `
  <div class="kanban-card" onclick="navigate('store-detail',{id:'${store.id}'})">
    <div class="kanban-card-title">${store.name}</div>
    <div class="kanban-card-meta">
      <i class="fas fa-map-marker-alt"></i> ${store.city||store.prefecture||'—'} ・ ${store.genre||'—'}
    </div>
    ${research ? `<div class="kanban-card-meta text-muted" style="font-size:11px;margin-top:2px">
      <i class="fas fa-lightbulb"></i> ${research.entry_product||'提案仮説あり'}
    </div>` : ''}
    <div class="kanban-card-tags">
      ${getChannelBadge(store.channel)}
      ${getPriorityBadge(store.priority)}
    </div>
    ${store.assigned_sales ? `<div style="margin-top:8px;font-size:11px;color:var(--navy-400)"><i class="fas fa-user"></i> ${store.assigned_sales}</div>` : ''}
  </div>`;
}
