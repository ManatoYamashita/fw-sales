"use client";

import {
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MemoInput, MemoTextarea } from "./memo-input";
import { ServiceCheckboxGroup } from "./service-checkbox-group";
import { UrlImportPanel } from "./url-import-panel";
import {
  AiAnalysisPanel,
  type AiAnalysisFormSnapshot,
} from "./ai-analysis-panel";
import { createStoreAction } from "@/lib/actions/store-actions";
import { decideChannel } from "@/lib/domain/channel";
import {
  CONTACT_FORMS,
  OPERATOR_TYPES,
  PRIORITIES,
} from "@/types/store";
import { PLANNERS, SALES } from "@/lib/domain/staff";
import { toast } from "@/components/ui/toast";
import type { ApplyConfidence, ApplyResult } from "@/lib/url-parser/types";
import { confidenceToBg } from "@/lib/url-parser/confidence-color";
import { useBeforeUnload } from "@/lib/hooks/use-before-unload";
import type {
  AiAnalysisResult,
  AiAnalysisConfidence,
  ConfidenceFieldKey,
} from "@/types/ai-analysis";

type FormState = {
  name: string;
  prefecture: string;
  city: string;
  address: string;
  genre: string;
  priority: string;
  has_contact_form: string;
  channel: string;
  map_url: string;
  site_url: string;
  instagram_url: string;
  phone: string;
  target_service: string;
  review_count: string;
  review_avg: string;
  memo: string;
  assigned_planner: string;
  assigned_sales: string;
  operator_type: string;
  operator_name: string;
};

const INITIAL: FormState = {
  name: "",
  prefecture: "",
  city: "",
  address: "",
  genre: "",
  priority: "中",
  has_contact_form: "未確認",
  channel: "未判定",
  map_url: "",
  site_url: "",
  instagram_url: "",
  phone: "",
  target_service: "",
  review_count: "",
  review_avg: "",
  memo: "",
  assigned_planner: "佐藤",
  assigned_sales: "",
  operator_type: "未設定",
  operator_name: "",
};

/** ApplyConfidence のキーと FormState のキーは大半が一致する。マッピング。 */
type ConfidenceKey = keyof ApplyConfidence;

export interface StoreNewFormProps {
  /** SSR で取得した GEMINI_API_KEY 設定済み boolean(Req 2.7) */
  isApiKeyConfigured: boolean;
}

