// =============================================
// Research Page (調査キュー + 詳細)
// =============================================

function renderResearch() {
  const stores = AppDB.getStores();
  const waitStores = stores.filter(s => s.stage === '調査待ち');
  const doneStores = stores.filter(s => s.stage !== '調査待ち' && AppDB.getResearch(s.id));

  const html = `
  <div class="page-header">
    <div>
      <div class="page-title">調査キュー</div>
      <div class="page-desc">調査待ち ${waitStores.length}件 / 完了 ${doneStores.length}件</div>
    </div>
  </div>

  <div class="tabs" id="res-tabs">
    <div class="tab active" data-tab="wait" onclick="switchResTab('wait')">
      <i class="fas fa-clock"></i> 調査待ち <span class="nav-badge badge-yellow" style="margin-left:4px">${waitStores.length}</span>
    </div>
    <div class="tab" data-tab="done" onclick="switchResTab('done')">
      <i class="fas fa-check-circle"></i> 調査完了 <span class="nav-badge" style="margin-left:4px">${doneStores.length}</span>
    </div>
  </div>

  <div data-tab-content="wait" class="tab-content active">
    ${waitStores.length ? `
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr><th>店名</th><th>エリア</th><th>優先</th><th>登録日</th><th>担当企画</th><th></th></tr>
          </thead>
          <tbody>
            ${waitStores.map(s => `
            <tr class="table-row-link" onclick="navigate('research-detail',{id:'${s.id}'})">
              <td><div style="font-weight:700">${s.name}</div><div class="text-muted">${s.genre||'—'}</div></td>
              <td>${s.city||'—'}</td>
              <td>${getPriorityBadge(s.priority)}</td>
              <td class="text-muted">${formatDate(s.created_at)}</td>
              <td class="text-muted">${s.assigned_planner||'未アサイン'}</td>
              <td><button class="btn-primary btn-sm" onclick="event.stopPropagation();navigate('research-detail',{id:'${s.id}'})"><i class="fas fa-search"></i> 調査開始</button></td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>` : `<div class="card"><div class="empty-state"><i class="fas fa-check-double"></i><p>調査待ちの店舗はありません</p></div></div>`}
  </div>

  <div data-tab-content="done" class="tab-content">
    ${doneStores.length ? `
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr><th>店名</th><th>チャネル</th><th>強み</th><th>弱み</th><th>入口商品</th><th></th></tr>
          </thead>
          <tbody>
            ${doneStores.map(s => {
              const r = AppDB.getResearch(s.id);
              return `
              <tr class="table-row-link" onclick="navigate('research-detail',{id:'${s.id}'})">
                <td><div style="font-weight:700">${s.name}</div><div class="text-muted">${s.city||'—'}</div></td>
                <td>${getChannelBadge(s.channel)}</td>
                <td class="text-muted" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r?.strength1||'—'}</td>
                <td class="text-muted" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r?.weakness1||'—'}</td>
                <td><span class="badge badge-purple">${r?.entry_product||'—'}</span></td>
                <td><button class="btn-ghost btn-sm" onclick="event.stopPropagation();navigate('research-detail',{id:'${s.id}'})">詳細</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : `<div class="card"><div class="empty-state"><i class="fas fa-search"></i><p>調査完了の店舗はまだありません</p></div></div>`}
  </div>
  `;
  renderPage(html);
}

function switchResTab(tab) {
  document.querySelectorAll('#res-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('[data-tab-content]').forEach(c => c.classList.toggle('active', c.dataset.tabContent === tab));
}

// ---- Research Detail ----
function renderResearchDetail(storeId) {
  const store = AppDB.getStore(storeId);
  if (!store) { renderPage('<div class="empty-state"><p>店舗が見つかりません</p></div>'); return; }
  const r = AppDB.getResearch(storeId);

  const html = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn-secondary btn-sm" onclick="navigate('store-detail',{id:'${storeId}'})"><i class="fas fa-arrow-left"></i> 店舗詳細</button>
      <div>
        <div class="page-title">${r ? '調査結果' : '✨ 調査入力'} — ${store.name}</div>
        <div class="page-desc">${store.genre||''} ・ ${store.city||''}</div>
      </div>
    </div>
    <div class="page-actions">
      ${getStageBadge(store.stage)}
      ${getChannelBadge(store.channel)}
    </div>
  </div>

  <div class="detail-layout">
    <!-- Left: Main Form -->
    <div>
      <!-- Channel Card -->
      <div class="channel-card ${store.channel === 'DM推奨' ? 'dm' : store.channel === 'テレアポ推奨' ? 'tel' : 'check'}">
        <div class="channel-icon">
          <i class="${store.channel === 'DM推奨' ? 'fas fa-envelope' : store.channel === 'テレアポ推奨' ? 'fas fa-phone' : 'fas fa-question-circle'}"></i>
        </div>
        <div style="flex:1">
          <div class="channel-label">推奨接触チャネル</div>
          <div class="channel-title">${store.channel || '未判定'}</div>
          <div class="channel-reason">
            <strong>判定根拠：</strong>
            問い合わせフォーム「<strong>${store.has_contact_form||'未確認'}</strong>」
            ${store.channel === 'DM推奨' ? '→ フォーム経由でのDM送信が有効です。' : store.channel === 'テレアポ推奨' ? '→ 非同期窓口がないため、電話での一次接触を推奨します。' : '→ 追加確認を実施してください。'}
          </div>
        </div>
        <button class="btn-secondary btn-sm" onclick="openChannelEditModal('${storeId}')">
          <i class="fas fa-edit"></i> 変更
        </button>
      </div>

      <!-- 口コミ分析 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-star"></i> 口コミ分析</div>
        </div>
        <div class="card-body">
          <div class="review-summary">
            <div class="review-score">
              <div class="score">${store.review_avg||'—'}</div>
              <div>${getStarRating(store.review_avg||0)}</div>
              <div class="score-label">${store.review_count||0}件</div>
            </div>
            <div class="review-meta">
              <div class="review-meta-item"><i class="fas fa-map-marker-alt"></i> ${store.city||'—'}</div>
              <div class="review-meta-item"><i class="fas fa-utensils"></i> ${store.genre||'—'}</div>
              <div class="review-meta-item"><i class="fas fa-reply" style="color:${r?.total_review?.includes('返信あり') ? 'var(--green-500)' : 'var(--red-400)'}"></i> 口コミ返信：${r?.total_review?.includes('返信あり') ? 'あり' : 'なし'}</div>
            </div>
          </div>

          ${r ? `
          <div class="form-group">
            <div class="info-key" style="margin-bottom:6px">ポジティブ傾向</div>
            <div class="alert alert-success" style="margin:0"><i class="fas fa-smile"></i><span>${r.review_positive||'—'}</span></div>
          </div>
          <div class="form-group">
            <div class="info-key" style="margin-bottom:6px">ネガティブ傾向</div>
            <div class="alert alert-error" style="margin:0"><i class="fas fa-frown"></i><span>${r.review_negative||'—'}</span></div>
          </div>
          ` : `
          <div class="form-group">
            <label class="form-label">ポジティブ傾向 <span class="required">*</span></label>
            <textarea class="form-control" id="rp-positive" rows="2" placeholder="例：お刺身の鮮度が高い、雰囲気が良いなど"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">ネガティブ傾向</label>
            <textarea class="form-control" id="rp-negative" rows="2" placeholder="例：コスパへの不満、情報が少ないなど"></textarea>
          </div>
          `}
        </div>
      </div>

      <!-- 強み弱み -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-balance-scale"></i> 強み・弱み分析</div>
        </div>
        <div class="card-body">
          ${r ? `
          <div class="sw-grid">
            <div class="sw-card strength">
              <div class="sw-card-title"><i class="fas fa-thumbs-up"></i> 強み（3点）</div>
              <div class="sw-list">
                ${[r.strength1, r.strength2, r.strength3].filter(Boolean).map(s => `<div class="sw-item"><i class="fas fa-check-circle"></i><span>${s}</span></div>`).join('')}
              </div>
            </div>
            <div class="sw-card weakness">
              <div class="sw-card-title"><i class="fas fa-thumbs-down"></i> 弱み（3点）</div>
              <div class="sw-list">
                ${[r.weakness1, r.weakness2, r.weakness3].filter(Boolean).map(w => `<div class="sw-item"><i class="fas fa-times-circle"></i><span>${w}</span></div>`).join('')}
              </div>
            </div>
          </div>
          ` : `
          <div class="form-row">
            <div>
              <div class="sw-card-title" style="color:var(--green-600);margin-bottom:10px"><i class="fas fa-thumbs-up"></i> 強み（3点まで）</div>
              <div class="form-group"><input class="form-control" id="rp-s1" placeholder="強み1"></div>
              <div class="form-group"><input class="form-control" id="rp-s2" placeholder="強み2"></div>
              <div class="form-group"><input class="form-control" id="rp-s3" placeholder="強み3"></div>
            </div>
            <div>
              <div class="sw-card-title" style="color:var(--red-600);margin-bottom:10px"><i class="fas fa-thumbs-down"></i> 弱み（3点まで）</div>
              <div class="form-group"><input class="form-control" id="rp-w1" placeholder="弱み1"></div>
              <div class="form-group"><input class="form-control" id="rp-w2" placeholder="弱み2"></div>
              <div class="form-group"><input class="form-control" id="rp-w3" placeholder="弱み3"></div>
            </div>
          </div>
          `}
        </div>
      </div>

      <!-- 改善余地 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-wrench"></i> 施策別改善余地</div>
        </div>
        <div class="card-body">
          ${r ? `
          <div class="info-grid">
            <div class="info-item"><div class="info-key"><i class="fas fa-map-marked-alt" style="color:var(--blue-500)"></i> MEO</div><div class="info-val">${r.meo_gap||'—'}</div></div>
            <div class="info-item"><div class="info-key"><i class="fas fa-globe" style="color:var(--blue-500)"></i> HP</div><div class="info-val">${r.hp_gap||'—'}</div></div>
            <div class="info-item"><div class="info-key"><i class="fab fa-instagram" style="color:var(--purple-500)"></i> Instagram</div><div class="info-val">${r.instagram_gap||'—'}</div></div>
          </div>
          ` : `
          <div class="form-row-3">
            <div class="form-group">
              <label class="form-label"><i class="fas fa-map-marked-alt"></i> MEO改善余地</label>
              <textarea class="form-control" id="rp-meo" rows="2" placeholder="Googleマップの状態..."></textarea>
            </div>
            <div class="form-group">
              <label class="form-label"><i class="fas fa-globe"></i> HP改善余地</label>
              <textarea class="form-control" id="rp-hp" rows="2" placeholder="公式サイトの状態..."></textarea>
            </div>
            <div class="form-group">
              <label class="form-label"><i class="fab fa-instagram"></i> Instagram改善余地</label>
              <textarea class="form-control" id="rp-ig" rows="2" placeholder="Instagramの状態..."></textarea>
            </div>
          </div>
          `}
        </div>
      </div>

      <!-- 提案仮説 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-lightbulb"></i> 提案仮説・営業フック</div>
        </div>
        <div class="card-body">
          ${r ? `
          <div class="alert alert-info" style="margin-bottom:12px">
            <i class="fas fa-bullseye"></i>
            <div>
              <div style="font-size:11px;font-weight:700;margin-bottom:4px">営業フック</div>
              <div>${r.sales_hook||'—'}</div>
            </div>
          </div>
          <div class="info-grid">
            <div class="info-item"><div class="info-key">入口商品</div><div class="info-val"><span class="badge badge-purple">${r.entry_product||'—'}</span></div></div>
            <div class="info-item"><div class="info-key">本命商品</div><div class="info-val"><span class="badge badge-navy">${r.main_product||'—'}</span></div></div>
          </div>
          ` : `
          <div class="form-group">
            <label class="form-label">営業フック（一言）<span class="required">*</span></label>
            <textarea class="form-control" id="rp-hook" rows="2" placeholder="例：お刺身の評判は高いのに、ネット上での情報発信が弱く..."></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">入口商品</label>
              <input class="form-control" id="rp-entry" placeholder="例：MEO対策（初期費用11万〜）">
            </div>
            <div class="form-group">
              <label class="form-label">本命商品</label>
              <input class="form-control" id="rp-main" placeholder="例：HP+MEOセット">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">判定理由</label>
            <textarea class="form-control" id="rp-reason" rows="2" placeholder="チャネル判定の根拠..."></textarea>
          </div>
          `}
        </div>
        ${!r ? `
        <div class="card-footer" style="display:flex;justify-content:flex-end;gap:10px;background:var(--green-50);border-top:2px solid var(--green-100)">
          <button class="btn-secondary" onclick="navigate('store-detail',{id:'${storeId}'})">キャンセル</button>
          <button class="btn-success" style="font-size:15px;padding:12px 24px;" onclick="submitResearch('${storeId}')">
            <i class="fas fa-save"></i> 調査を保存して完了
          </button>
        </div>
        ` : ''}
      </div>

      ${r ? `
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
        <button class="btn-secondary" onclick="navigate('store-detail',{id:'${storeId}'})"><i class="fas fa-store"></i> 店舗詳細</button>
        <button class="btn-primary" style="font-size:14px;" onclick="navigate('actions',{id:'${storeId}'})">
          <i class="fas fa-paper-plane"></i> 次へ：営業アクションへ進む
        </button>
      </div>
      ` : ''}
    </div>

    <!-- Right: Quick Info -->
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title"><i class="fas fa-store"></i> 店舗情報</div></div>
        <div class="card-body">
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">店名</div><div class="info-val" style="font-size:16px;font-weight:700">${store.name}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">エリア</div><div class="info-val">${store.city||'—'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">業態</div><div class="info-val">${store.genre||'—'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">公式サイト</div><div class="info-val">${store.site_url ? 'あり' : '<span class="empty">なし</span>'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">Instagram</div><div class="info-val">${store.instagram_url ? 'あり' : '<span class="empty">なし</span>'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">フォーム</div><div class="info-val">${store.has_contact_form||'—'}</div></div>
          <div class="divider"></div>
          <div class="info-item"><div class="info-key">担当者</div><div class="info-val">${store.assigned_planner||'—'}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title"><i class="fas fa-book"></i> 指示メモ</div></div>
        <div class="card-body">
          <p style="font-size:13px;line-height:1.7;color:var(--navy-600)">${store.memo||'なし'}</p>
        </div>
      </div>
    </div>
  </div>
  `;
  renderPage(html);
}

