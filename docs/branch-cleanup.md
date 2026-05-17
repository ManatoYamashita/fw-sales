# ブランチ清掃ガイド (Issue #35)

merge 済みの `feature/*` `fix/*` `chore/*` `docs/*` 等のブランチが、ローカル / リモート origin に長期残存するのを防ぐための運用手順。

- **恒久対応**: GitHub の `delete_branch_on_merge` を有効化 (本リポジトリは ON 済)
- **ワンショット清掃**: 過去に溜まった merged ブランチを以下のコマンドで一括削除

---

## 1. 恒久対応 — auto-delete 設定

PR が merge された際に、リモートの head branch を自動削除する。

```bash
# 現状確認
gh api repos/ManatoYamashita/fw-sales --jq '.delete_branch_on_merge'
# → true なら有効

# 有効化 (未設定の場合)
gh api -X PATCH repos/ManatoYamashita/fw-sales \
  -F delete_branch_on_merge=true
```

GitHub UI でも `Settings → General → Pull Requests → Automatically delete head branches` から切替可能。

> auto-delete はリモートのみ。ローカルの追跡ブランチは `git fetch --prune` で同期される。

---

## 2. ワンショット清掃 — 既存 merged ブランチの一括削除

### 2-1. 事前確認 (dry-run)

削除対象を表示するのみ。誤削除を避けるため必ず最初に実行する。

```bash
# 1) リモートを最新化
git fetch --all --prune

# 2) ローカルの merged ブランチ一覧 (main / legacy / worktree-* を除外)
git branch --merged main \
  | grep -vE '^\*|^  (main|legacy/.*|worktree-.*)$'

# 3) リモートの merged ブランチ一覧 (main / HEAD / legacy を除外)
git branch -r --merged origin/main \
  | grep -vE 'origin/(main|HEAD|legacy/.*)$'
```

### 2-2. ローカル merged ブランチ削除

```bash
git branch --merged main \
  | grep -vE '^\*|^  (main|legacy/.*|worktree-.*)$' \
  | xargs -r -n1 git branch -d
```

- `-d` は他 worktree で checked out 中のブランチを安全に拒否する (`-D` を使ってはいけない)。
- 削除拒否が出た場合は当該ブランチが他 worktree で使用中。必要なら `git worktree list` で所在を確認。

### 2-3. リモート merged ブランチ削除 (不可逆)

```bash
# 削除対象をファイルへ書き出し
git branch -r --merged origin/main \
  | grep -vE 'origin/(main|HEAD|legacy/.*)$' \
  | sed 's|origin/||' > /tmp/branches-to-delete.txt

# 内容を必ず目視確認してから実行
cat /tmp/branches-to-delete.txt

# 削除実行
xargs -r -n1 -I{} git push origin --delete {} < /tmp/branches-to-delete.txt
```

**注意点**:

- 他 worktree で checked out 中のリモートブランチを削除すると、該当 worktree の `git push` で upstream が失われる。`git worktree list` と突き合わせ、作業中ブランチは除外する。
- 削除後にローカル追跡ブランチを掃除する場合は `git fetch --prune` を実行する。

---

## 3. 推奨運用

- PR を merge したら **ローカルの該当ブランチを `git branch -d` で削除**する習慣を付ける
- 週次 / 月次で `git fetch --prune` を実行し、リモートと同期する
- worktree を畳む際は `ExitWorktree (action: remove)` か `git worktree remove` でブランチごと整理する

---

## 関連

- Issue #35 — 本ガイド作成のトリガー
- 2026-05-17 セッションでローカル / リモート計 12 本の merged ブランチを清掃済
