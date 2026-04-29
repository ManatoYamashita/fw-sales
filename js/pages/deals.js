// =============================================
// Deals Page (商談管理)
// =============================================

function renderDeals() {
  const deals = AppDB.getDeals();
  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">商談管理</div>
      <div class="page-desc">${deals.length}件の商談</div>
    </div>
  </div>

  <div class="card">
    <div class="table-container">
      ${deals.length ? `
      <table>
        <thead>
          <tr><th>店舗名</th><th>商談日</th><th>形式</th><th>提案内容</th><th>見積金額</th><th>担当</th><th>ステータス</th><th></th></tr>
        </thead>
        <tbody>
          ${deals.map(d => `
          <tr class="table-row-link" onclick="navigate('deal-detail',{id:'${d.id}'})">
            <td><div style="font-weight:700">${d.store_name}</div></td>
            <td>${formatDate(d.date)}</td>
            <td><span class="badge badge-gray">${d.meeting_type||'—'}</span></td>
            <td class="text-muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.proposal||'—'}</td>
            <td style="font-weight:700;color:var(--blue-600)">${formatYen(d.estimate_amount)}</td>
            <td class="text-muted">${d.assigned_sales||'—'}</td>
            <td><span class="badge ${d.status === '受注' ? 'badge-green' : d.status === '失注' ? 'badge-red' : d.status === '見積提出' ? 'badge-amber' : 'badge-gray'}">${d.status}</span></td>
            <td><button class="btn-icon" onclick="event.stopPropagation();navigate('deal-detail',{id:'${d.id}'})"><i class="fas fa-chevron-right"></i></button></td>
          </tr>
          `).join('')}
        </tbody>
      </table>` : `<div class="empty-state"><i class="fas fa-handshake"></i><p>商談がまだありません</p></div>`}
    </div>
  </div>`;
  renderPage(html);
}

function renderDealDetail(dealId) {
  const deal = AppDB.getDeal(dealId);
  if (!deal) { renderPage('<div class="empty-state"><p>商談が見つかりません</p></div>'); return; }
  const store = AppDB.getStore(deal.store_id);

  const html = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn-secondary btn-sm" onclick="navigate('deals')"><i class="fas fa-arrow-left"></i></button>
      <div>
        <div class="page-title">商談詳細 — ${deal.store_name}</div>
        <div class="page-desc">${formatDate(deal.date)} ・ ${deal.meeting_type||'—'}</div>
      </div>
    </div>
    <div class="page-actions">
      <span class="badge ${deal.status === '受注' ? 'badge-green' : deal.status === '失注' ? 'badge-red' : deal.status === '見積提出' ? 'badge-amber' : 'badge-gray'}" style="font-size:13px;padding:5px 12px">${deal.status}</span>
    </div>
  </div>

  <div class="detail-layout">
    <div>
      <div class="card" style="margin-bottom:20px">
        <div class="card-header"><div class="card-title"><i class="fas fa-info-circle"></i> 商談概要</div></div>
        <div class="card-body">
          <div class="info-grid">
            <div class="info-item"><div class="info-key">店舗名</div><div class="info-val" style="font-size:16px;font-weight:700">${deal.store_name}</div></div>
            <div class="info-item"><div class="info-key">商談日</div><div class="info-val">${formatDate(deal.date)}</div></div>
            <div class="info-item"><div class="info-key">形式</div><div class="info-val">${deal.meeting_type||'—'}</div></div>
            <div class="info-item"><div class="info-key">担当営業</div><div class="info-val">${deal.assigned_sales||'—'}</div></div>
            <div class="info-item"><div class="info-key">提案内容</div><div class="info-val">${deal.proposal||'—'}</div></div>
            <div class="info-item"><div class="info-key">見積金額</div><div class="info-val" style="font-size:18px;font-weight:700;color:var(--blue-600)">${formatYen(deal.estimate_amount)}</div></div>
            ${deal.order_amount ? `<div class="info-item"><div class="info-key">受注金額</div><div class="info-val" style="font-size:18px;font-weight:700;color:var(--green-600)">${formatYen(deal.order_amount)}</div></div>` : ''}
            ${deal.lost_reason ? `<div class="info-item"><div class="info-key">失注理由</div><div class="info-val" style="color:var(--red-600)">${deal.lost_reason}</div></div>` : ''}
          </div>
          ${deal.discussion ? `
          <div class="divider"></div>
          <div class="form-group">
            <div class="info-key" style="margin-bottom:6px">ヒアリング内容</div>
            <div style="font-size:13px;line-height:1.8;color:var(--navy-700);padding:12px;background:var(--slate-50);border-radius:var(--radius-sm)">${deal.discussion}</div>
          </div>` : ''}
        </div>
      </div>

      <!-- ステータス更新 -->
      <div class="card">
        <div class="card-header"><div class="card-title"><i class="fas fa-edit"></i> ステータス更新</div></div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">ステータス</label>
              <select class="form-control" id="deal-status">
                <option value="継続追客" ${deal.status === '継続追客' ? 'selected' : ''}>継続追客</option>
                <option value="見積提出" ${deal.status === '見積提出' ? 'selected' : ''}>見積提出</option>
                <option value="失注" ${deal.status === '失注' ? 'selected' : ''}>失注</option>
                <option value="受注" ${deal.status === '受注' ? 'selected' : ''}>受注</option>
              </select>
            </div>
            <div class="form-group" id="order-amount-area" style="${deal.status === '受注' ? '' : 'display:none'}">
              <label class="form-label">受注金額</label>
              <input class="form-control" type="number" id="deal-order-amount" value="${deal.order_amount||deal.estimate_amount||''}" placeholder="受注金額">
            </div>
          </div>
          <div class="form-group" id="lost-reason-area" style="${deal.status === '失注' ? '' : 'display:none'}">
            <label class="form-label">失注理由</label>
            <input class="form-control" id="deal-lost-reason" value="${deal.lost_reason||''}" placeholder="例：予算不足、競合に負けた、検討停止">
          </div>
        </div>
        <div class="card-footer" style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="navigate('deals')">戻る</button>
          <button class="btn-primary" onclick="doUpdateDeal('${dealId}')"><i class="fas fa-save"></i> 更新</button>
          ${deal.status === '受注' ? `<button class="btn-success" onclick="navigate('handoffs')"><i class="fas fa-exchange-alt"></i> 引き継ぎを作成</button>` : ''}
        </div>
      </div>
    </div>

    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title"><i class="fas fa-tasks"></i> アクション</div></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
          <button class="btn-secondary" onclick="navigate('store-detail',{id:'${deal.store_id}'})"><i class="fas fa-store"></i> 店舗詳細</button>
          <button class="btn-secondary" onclick="navigate('actions',{id:'${deal.store_id}'})"><i class="fas fa-paper-plane"></i> 営業アクション</button>
          ${deal.status === '受注' ? `<button class="btn-success" onclick="openHandoffModal('${deal.store_id}','${deal.id}')"><i class="fas fa-exchange-alt"></i> 引き継ぎ作成</button>` : ''}
        </div>
      </div>

      ${store ? `
      <div class="card">
        <div class="card-header"><div class="card-title"><i class="fas fa-store"></i> 店舗サマリー</div></div>
        <div class="card-body">
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">業態</div><div class="info-val">${store.genre||'—'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">エリア</div><div class="info-val">${store.city||'—'}</div></div>
          <div class="info-item"><div class="info-key">口コミ評価</div>
            <div class="info-val">
              <span style="color:var(--amber-600);font-weight:700;font-size:18px">${store.review_avg||'—'}</span>
              <span class="text-muted"> / ${store.review_count||0}件</span>
            </div>
          </div>
        </div>
      </div>
      ` : ''}
    </div>
  </div>
  `;
  renderPage(html);

  // Toggle areas on status change
  setTimeout(() => {
    const statusEl = document.getElementById('deal-status');
    if (statusEl) {
      statusEl.addEventListener('change', function() {
        const orderEl = document.getElementById('order-amount-area');
        const lostEl = document.getElementById('lost-reason-area');
        if (orderEl) orderEl.style.display = this.value === '受注' ? '' : 'none';
        if (lostEl) lostEl.style.display = this.value === '失注' ? '' : 'none';
      });
    }
  }, 100);
}

