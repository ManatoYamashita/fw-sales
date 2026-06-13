/**
 * AppSettingsRepository interface (store-flow-guidance / Issue #122)
 *
 * `app_settings` テーブル (key-value) へのアクセス契約。アプリ全体の汎用設定を
 * キー単位で読み書きする。現状の利用は調査用 Gem の URL のみ。
 *
 * 関連: Issue #122, lib/db/app-settings-repository.ts
 */

export interface AppSettingsRepository {
  /** 指定キーの値を取得する。未設定なら null。 */
  get(key: string): Promise<string | null>;

  /** 指定キーの値を upsert する (存在すれば更新、なければ挿入)。 */
  set(key: string, value: string): Promise<void>;
}