function submitResearch(storeId) {
  const store = AppDB.getStore(storeId);
  const hook = document.getElementById('rp-hook')?.value;
  if (!hook) { showToast('営業フックを入力してください', 'error'); return; }

  const form_val = store.has_contact_form;
  const channel = form_val === 'あり' ? 'DM推奨' : form_val === 'なし' ? 'テレアポ推奨' : '要確認';

  AppDB.addResearch({
    store_id: storeId,
    store_name: store.name,
    total_review: `${store.review_avg||'—'}点 / ${store.review_count||0}件`,
    strength1: document.getElementById('rp-s1')?.value || '',
    strength2: document.getElementById('rp-s2')?.value || '',
    strength3: document.getElementById('rp-s3')?.value || '',
    weakness1: document.getElementById('rp-w1')?.value || '',
    weakness2: document.getElementById('rp-w2')?.value || '',
    weakness3: document.getElementById('rp-w3')?.value || '',
    review_positive: document.getElementById('rp-positive')?.value || '',
    review_negative: document.getElementById('rp-negative')?.value || '',
    meo_gap: document.getElementById('rp-meo')?.value || '',
    hp_gap: document.getElementById('rp-hp')?.value || '',
    instagram_gap: document.getElementById('rp-ig')?.value || '',
    channel,
    channel_reason: document.getElementById('rp-reason')?.value || '',
    sales_hook: hook,
    entry_product: document.getElementById('rp-entry')?.value || '',
    main_product: document.getElementById('rp-main')?.value || '',
    researcher: '佐藤',
    status: '完了'
  });

  AppDB.updateStore(storeId, { stage: '調査完了', channel });
  showToast('✅ 調査完了！次は営業アクションへ進みましょう。', 'success');
  navigate('research-detail', { id: storeId });
}