export function StoreNewForm({ isApiKeyConfigured }: StoreNewFormProps) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [confidence, setConfidence] = useState<ApplyConfidence>({});
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null);
  const [aiConfidence, setAiConfidence] = useState<
    Partial<AiAnalysisConfidence>
  >({});
  // AI 結果が未保存かどうか。`useBeforeUnload` の連動に使う(Req 6.4)。
  const [aiPersisted, setAiPersisted] = useState<boolean>(true);
  // URL 解析時に取得した HTML 全文(AI 分析の入力として再利用)。
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // 未保存遷移警告: AI 分析結果があり保存されていない場合のみ beforeunload を発動
  const isDirty = aiResult !== null && !aiPersisted;
  useBeforeUnload(isDirty);

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        // has_contact_form を変えたらチャネル候補を自動で再判定
        if (key === "has_contact_form") {
          next.channel = decideChannel(
            value as FormState["has_contact_form"] as never,
          );
        }
        return next;
      });
      // ユーザーが手で値を変えたら confidence を解除(編集済みマーカー = 背景色解除)
      setConfidence((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key as ConfidenceKey];
        return next;
      });
    },
    [],
  );

  // 各フィールド用 onChange を 1 度だけ生成(レンダごとに新クロージャを作らないことで
  // MemoInput / MemoTextarea の React.memo を成立させる)。
  const handlers = useMemo(() => {
    const out = {} as Record<
      keyof FormState,
      (
        e: ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => void
    >;
    (Object.keys(INITIAL) as Array<keyof FormState>).forEach((k) => {
      out[k] = (e) => set(k, e.target.value as FormState[typeof k]);
    });
    return out;
  }, [set]);

  // 背景色再計算をタイピングの 1 frame 後に遅延させ、入力中の INP を稼ぐ。
  const deferredConfidence = useDeferredValue(confidence);

  const applyImport = (suggested: ApplyResult, html: string | null) => {
    // URL 解析対象フィールドは前回値を保持せず、suggested の値で**強制上書き**する。
    // (空文字なら空文字に戻す。別 URL を続けて読み込む際に前店舗情報が残る問題への対応。)
    // priority / has_contact_form / channel / target_service / assigned_* / operator_type は
    // URL からは取れないため prev の手入力値を保持する。
    setForm((prev) => ({
      ...prev,
      name: suggested.name,
      prefecture: suggested.prefecture,
      city: suggested.city,
      address: suggested.address,
      genre: suggested.genre,
      map_url: suggested.map_url,
      site_url: suggested.site_url,
      instagram_url: suggested.instagram_url,
      phone: suggested.phone,
      review_count:
        suggested.review_count !== null ? String(suggested.review_count) : "",
      review_avg:
        suggested.review_avg !== null ? String(suggested.review_avg) : "",
      memo: suggested.memo,
      operator_name: suggested.operator_name,
    }));
    // confidence も前回マーカーを完全に捨てて新規 import 結果のみで置き換える
    setConfidence(suggested.confidence);
    // AI 分析の入力として再利用するため HTML 全文を保持
    setHtmlContent(html);
  };

  /** 信頼度スコアから入力欄の背景色(プリミティブ string)を生成。
   * MemoInput / MemoTextarea に渡して shallow compare を成立させるため、
   * style オブジェクトではなく文字列で返す。 */
  const bgFor = (key: ConfidenceKey): string | undefined =>
    confidenceToBg(deferredConfidence[key]);

  // ----- AI Analysis Panel callbacks -----

  /** Panel 押下時に呼ばれる関数。`form` / `htmlContent` の最新値を返す。
   * useCallback で包まないことで毎レンダ最新の閉包を生成し、stale closure を防ぐ。 */
  const getFormSnapshot = (): AiAnalysisFormSnapshot => ({
    name: form.name,
    prefecture: form.prefecture,
    city: form.city,
    address: form.address,
    genre: form.genre,
    phone: form.phone,
    site_url: form.site_url,
    instagram_url: form.instagram_url,
    map_url: form.map_url,
    review_avg: form.review_avg,
    review_count: form.review_count,
    memo: form.memo,
    operator_type: form.operator_type,
    operator_name: form.operator_name,
    htmlContent,
    assignedSales: form.assigned_sales,
  });

  const onAiResult = (result: AiAnalysisResult) => {
    setAiResult(result);
    setAiConfidence(result.confidence);
    setAiPersisted(false);
  };

  const onAiFieldEdit = (field: ConfidenceFieldKey) => {
    setAiConfidence((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const onAiResultFieldChange = (
    field: keyof Omit<AiAnalysisResult, "confidence">,
    value: string,
  ) => {
    setAiResult((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value };
    });
  };

  const submit = (formData: FormData) => {
    // operator は form action 内の Select / Input で送信されるので追加不要。
    // ai_analysis_result は state 由来なので明示的に詰める。
    if (aiResult) {
      formData.set("ai_analysis_result", JSON.stringify(aiResult));
    }
    startTransition(async () => {
      const result = await createStoreAction(null, formData);
      if (result.ok) {
        setAiPersisted(true);
        toast.success(result.message ?? "登録しました");
        router.push(`/stores/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit} className="space-y-4">
      <UrlImportPanel onApply={applyImport} />

      <Card>
        <Card.Header>
          <Card.Title>基本情報</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="店舗名" required htmlFor="name" className="md:col-span-2">
            <MemoInput
              id="name"
              name="name"
              required
              value={form.name}
              onChange={handlers.name}
              placeholder="例: 導楽"
              bg={bgFor("name")}
            />
          </FormField>
          <FormField label="都道府県" htmlFor="prefecture">
            <MemoInput
              id="prefecture"
              name="prefecture"
              value={form.prefecture}
              onChange={handlers.prefecture}
              placeholder="例: 神奈川県"
              bg={bgFor("prefecture")}
            />
          </FormField>
          <FormField label="市区町村" htmlFor="city">
            <MemoInput
              id="city"
              name="city"
              value={form.city}
              onChange={handlers.city}
              placeholder="例: 川崎市中原区"
              bg={bgFor("city")}
            />
          </FormField>
          <FormField label="住所・最寄駅" htmlFor="address" className="md:col-span-2">
            <MemoInput
              id="address"
              name="address"
              value={form.address}
              onChange={handlers.address}
              placeholder="例: 新丸子駅周辺"
              bg={bgFor("address")}
            />
          </FormField>
          <FormField label="業態" htmlFor="genre">
            <MemoInput
              id="genre"
              name="genre"
              value={form.genre}
              onChange={handlers.genre}
              placeholder="例: 居酒屋"
              bg={bgFor("genre")}
            />
          </FormField>
          <FormField label="優先度" htmlFor="priority">
            <Select
              id="priority"
              name="priority"
              value={form.priority}
              onChange={handlers.priority}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="運営者種別"
            htmlFor="operator_type"
            hint="個人店は受注成約率が高い傾向があり営業優先度の判断に使います"
          >
            <Select
              id="operator_type"
              name="operator_type"
              value={form.operator_type}
              onChange={handlers.operator_type}
            >
              {OPERATOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="運営者名"
            htmlFor="operator_name"
            hint="法人名(複数店舗運営)もしくはオーナー名(個人店)"
          >
            <MemoInput
              id="operator_name"
              name="operator_name"
              value={form.operator_name}
              onChange={handlers.operator_name}
              placeholder="例: 株式会社○○ / 山田 太郎"
              bg={bgFor("operator_name")}
            />
          </FormField>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>WEB資産・連絡先</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="GoogleマップURL" htmlFor="map_url" className="md:col-span-2">
            <MemoInput
              id="map_url"
              name="map_url"
              value={form.map_url}
              onChange={handlers.map_url}
              placeholder="https://maps.google.com/..."
              bg={bgFor("map_url")}
            />
          </FormField>
          <FormField label="公式サイトURL" htmlFor="site_url">
            <MemoInput
              id="site_url"
              name="site_url"
              type="url"
              value={form.site_url}
              onChange={handlers.site_url}
              placeholder="https://example.com"
              bg={bgFor("site_url")}
            />
          </FormField>
          <FormField label="Instagram URL" htmlFor="instagram_url">
            <MemoInput
              id="instagram_url"
              name="instagram_url"
              type="url"
              value={form.instagram_url}
              onChange={handlers.instagram_url}
              placeholder="https://instagram.com/..."
              bg={bgFor("instagram_url")}
            />
          </FormField>
          <FormField label="電話番号" htmlFor="phone">
            <MemoInput
              id="phone"
              name="phone"
              value={form.phone}
              onChange={handlers.phone}
              placeholder="例: 03-1234-5678"
              bg={bgFor("phone")}
            />
          </FormField>
          <FormField
            label="問い合わせフォームの有無"
            htmlFor="has_contact_form"
            hint="「あり/なし」を選ぶとチャネル候補が自動判定されます"
          >
            <Select
              id="has_contact_form"
              name="has_contact_form"
              value={form.has_contact_form}
              onChange={handlers.has_contact_form}
            >
              {CONTACT_FORMS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="想定チャネル"
            htmlFor="channel"
            hint="フォームの有無から自動推定された値です。手動で変更可能です。"
            className="md:col-span-2"
          >
            <MemoInput
              id="channel"
              name="channel"
              value={form.channel}
              onChange={handlers.channel}
              readOnly
              className="bg-muted/40"
            />
          </FormField>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>提案候補・営業メモ</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-4">
          <FormField label="提案商材">
            <ServiceCheckboxGroup
              value={form.target_service}
              onChange={(csv) => set("target_service", csv)}
            />
          </FormField>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="プランナー" htmlFor="assigned_planner">
              <Select
                id="assigned_planner"
                name="assigned_planner"
                value={form.assigned_planner}
                onChange={handlers.assigned_planner}
              >
                <option value="">未割当</option>
                {PLANNERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="営業担当" htmlFor="assigned_sales">
              <Select
                id="assigned_sales"
                name="assigned_sales"
                value={form.assigned_sales}
                onChange={handlers.assigned_sales}
              >
                <option value="">未割当</option>
                {SALES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="口コミ件数" htmlFor="review_count">
              <MemoInput
                id="review_count"
                name="review_count"
                type="number"
                min={0}
                value={form.review_count}
                onChange={handlers.review_count}
                bg={bgFor("review_count")}
              />
            </FormField>
            <FormField label="口コミ平均(0-5)" htmlFor="review_avg">
              <MemoInput
                id="review_avg"
                name="review_avg"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={form.review_avg}
                onChange={handlers.review_avg}
                bg={bgFor("review_avg")}
              />
            </FormField>
          </div>
          <FormField label="メモ" htmlFor="memo">
            <MemoTextarea
              id="memo"
              name="memo"
              rows={5}
              value={form.memo}
              onChange={handlers.memo}
              placeholder="現状の評価ポイント、気になる動向、調査メモなど"
              bg={bgFor("memo")}
            />
          </FormField>
        </Card.Body>
      </Card>

      <AiAnalysisPanel
        getFormSnapshot={getFormSnapshot}
        initialResult={null}
        onResult={onAiResult}
        onFieldEdit={onAiFieldEdit}
        isApiKeyConfigured={isApiKeyConfigured}
        currentResult={aiResult}
        confidence={aiConfidence}
        onResultFieldChange={onAiResultFieldChange}
        storeId={null}
      />

      {/* Submit footer: 既存の Card.Footer 構造から切り出して AI Panel の下に配置。 */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30 rounded-md">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
        >
          キャンセル
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "登録中…" : "登録する"}
        </Button>
      </div>
    </form>
  );
}
