// =============================================
// Handoffs Page (引き継ぎ)
// =============================================

function renderHandoffs() {
  const handoffs = AppDB.getHandoffs();
  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">引き継ぎ管理</div>
      <div class="page-desc">受注後、営業→運用への引き継ぎ状況</div>
    </div>
  </div>

  <div class="card">
    <div class="table-container">
      ${handoffs.length ? `
      <table>
        <thead>
          <tr><th>店舗名</th><th>契約サービス</th><th>初期費用</th><th>月額</th><th>運用担当</th><th>契約日</th><th>ステータス</th><th></th></tr>
        </thead>
        <tbody>
          ${handoffs.map(h => `
          <tr class="table-row-link" onclick="navigate('handoff-detail',{id:'${h.id}'})">
            <td><div style="font-weight:700">${h.store_name}</div></td>
            <td class="text-muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.contract_services||'—'}</td>
            <td style="font-weight:700;color:var(--blue-600)">${formatYen(h.initial_fee)}</td>
            <td style="font-weight:700;color:var(--green-600)">${formatYen(h.monthly_fee)}/月</td>
            <td class="text-muted">${h.ops_assignee||'—'}</td>
            <td class="text-muted">${formatDate(h.contract_date)}</td>
            <td><span class="badge ${h.status === '完了' ? 'badge-green' : h.status === '運用確認待ち' ? 'badge-amber' : 'badge-gray'}">${h.status}</span></td>
            <td><button class="btn-icon" onclick="event.stopPropagation();navigate('handoff-detail',{id:'${h.id}'})"><i class="fas fa-chevron-right"></i></button></td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      ` : `<div class="empty-state"><i class="fas fa-exchange-alt"></i><p>引き継ぎがまだありません</p></div>`}
    </div>
  </div>`;
  renderPage(html);
}

function renderHandoffDetail(handoffId) {
  const h = AppDB.getHandoff(handoffId);
  if (!h) { renderPage('<div class="empty-state"><p>引き継ぎが見つかりません</p></div>'); return; }
  const store = AppDB.getStore(h.store_id);
  const research = AppDB.getResearch(h.store_id);

  const checklist = [
    { id: 'chk1', label: '契約内容確認済み', done: true },
    { id: 'chk2', label: '初回入金確認済み', done: !!h.payment_confirmed },
    { id: 'chk3', label: '運用担当アサイン済み', done: !!h.ops_assignee },
    { id: 'chk4', label: '必要素材依頼済み', done: !!h.materials_status },
    { id: 'chk5', label: '管理部共有済み', done: h.status === '完了' }
  ];

  const html = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn-secondary btn-sm" onclick="navigate('handoffs')"><i class="fas fa-arrow-left"></i></button>
      <div>
        <div class="page-title">引き継ぎ詳細 — ${h.store_name}</div>
        <div class="page-desc">契約日: ${formatDate(h.contract_date)}</div>
      </div>
    </div>
    <div class="page-actions">
      <span class="badge ${h.status === '完了' ? 'badge-green' : 'badge-amber'}" style="font-size:13px;padding:5px 12px">${h.status}</span>
    </div>
  </div>

  <div class="detail-layout">
    <div>
      <!-- 契約内容 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-file-contract"></i> 契約内容</div>
        </div>
        <div class="card-body">
          <div class="info-grid-3" style="margin-bottom:16px">
            <div class="info-item">
              <div class="info-key">初期費用</div>
              <div class="info-val" style="font-size:22px;font-weight:800;color:var(--blue-600)">${formatYen(h.initial_fee)}</div>
            </div>
            <div class="info-item">
              <div class="info-key">月額費用</div>
              <div class="info-val" style="font-size:22px;font-weight:800;color:var(--green-600)">${formatYen(h.monthly_fee)}<span style="font-size:13px;font-weight:500">/月</span></div>
            </div>
            <div class="info-item">
              <div class="info-key">契約期間</div>
              <div class="info-val">${h.contract_period||'—'}</div>
            </div>
          </div>
          <div class="info-item" style="margin-bottom:12px">
            <div class="info-key">契約サービス</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
              ${(h.contract_services||'').split('、').concat((h.contract_services||'').split(',')).filter((v,i,a) => v.trim() && a.indexOf(v) === i).map(s => `<span class="badge badge-blue">${s.trim()}</span>`).join('')}
            </div>
          </div>
          <div class="info-grid">
            <div class="info-item"><div class="info-key">契約名義</div><div class="info-val">${h.contract_owner||'佐藤（Firstweb）'}</div></div>
            <div class="info-item"><div class="info-key">運用担当</div><div class="info-val" style="font-weight:700">${h.ops_assignee||'—'}</div></div>
            <div class="info-item"><div class="info-key">納期</div><div class="info-val">${h.due_date||'—'}</div></div>
            <div class="info-item"><div class="info-key">初回入金確認</div><div class="info-val">${h.payment_confirmed ? `<span style="color:var(--green-600)"><i class="fas fa-check-circle"></i> 確認済み</span>` : '<span style="color:var(--amber-600)">未確認</span>'}</div></div>
          </div>
        </div>
      </div>

      <!-- 期待成果・注意事項 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-clipboard"></i> 引き継ぎ情報</div>
        </div>
        <div class="card-body">
          ${h.expected_result ? `
          <div class="form-group">
            <div class="info-key">期待成果</div>
            <div class="alert alert-success" style="margin-top:6px"><i class="fas fa-target"></i><div>${h.expected_result}</div></div>
          </div>` : ''}
          ${h.materials_status ? `
          <div class="form-group">
            <div class="info-key">素材状況</div>
            <div style="font-size:13px;line-height:1.7;margin-top:4px;color:var(--navy-700)">${h.materials_status}</div>
          </div>` : ''}
          ${h.caution ? `
          <div class="form-group">
            <div class="info-key">注意事項</div>
            <div class="alert alert-warning" style="margin-top:6px"><i class="fas fa-exclamation-triangle"></i><div>${h.caution}</div></div>
          </div>` : ''}
          ${h.ng_items ? `
          <div class="form-group">
            <div class="info-key">NG事項</div>
            <div class="alert alert-error" style="margin-top:6px"><i class="fas fa-ban"></i><div>${h.ng_items}</div></div>
          </div>` : ''}
        </div>
      </div>

      <!-- チェックリスト -->
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-tasks"></i> 引き継ぎチェックリスト</div>
          <span class="text-muted">${checklist.filter(c => c.done).length} / ${checklist.length} 完了</span>
        </div>
        <div class="card-body" style="padding:0">
          ${checklist.map(c => `
          <div style="padding:14px 20px;border-bottom:1px solid var(--slate-100);display:flex;align-items:center;gap:12px">
            <div style="width:22px;height:22px;border-radius:50%;${c.done ? 'background:var(--green-100)' : 'background:var(--slate-100)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <i class="${c.done ? 'fas fa-check' : 'far fa-circle'}" style="font-size:11px;color:${c.done ? 'var(--green-600)' : 'var(--slate-300)'}"></i>
            </div>
            <span style="font-size:13px;color:${c.done ? 'var(--navy-800)' : 'var(--navy-400)'}">${c.label}</span>
          </div>`).join('')}
        </div>
        <div class="card-footer" style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="navigate('handoffs')">戻る</button>
          ${h.status !== '完了' ? `<button class="btn-success" onclick="doCompleteHandoff('${h.id}')"><i class="fas fa-check-circle"></i> 引き継ぎ完了</button>` : ''}
        </div>
      </div>
    </div>

    <!-- Right -->
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title"><i class="fas fa-store"></i> 店舗情報</div></div>
        <div class="card-body">
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">店名</div><div class="info-val" style="font-size:16px;font-weight:700">${h.store_name}</div></div>
          ${store ? `
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">業態</div><div class="info-val">${store.genre||'—'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">エリア</div><div class="info-val">${store.city||'—'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">電話</div><div class="info-val">${store.phone||'—'}</div></div>
          ` : ''}
        </div>
      </div>

      ${research ? `
      <div class="card">
        <div class="card-header"><div class="card-title"><i class="fas fa-lightbulb"></i> 営業企画メモ</div></div>
        <div class="card-body">
          <div class="sw-card strength" style="margin-bottom:10px">
            <div class="sw-card-title"><i class="fas fa-thumbs-up"></i> 強み</div>
            <div class="sw-list">
              ${[research.strength1, research.strength2, research.strength3].filter(Boolean).map(s => `<div class="sw-item"><i class="fas fa-check-circle"></i><span>${s}</span></div>`).join('')}
            </div>
          </div>
          <div class="info-item"><div class="info-key">営業フック（引き継ぎ参考）</div>
            <div style="font-size:12px;line-height:1.6;color:var(--navy-600);margin-top:4px">${research.sales_hook||'—'}</div>
          </div>
        </div>
      </div>` : ''}
    </div>
  </div>
  `;
  renderPage(html);
}

function doCompleteHandoff(handoffId) {
  const h = AppDB.getHandoff(handoffId);
  AppDB.updateHandoff(handoffId, { status: '完了', payment_confirmed: today() });
  if (h) AppDB.updateStore(h.store_id, { stage: '引き継ぎ完了' });
  showToast('引き継ぎを完了しました', 'success');
  navigate('handoff-detail', { id: handoffId });
}
