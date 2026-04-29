// =============================================
// Actions Page (営業アクション)
// =============================================

function renderActions(storeId) {
  const stores = AppDB.getStores();

  // もし storeId が未指定なら、アクション待ちの店舗一覧から選ぶ
  if (!storeId) {
    const actionableStores = stores.filter(s => ['調査完了','一次接触準備','DM送信済み','テレアポ済み','反応あり'].includes(s.stage));
    const html = `
    <div class="page-header">
      <div>
        <div class="page-title">営業アクション</div>
        <div class="page-desc">DM・テレアポ・商談化の実行管理</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title"><i class="fas fa-paper-plane"></i> アクション対象店舗</div></div>
      ${actionableStores.length ? `
      <div class="table-container">
        <table>
          <thead>
            <tr><th>店名</th><th>チャネル</th><th>ステージ</th><th>優先</th><th>営業フック</th><th></th></tr>
          </thead>
          <tbody>
            ${actionableStores.map(s => {
              const r = AppDB.getResearch(s.id);
              return `
              <tr class="table-row-link" onclick="navigate('actions',{id:'${s.id}'})">
                <td><div style="font-weight:700">${s.name}</div><div class="text-muted">${s.city||'—'}</div></td>
                <td>${getChannelBadge(s.channel)}</td>
                <td>${getStageBadge(s.stage)}</td>
                <td>${getPriorityBadge(s.priority)}</td>
                <td class="text-muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r?.sales_hook||'—'}</td>
                <td><button class="btn-primary btn-sm" onclick="event.stopPropagation();navigate('actions',{id:'${s.id}'})"><i class="fas fa-paper-plane"></i> アクション</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state"><i class="fas fa-check-double"></i><p>アクション待ちの店舗はありません</p></div>`}
    </div>`;
    renderPage(html);
    return;
  }

  const store = AppDB.getStore(storeId);
  if (!store) { renderPage('<div class="empty-state"><p>店舗が見つかりません</p></div>'); return; }
  const research = AppDB.getResearch(storeId);
  const isDM = store.channel === 'DM推奨';

  // Generate DM text
  const dmText = research ? generateDMText(store, research) : '';
  const telScript = research ? generateTelScript(store, research) : '';

  const html = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn-secondary btn-sm" onclick="navigate('actions')"><i class="fas fa-arrow-left"></i></button>
      <div>
        <div class="page-title">営業アクション — ${store.name}</div>
        <div class="page-desc">${store.genre||''} ・ ${store.city||''}</div>
      </div>
    </div>
    <div class="page-actions">
      ${getStageBadge(store.stage)}
      ${getChannelBadge(store.channel)}
    </div>
  </div>

  <div class="detail-layout">
    <!-- Left: Action -->
    <div>
      <!-- 推奨アクション -->
      <div class="channel-card ${isDM ? 'dm' : 'tel'}">
        <div class="channel-icon">
          <i class="${isDM ? 'fas fa-envelope' : 'fas fa-phone'}"></i>
        </div>
        <div>
          <div class="channel-label">推奨一次接触</div>
          <div class="channel-title">${isDM ? 'DM・フォーム送信' : 'テレアポ'}</div>
          <div class="channel-reason">${research?.channel_reason || (isDM ? '問い合わせフォームがあります。フォーム経由でDMを送信しましょう。' : '問い合わせフォームがありません。電話での一次接触を行いましょう。')}</div>
        </div>
      </div>

      ${isDM ? `
      <!-- DM文面 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-envelope"></i> DM文面（フォーム送信用）</div>
        </div>
        <div class="card-body">
          <div class="script-box">
            <div class="script-box-label">フォーム送信文案</div>
            <button class="copy-btn" onclick="copyToClipboard(document.getElementById('dm-text').textContent)">
              <i class="fas fa-copy"></i> コピー
            </button>
            <div id="dm-text" style="white-space:pre-line;padding-top:8px">${dmText}</div>
          </div>
          <div class="form-group" style="margin-top:16px">
            <label class="form-label">メモ・カスタマイズ</label>
            <textarea class="form-control" id="dm-custom" rows="3" placeholder="送信文をカスタマイズする場合はこちらに..."></textarea>
          </div>
        </div>
      </div>
      ` : `
      <!-- テレアポ台本 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-phone"></i> テレアポ台本</div>
        </div>
        <div class="card-body">
          <div class="script-box">
            <div class="script-box-label">架電スクリプト</div>
            <button class="copy-btn" onclick="copyToClipboard(document.getElementById('tel-text').textContent)">
              <i class="fas fa-copy"></i> コピー
            </button>
            <div id="tel-text" style="white-space:pre-line;padding-top:8px">${telScript}</div>
          </div>
        </div>
      </div>
      `}

      <!-- 営業メモ -->
      ${research ? `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-sticky-note"></i> 営業メモ（攻め方）</div>
        </div>
        <div class="card-body">
          <div class="alert alert-info" style="margin-bottom:12px">
            <i class="fas fa-bullseye"></i>
            <div><strong>刺さる一言</strong><br>${research.sales_hook}</div>
          </div>
          <div class="sw-grid">
            <div class="sw-card strength">
              <div class="sw-card-title"><i class="fas fa-thumbs-up"></i> 強み（活かす）</div>
              <div class="sw-list">
                ${[research.strength1, research.strength2, research.strength3].filter(Boolean).map(s => `<div class="sw-item"><i class="fas fa-check-circle"></i><span>${s}</span></div>`).join('')}
              </div>
            </div>
            <div class="sw-card weakness">
              <div class="sw-card-title"><i class="fas fa-wrench"></i> 弱み（改善提案）</div>
              <div class="sw-list">
                ${[research.weakness1, research.weakness2, research.weakness3].filter(Boolean).map(w => `<div class="sw-item"><i class="fas fa-arrow-right" style="color:var(--blue-500)"></i><span>${w}</span></div>`).join('')}
              </div>
            </div>
          </div>
          <div class="info-grid" style="margin-top:12px">
            <div class="info-item"><div class="info-key">入口商品</div><div class="info-val"><span class="badge badge-purple">${research.entry_product||'—'}</span></div></div>
            <div class="info-item"><div class="info-key">本命商品</div><div class="info-val"><span class="badge badge-navy">${research.main_product||'—'}</span></div></div>
          </div>
        </div>
      </div>
      ` : ''}

      <!-- 実行記録 -->
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="fas fa-check-square"></i> 実行記録</div>
        </div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">実行日</label>
              <input class="form-control" type="date" id="act-date" value="${today()}">
            </div>
            <div class="form-group">
              <label class="form-label">結果</label>
              <select class="form-control" id="act-result">
                <option value="未実施">未実施</option>
                <option value="送信済み">送信済み</option>
                <option value="架電済み">架電済み</option>
                <option value="不通">不通</option>
                <option value="反応あり">反応あり</option>
                <option value="商談化">商談化</option>
                <option value="NG">NG</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">メモ</label>
            <textarea class="form-control" id="act-memo" rows="2" placeholder="通話内容、反応など..."></textarea>
          </div>
        </div>
        <div class="card-footer" style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn-secondary" onclick="navigate('store-detail',{id:'${storeId}'})">キャンセル</button>
          <button class="btn-success" onclick="doRecordAction('${storeId}')">
            <i class="fas fa-save"></i> 実行記録を保存
          </button>
          <button class="btn-primary" onclick="openNewDealModal('${storeId}')">
            <i class="fas fa-handshake"></i> 商談化する
          </button>
        </div>
      </div>
    </div>

    <!-- Right: Store Info -->
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title"><i class="fas fa-store"></i> 店舗情報</div></div>
        <div class="card-body">
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">店名</div><div class="info-val" style="font-size:16px;font-weight:700">${store.name}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">エリア</div><div class="info-val">${store.city||'—'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">電話</div><div class="info-val">${store.phone||'<span class="empty">未取得</span>'}</div></div>
          <div class="info-item" style="margin-bottom:10px"><div class="info-key">フォーム</div><div class="info-val">${store.has_contact_form||'—'}</div></div>
          ${store.site_url ? `<div class="info-item" style="margin-bottom:10px"><div class="info-key">公式サイト</div><div class="info-val"><a href="${store.site_url}" target="_blank">開く <i class="fas fa-external-link-alt"></i></a></div></div>` : ''}
          <div class="divider"></div>
          <div class="review-summary" style="margin:0">
            <div class="review-score">
              <div class="score">${store.review_avg||'—'}</div>
              <div>${getStarRating(store.review_avg||0)}</div>
              <div class="score-label">${store.review_count||0}件</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title"><i class="fas fa-route"></i> 次のステップ</div></div>
        <div class="card-body">
          <div class="timeline">
            ${getActionTimeline(store).map(t => `
            <div class="timeline-item">
              <div class="timeline-dot ${t.status}"><i class="${t.icon}"></i></div>
              <div class="timeline-content">
                <div class="timeline-title">${t.title}</div>
                <div class="timeline-date">${t.desc}</div>
              </div>
            </div>`).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>
  `;
  renderPage(html);
}

function generateDMText(store, research) {
  return `突然のご連絡失礼いたします。
Firstwebと申します。

${store.name}さんのお店について、
ネット上での情報を拝見させていただきました。

${research.review_positive ? `お客様の口コミを拝見すると、「${research.review_positive.split('、')[0]}」など、大変高い評価をいただいているようです。` : ''}

${research.sales_hook || `一方で、WEB上での情報発信をもう少し強化することで、新規のお客様をさらに増やせるポテンシャルがあると感じています。`}

弊社は個人飲食店様向けのWEB集客支援を専門としており、
・Googleマップ上位表示（MEO対策）
・ホームページ制作・運用
・Instagram運用支援
などをご提供しています。

まずは無料でヒアリングさせていただければと思いますが、
ご都合はいかがでしょうか？

どうぞよろしくお願いいたします。

Firstweb 佐藤`;
}

function generateTelScript(store, research) {
  return `【架電スクリプト】

切り出し：
「${store.name}さんでしょうか？
突然お電話失礼いたします。
Firstwebという飲食店向けのWEB集客支援をしております佐藤と申します。
1〜2分だけよろしいでしょうか？」

↓ OKなら：
「${store.name}さんのお店について、ネット上での情報を拝見しました。
${research?.sales_hook || 'WEB上での集客改善でお役に立てると思いご連絡しました。'}

Googleマップのお問い合わせや来店数を増やすお手伝いをしているのですが、
現在、集客でお困りなことはありますか？」

↓ 反応あり：
「ありがとうございます。一度、詳しくお話させていただけますか？
オンラインでも対面でも対応しています。
来週あたりでご都合の良いお時間はありますか？」

↓ 断られたら：
「承知しました。また機会がありましたらよろしくお願いします。
もしWEB集客でお困りのことがあればいつでもご連絡ください。」`;
}

function getActionTimeline(store) {
  const stages = [
    { title: '調査・分析', desc: '口コミ・WEB資産の確認', icon: 'fas fa-search', stageCheck: ['調査完了','一次接触準備','DM送信済み','テレアポ済み','反応あり','商談化','見積提出','受注'] },
    { title: '一次接触', desc: 'DM or テレアポ', icon: 'fas fa-paper-plane', stageCheck: ['DM送信済み','テレアポ済み','反応あり','商談化','見積提出','受注'] },
    { title: '商談化', desc: '課題ヒアリング・提案', icon: 'fas fa-handshake', stageCheck: ['商談化','見積提出','受注'] },
    { title: '見積提出', desc: '提案書・見積書の送付', icon: 'fas fa-file-invoice', stageCheck: ['見積提出','受注'] },
    { title: '受注', desc: '契約締結・入金確認', icon: 'fas fa-check-circle', stageCheck: ['受注'] }
  ];
  return stages.map(s => ({
    ...s,
    status: s.stageCheck.includes(store.stage) ? 'done' : store.stage === s.title ? 'active' : 'pending'
  }));
}

function doRecordAction(storeId) {
  const result = document.getElementById('act-result')?.value;
  const stageMap = {
    '送信済み': 'DM送信済み',
    '架電済み': 'テレアポ済み',
    '反応あり': '反応あり',
    '商談化': '商談化'
  };
  if (stageMap[result]) {
    AppDB.updateStore(storeId, { stage: stageMap[result] });
  }
  showToast('実行記録を保存しました', 'success');
  navigate('actions', { id: storeId });
}
