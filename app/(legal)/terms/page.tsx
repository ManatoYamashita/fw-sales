/**
 * 利用規約 (/terms)
 *
 * NOTE: これは編集前提の雛形です。`〔〕` で囲った箇所 (事業者名・連絡先・
 *       施行日など) を実際の値に差し替え、各条項の内容は必ず法務確認のうえ
 *       確定してください。本ページは未認証でも閲覧できます (middleware 除外)。
 */

import type { Metadata } from "next";
import { LegalArticle, LegalSection } from "../_components/legal";

export const metadata: Metadata = {
  title: "利用規約",
  description:
    "FirstWeb - Reserch AI for Sales の利用規約。",
};

export default function TermsOfServicePage() {
  return (
    <LegalArticle
      title="利用規約"
      effectiveDate="制定日: 〔YYYY年MM月DD日〕／最終改定日: 〔YYYY年MM月DD日〕"
      lead={
        <>
          本利用規約(以下「本規約」といいます。)は、〔事業者名〕(以下「当社」と
          いいます。)が提供する社内向け営業支援ツール「FirstWeb - Reserch AI
          for Sales」(以下「本サービス」といいます。)の利用条件を定めるものです。
          利用者は、本規約に同意のうえ本サービスを利用するものとします。
        </>
      }
    >
      <LegalSection heading="第1条 (適用)">
        <p>
          本規約は、本サービスの提供条件および当社と利用者との間の権利義務関係
          に適用されます。
        </p>
      </LegalSection>

      <LegalSection heading="第2条 (定義)">
        <p>
          本規約において「利用者」とは、当社が利用を許諾した者(主に当社および
          関係会社の役職員)で、本サービスにアカウント登録のうえこれを利用する
          者をいいます。
        </p>
      </LegalSection>

      <LegalSection heading="第3条 (アカウント管理)">
        <p>
          利用者は、自己の責任において本サービスのアカウント (認証情報を含む)
          を管理するものとし、これを第三者に貸与・共有してはなりません。
          アカウントの管理不十分により生じた損害の責任は利用者が負うものと
          します。
        </p>
      </LegalSection>

      <LegalSection heading="第4条 (禁止事項)">
        <p>利用者は、本サービスの利用にあたり、次の行為をしてはなりません。</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>法令または公序良俗に違反する行為</li>
          <li>当社または第三者の権利・利益を侵害する行為</li>
          <li>本サービスの運営を妨害し、または不正にアクセスする行為</li>
          <li>業務上知り得た情報を許可なく外部に開示・漏えいする行為</li>
          <li>その他、当社が不適切と判断する行為</li>
        </ul>
      </LegalSection>

      <LegalSection heading="第5条 (本サービスの提供の停止等)">
        <p>
          当社は、保守・障害対応・その他運営上必要と判断した場合、事前の通知
          なく本サービスの全部または一部の提供を停止・中断できるものとします。
        </p>
      </LegalSection>

      <LegalSection heading="第6条 (知的財産権)">
        <p>
          本サービスおよびこれに付随するコンテンツに関する知的財産権は、当社
          または正当な権利者に帰属します。利用者は、これらを権利者の許諾なく
          利用してはなりません。
        </p>
      </LegalSection>

      <LegalSection heading="第7条 (免責事項)">
        <p>
          当社は、本サービスに事実上または法律上の瑕疵がないことを明示的にも
          黙示的にも保証しません。当社は、本サービスの利用に起因して利用者に
          生じた損害について、当社の故意または重過失による場合を除き、責任を
          負わないものとします。
        </p>
      </LegalSection>

      <LegalSection heading="第8条 (本サービスの内容変更)">
        <p>
          当社は、利用者への事前の通知をもって、本サービスの内容を変更し、
          または提供を終了できるものとします。
        </p>
      </LegalSection>

      <LegalSection heading="第9条 (本規約の変更)">
        <p>
          当社は、必要と判断した場合、本規約を変更できるものとします。変更後の
          本規約は、本サービス上に掲載した時点から効力を生じます。
        </p>
      </LegalSection>

      <LegalSection heading="第10条 (準拠法・裁判管轄)">
        <p>
          本規約の解釈には日本法を準拠法とし、本サービスに関して当社と利用者
          との間で紛争が生じた場合には、〔管轄裁判所名〕を第一審の専属的合意
          管轄裁判所とします。
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
