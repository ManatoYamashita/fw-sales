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
import { createStoreAction } from "@/lib/actions/store-actions";
import { decideChannel } from "@/lib/domain/channel";
import {
  CONTACT_FORMS,
  OPERATOR_TYPES,
} from "@/types/store";
import type { Profile } from "@/types/profile";
import { toast } from "@/components/ui/toast";
import type { ApplyConfidence, ApplyResult } from "@/lib/url-parser/types";
import { confidenceToBg } from "@/lib/url-parser/confidence-color";

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
  /** profile.id (空文字 = 未割当 → Server Action 側で null 化) */
  assigned_planner_user_id: string;
  /** profile.id (空文字 = 未割当 → Server Action 側で null 化) */
  assigned_sales_user_id: string;
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
  assigned_planner_user_id: "",
  assigned_sales_user_id: "",
  operator_type: "未設定",
  operator_name: "",
};

/** ApplyConfidence のキーと FormState のキーは大半が一致する。マッピング。 */
type ConfidenceKey = keyof ApplyConfidence;

/**
 * URL モードで親から渡される読込結果(StoreRegistrationTabs の `UrlSearchPanel` の onLoaded payload)。
 * 初期 state にマージして自動入力済みフォームを表示する。
 */
export interface StoreNewFormInitialImport {
  suggested: ApplyResult;
}

export interface StoreNewFormProps {
  /** 担当者選択肢 (RSC で `getAllProfiles()` 経由で取得) */
  profiles: readonly Profile[];
  /** 現在ログイン中の profile.id (デフォルト担当者として使用) */
  currentProfileId: string | null;
  /** URL モードで親パネルから渡される読込結果。`null` のときは手動モード扱い。 */
  initialImport?: StoreNewFormInitialImport | null;
  /** 手動モードで親パネルから渡される店舗名。`initialImport` がある場合はそちらが優先される。 */
  initialName?: string;
}

export function StoreNewForm({
  profiles,
  currentProfileId,
  initialImport = null,
  initialName = "",
}: StoreNewFormProps) {
  const initial: FormState = {
    ...INITIAL,
    // 現在ログイン中のユーザを企画担当のデフォルトとして初期セット
    assigned_planner_user_id: currentProfileId ?? "",
    // 手動モードで先行入力された店舗名(URL 読込結果がある場合は後段で上書きされる)
    ...(initialName ? { name: initialName } : {}),
    // URL 読込結果(initialImport)があれば上書き。priority / has_contact_form / channel /
    // target_service / assigned_* / operator_type は URL からは取れないため INITIAL の値を保持。
    ...(initialImport
      ? {
          name: initialImport.suggested.name,
          prefecture: initialImport.suggested.prefecture,
          city: initialImport.suggested.city,
          address: initialImport.suggested.address,
          genre: initialImport.suggested.genre,
          map_url: initialImport.suggested.map_url,
          site_url: initialImport.suggested.site_url,
          instagram_url: initialImport.suggested.instagram_url,
          phone: initialImport.suggested.phone,
          review_count:
            initialImport.suggested.review_count !== null
              ? String(initialImport.suggested.review_count)
              : "",
          review_avg:
            initialImport.suggested.review_avg !== null
              ? String(initialImport.suggested.review_avg)
              : "",
          memo: initialImport.suggested.memo,
          operator_name: initialImport.suggested.operator_name,
        }
      : {}),
  };
  const [form, setForm] = useState<FormState>(initial);
  const [confidence, setConfidence] = useState<ApplyConfidence>(
    initialImport?.suggested.confidence ?? {},
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // task 4.2 (PR3a): AiAnalysisPanel 撤去に伴い、AI 結果 state / useBeforeUnload 連動を削除。
  // 営業資産生成は登録後に店舗詳細の SalesAssetsGenerator から実行する設計に統一。

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

  /** 信頼度スコアから入力欄の背景色(プリミティブ string)を生成。
   * MemoInput / MemoTextarea に渡して shallow compare を成立させるため、
   * style オブジェクトではなく文字列で返す。 */
  const bgFor = (key: ConfidenceKey): string | undefined =>
    confidenceToBg(deferredConfidence[key]);

  const submit = (formData: FormData) => {
    // operator は form action 内の Select / Input で送信されるので追加不要。
    // ai_analysis_result は task 4.2 (PR3a) で AiAnalysisPanel を撤去したため
    // 新規登録フォームからは送信せず、登録後に店舗詳細で生成する設計に統一。
    startTransition(async () => {
      const result = await createStoreAction(null, formData);
      if (result.ok) {
        toast.success(result.message ?? "登録しました");
        router.push(`/stores/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit} className="space-y-4">
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
          <input type="hidden" name="priority" value="中" />
          <FormField
            label="運営者種別"
            htmlFor="operator_type"
            hint="個人店は受注成約率が高い傾向があり営業優先度の判断に使います"
          >
            <Select
              width="full"
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
              width="full"
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
            <FormField label="プランナー" htmlFor="assigned_planner_user_id">
              <Select
                width="full"
                id="assigned_planner_user_id"
                name="assigned_planner_user_id"
                value={form.assigned_planner_user_id}
                onChange={handlers.assigned_planner_user_id}
              >
                <option value="">未割当</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="営業担当" htmlFor="assigned_sales_user_id">
              <Select
                width="full"
                id="assigned_sales_user_id"
                name="assigned_sales_user_id"
                value={form.assigned_sales_user_id}
                onChange={handlers.assigned_sales_user_id}
              >
                <option value="">未割当</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
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

      {/* Submit footer (task 4.2 PR3a で AI Panel 撤去、本フォームは基本情報の登録のみ)。
          Card の外だがクラスを逐語コピーせず Card.Footer を呼ぶ (#270)。コピーすると
          プリミティブの修正 (狭幅の折り返しなど) が届かなくなる。 */}
      <Card.Footer className="rounded-md">
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
      </Card.Footer>
    </form>
  );
}