function doUpdateDeal(dealId) {
  const status = document.getElementById('deal-status')?.value;
  const order_amount = document.getElementById('deal-order-amount')?.value;
  const lost_reason = document.getElementById('deal-lost-reason')?.value;
  const deal = AppDB.getDeal(dealId);

  AppDB.updateDeal(dealId, { status, order_amount: parseInt(order_amount)||null, lost_reason });

  // Sync store stage
  if (deal) {
    const stageMap = { '受注': '受注', '失注': '失注', '見積提出': '見積提出', '継続追客': '商談化' };
    if (stageMap[status]) AppDB.updateStore(deal.store_id, { stage: stageMap[status] });
  }

  showToast('商談を更新しました', 'success');
  navigate('deal-detail', { id: dealId });
}

function openHandoffModal(storeId, dealId) {
  const store = AppDB.getStore(storeId);
  const deal = AppDB.getDeal(dealId);
  const body = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">契約サービス</label>
        <input class="form-control" id="hf-services" value="${deal?.proposal||''}" placeholder="HP制作、MEO対策...">
      </div>
      <div class="form-group">
        <label class="form-label">初期費用（円）</label>
        <input class="form-control" type="number" id="hf-init" value="${deal?.order_amount||deal?.estimate_amount||''}" placeholder="110000">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">月額費用（円）</label>
        <input class="form-control" type="number" id="hf-monthly" placeholder="22000">
      </div>
      <div class="form-group">
        <label class="form-label">契約期間</label>
        <input class="form-control" id="hf-period" placeholder="1年（自動更新）">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">運用担当</label>
      <select class="form-control" id="hf-ops">
        <option>小泉</option><option>佐藤</option><option>渡部</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">期待成果</label>
      <textarea class="form-control" id="hf-result" rows="2" placeholder="Googleマップ上位表示、新規来店増など"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">注意事項</label>
      <textarea class="form-control" id="hf-caution" rows="2" placeholder="オーナーの特徴、SNS不慣れなど"></textarea>
    </div>
  `;
  openModal('引き継ぎを作成', body, `
    <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
    <button class="btn-success" onclick="doCreateHandoff('${storeId}','${dealId}')"><i class="fas fa-exchange-alt"></i> 引き継ぎ作成</button>
  `);
}

function doCreateHandoff(storeId, dealId) {
  const store = AppDB.getStore(storeId);
  const h = AppDB.addHandoff({
    store_id: storeId,
    store_name: store?.name || '—',
    deal_id: dealId,
    contract_services: document.getElementById('hf-services')?.value || '',
    initial_fee: parseInt(document.getElementById('hf-init')?.value) || 0,
    monthly_fee: parseInt(document.getElementById('hf-monthly')?.value) || 0,
    contract_period: document.getElementById('hf-period')?.value || '',
    expected_result: document.getElementById('hf-result')?.value || '',
    ops_assignee: document.getElementById('hf-ops')?.value || '',
    caution: document.getElementById('hf-caution')?.value || '',
    contract_date: today(),
    status: '運用確認待ち'
  });
  AppDB.updateStore(storeId, { stage: '引き継ぎ待ち' });
  closeModal();
  showToast('引き継ぎを作成しました', 'success');
  navigate('handoff-detail', { id: h.id });
}
