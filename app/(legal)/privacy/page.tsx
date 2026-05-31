/**
 * プライバシーポリシー (/privacy)
 *
 * NOTE: これは編集前提の雛形です。`〔〕` で囲った箇所 (事業者名・連絡先・
 *       施行日など) を実際の値に差し替え、各条項の内容は必ず法務確認のうえ
 *       確定してください。本ページは未認証でも閲覧できます (middleware 除外)。
 */

import type { Metadata } from "next";
import { LegalArticle, LegalSection } from "../_components/legal";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description:
    "FirstWeb - Reserch AI for Sales における個人情報の取り扱いについて。",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalArticle
      title="プライバシーポリシー"
      effectiveDate="制定日: 〔YYYY年MM月DD日〕／最終改定日: 〔YYYY年MM月DD日〕"
      lead={
        <>
          〔事業者名〕(以下「当社」といいます。)は、当社が提供する社内向け
          営業支援ツール「FirstWeb - Reserch AI for Sales」(以下「本サービス」と
          いいます。)における利用者の個人情報の取り扱いについて、以下のとおり
          プライバシーポリシー(以下「本ポリシー」といいます。)を定めます。
        </>
      }
    >
      <LegalSection heading="1. 事業者の名称・連絡先">
        <p>
          名称: 〔事業者名〕
          <br />
          所在地: 〔住所〕
          <br />
          個人情報保護に関するお問い合わせ窓口: 〔担当部署 / メールアドレス〕
        </p>
      </LegalSection>

      <LegalSection heading="2. 取得する個人情報">
        <p>当社は、本サービスの提供にあたり、次の情報を取得します。</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            アカウント情報(氏名、メールアドレス、所属、Google アカウントに
            紐づくプロフィール情報)
          </li>
          <li>本サービスの利用履歴・操作ログ・アクセス日時</li>
          <li>
            利用者が本サービスに入力・登録した業務上のデータ(店舗・商談情報等)
          </li>
          <li>Cookie その他の識別子、IP アドレス、端末・ブラウザ情報</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. 利用目的">
        <p>当社は、取得した個人情報を次の目的で利用します。</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>本サービスの提供、本人確認および認証のため</li>
          <li>利用状況の分析、機能改善および不具合対応のため</li>
          <li>不正利用の防止およびセキュリティ確保のため</li>
          <li>利用者からのお問い合わせへの対応のため</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. 第三者提供">
        <p>
          当社は、法令に基づく場合を除き、あらかじめ本人の同意を得ることなく
          個人情報を第三者に提供しません。
        </p>
      </LegalSection>

      <LegalSection heading="5. 業務委託・外部サービスの利用">
        <p>
          当社は、利用目的の達成に必要な範囲で、個人情報の取り扱いを外部の
          サービス提供事業者(認証基盤・ホスティング・AI 処理等。〔利用サービス名
          を列挙〕)に委託することがあります。委託先に対しては、適切な監督を
          行います。
        </p>
      </LegalSection>

      <LegalSection heading="6. 安全管理措置">
        <p>
          当社は、個人情報の漏えい、滅失またはき損の防止その他の安全管理のため、
          アクセス制御・暗号化・ログ管理等の必要かつ適切な措置を講じます。
        </p>
      </LegalSection>

      <LegalSection heading="7. 開示・訂正・利用停止等の請求">
        <p>
          本人は、当社に対し、自己の個人情報の開示、訂正、追加、削除、利用停止
          等を請求できます。請求は前記お問い合わせ窓口までご連絡ください。
        </p>
      </LegalSection>

      <LegalSection heading="8. Cookie 等の利用">
        <p>
          本サービスは、認証状態の維持および利用状況の把握のために Cookie 等を
          利用します。ブラウザの設定により Cookie を無効化できますが、その場合
          本サービスの一部機能を利用できないことがあります。
        </p>
      </LegalSection>

      <LegalSection heading="9. 本ポリシーの変更">
        <p>
          当社は、必要に応じて本ポリシーを変更することがあります。変更後の
          本ポリシーは、本サービス上に掲載した時点から効力を生じます。
        </p>
      </LegalSection>

      <LegalSection heading="10. お問い合わせ">
        <p>
          本ポリシーに関するお問い合わせは、〔担当部署 / メールアドレス〕まで
          ご連絡ください。
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
