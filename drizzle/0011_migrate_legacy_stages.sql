-- 旧12ステージ → 新4ステージへの一括移行
UPDATE stores SET stage = '未調査'       WHERE stage = '調査待ち';
UPDATE stores SET stage = '調査済み'     WHERE stage IN ('調査完了', '一次接触準備');
UPDATE stores SET stage = '架電済み'     WHERE stage IN ('DM送信済み', 'テレアポ済み', '反応あり', '商談化', '見積提出', '失注', '受注', '引き継ぎ待ち', '引き継ぎ完了');