function openChannelEditModal(storeId) {
  const store = AppDB.getStore(storeId);
  const body = `
    <div class="form-group">
      <label class="form-label">問い合わせフォーム有無</label>
      <select class="form-control" id="ce-form">
        <option value="あり" ${store.has_contact_form === 'あり' ? 'selected' : ''}>あり</option>
        <option value="なし" ${store.has_contact_form === 'なし' ? 'selected' : ''}>なし</option>
        <option value="未確認" ${store.has_contact_form === '未確認' ? 'selected' : ''}>未確認</option>
      </select>
    </div>
    <div class="alert alert-info"><i class="fas fa-info-circle"></i> フォームあり → DM推奨 / フォームなし → テレアポ推奨 に自動判定されます</div>
  `;
  openModal('チャネル判定を変更', body, `
    <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
    <button class="btn-primary" onclick="doUpdateChannel('${storeId}')">更新</button>
  `);
}

function doUpdateChannel(storeId) {
  const form_val = document.getElementById('ce-form').value;
  const channel = form_val === 'あり' ? 'DM推奨' : form_val === 'なし' ? 'テレアポ推奨' : '要確認';
  AppDB.updateStore(storeId, { has_contact_form: form_val, channel });
  const r = AppDB.getResearch(storeId);
  if (r) AppDB.updateResearch(r.id, { channel });
  closeModal();
  showToast('チャネル判定を更新しました', 'success');
  navigate('research-detail', { id: storeId });
}
