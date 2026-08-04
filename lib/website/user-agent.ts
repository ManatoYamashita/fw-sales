/**
 * Website Scanner の User-Agent 単一定義(Sales Diagnostics Data Contract v1.2 §B.3 CC-6）。
 *
 * **この文字列を他所へ手書きしないこと。**
 * robots.txt の `User-agent:` 照合は product token(`WEBSITE_SCANNER_USER_AGENT_PRODUCT`）に対して行い、
 * HTTP リクエストヘッダには `WEBSITE_SCANNER_USER_AGENT_HEADER` を送る。
 * この 2 つが別々に定義されると、「送信している UA 名」と「robots で照合している UA 名」が
 * 静かにずれ、結果として robots.txt の専用セクションを無視することになる。
 * 両者を必ず本 module から import すること。
 *
 * - Phase 1: `lib/website/crawl/robots.ts` が PRODUCT を使用。
 * - Phase 2: HTTP fetch 実装が HEADER を使用する(まだ実装されていない）。
 *
 * follow-up(本 PR のスコープ外）: `lib/url-parser/ogp.ts` が独自に定義している
 * Mozilla 形式の UA 文字列は、product token を `Research` ではなく `Reserch` と綴った
 * typo を含んだまま実送信している。PR #199 が同ファイルを変更中のため今回は触らず、
 * #199 merge 後に本 module へ統合する(契約 §B.3 CC-6）。
 */

/** robots.txt の `User-agent:` 行と照合する product token。 */
export const WEBSITE_SCANNER_USER_AGENT_PRODUCT = "FirstWebResearchAI";

/** product token のバージョン部。 */
export const WEBSITE_SCANNER_USER_AGENT_VERSION = "1.0";

/** 問い合わせ先 URL(UA 文字列に含めてサイト運営者が連絡できるようにする）。 */
export const WEBSITE_SCANNER_USER_AGENT_CONTACT_URL = "https://firstweb.example.com";

/** HTTP `User-Agent` ヘッダに送る完全な文字列。Phase 2 の fetch 実装が使用する。 */
export const WEBSITE_SCANNER_USER_AGENT_HEADER = `Mozilla/5.0 (compatible; ${WEBSITE_SCANNER_USER_AGENT_PRODUCT}/${WEBSITE_SCANNER_USER_AGENT_VERSION}; +${WEBSITE_SCANNER_USER_AGENT_CONTACT_URL})`;
