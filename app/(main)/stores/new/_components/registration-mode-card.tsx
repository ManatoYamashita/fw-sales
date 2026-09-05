"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { Compass, Download, MapPin, MapPinOff, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { importFromUrlAction } from "@/lib/actions/url-parse-actions";
import { Select } from "@/components/ui/select";
import { searchPlacesWithMatchesAction } from "@/lib/actions/area-search-actions";
import type {
  AppliedField,
  ApplyResult,
  ParsedSource,
} from "@/lib/url-parser/types";
import type {
  AreaSearchMeta,
  AreaSearchPlaceViewModel,
  SearchCenter,
} from "@/lib/places/types";
import type { UrlImportRejectReason } from "@/lib/url-parser/url-import-policy";
import type { PlacesFallbackReason } from "@/lib/url-parser/places-fallback";

/**
 * 受け付けなかった URL に対するユーザー向け文言 (Issue #207)。
 *
 * **技術用語 (OGP / HTTP 403 / Cloudflare / Vercel / bot challenge / sourceType) は出さない。**
 * ユーザーが知りたいのは原因の内部詳細ではなく「次に何をすればよいか」なので、
 * すべて次の行動を含む文にする。診断情報はサーバ側の構造化ログが担う。
 *
 * export しているのは文言の回帰テスト (`__tests__/url-import-ui-copy.test.tsx`) から
 * 参照するため。UI からの利用は本ファイル内に閉じている。
 */
export const REJECT_MESSAGE: Record<UrlImportRejectReason, string> = {
  tabelog_unsupported:
    "食べログURLからの自動入力には対応していません。Googleマップの店舗URLを貼り付けてください。",
  unsupported_source: "Googleマップの店舗URLを貼り付けてください。",
  not_place_url: "店舗ページのGoogleマップURLを貼り付けてください。",
  invalid_url: "URLの形式を確認してください。",
  // 一時的な取得失敗。URL 自体は正しい可能性があるため貼り直しを促さない
  // (`not_place_url` と取り違えると、有効な共有 URL で貼り直しを繰り返させる)。
  short_url_resolve_failed:
    "Googleマップの共有URLを読み込めませんでした。時間をおいてもう一度お試しください。",
};

/**
 * Places 補完が実行されなかった / 失敗した理由ごとの警告文言 (Issue #207)。
 *
 * 変更前はこれらがすべて「Google Maps で店舗を特定できませんでした」に潰れていた。
 * とくに `no_keyword` は **Places を一度も呼んでいない**状態であり、
 * 「Google マップで見つからなかった」と表示するのは事実と異なる。
 *
 * いずれの場合も **URL から取得済みの値は保持したままフォームへ進む**
 * (Places 補完の失敗を URL Import 全体の失敗にしない)。
 *
 * `Partial<Record<PlacesFallbackReason, string>>` にしているのは、reason を
 * 増やしたときに文言の追随漏れを型で気付けるようにするため。
 * 発火理由 (`missing_name` 等) と `none` は警告不要なので載せない。
 */
const PLACES_WARNING: Partial<Record<PlacesFallbackReason, string>> = {
  no_keyword:
    "店舗名を読み取れなかったため、Googleマップの情報照合は行いませんでした。内容を確認して不足項目を入力してください。",
  places_not_found:
    "Googleマップで一致する店舗が見つかりませんでした。内容を確認して不足項目を入力してください。",
  ambiguous:
    "同名の候補が複数あり、店舗を一意に特定できませんでした。内容を確認して不足項目を入力してください。",
  api_error:
    "Googleマップの情報照合に失敗しました。内容を確認して不足項目を入力してください。",
  // API キー未設定は利用者の操作対象外だが、黙って成功扱いにすると
  // 「なぜ住所が入らないのか」が分からない。原因には触れず次の行動だけ伝える。
  no_api_key:
    "一部の情報のみ取得しました。内容を確認して不足項目を入力してください。",
};

/** URL モードの読込結果(親に渡す payload) */
export interface UrlLoadPayload {
  suggested: ApplyResult;
  applied: readonly AppliedField[];
  sourceType: ParsedSource;
}

// ---- Manual ----------------------------------------------------------------

export interface ManualStartPanelProps {
  onStart: (name: string) => void;
}

export function ManualStartPanel({ onStart }: ManualStartPanelProps) {
  const [storeName, setStoreName] = useState("");

  const submit = () => {
    const v = storeName.trim();
    if (!v) return;
    onStart(v);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const canSubmit = storeName.trim().length > 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        GoogleマップURLやエリア検索を使わず、フォームに直接入力します。
        まず店舗名を入力し、Enter または「フォームを開く」で他の項目を入力できます。
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="店舗名を入力"
          className="flex-1"
          aria-label="店舗名"
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={!canSubmit}
          className="sm:w-40 gap-2"
        >
          <Pencil className="h-4 w-4" />
          フォームを開く
        </Button>
      </div>
    </div>
  );
}

// ---- URL ------------------------------------------------------------------

export interface UrlSearchPanelProps {
  onLoaded: (payload: UrlLoadPayload) => void;
}

/**
 * Google マップの店舗 URL から店舗情報を読み込むパネル (Issue #207)。
 *
 * 対応するのは Google マップの店舗ページ URL と短縮共有 URL のみ。
 * 判定は server 側 (`importFromUrlAction` → `evaluateUrlImportPolicy`) が
 * source of truth で、ここは受け取った `reason` を文言へ写像するだけ。
 */
export function UrlSearchPanel({ onLoaded }: UrlSearchPanelProps) {
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();

  const importNow = () => {
    if (!url.trim()) {
      toast.warn("URL を入力してください");
      return;
    }
    startTransition(async () => {
      try {
        const result = await importFromUrlAction(url);

        // 受け付けない URL(食べログ / 一般ページ / 店舗ページでない Maps URL / 不正形式)。
        // この場合サーバ側では外部への HTTP リクエストを一切行っていない。
        if (result.status === "rejected") {
          toast.warn(REJECT_MESSAGE[result.reason]);
          return;
        }

        // 店舗名が取れていない場合はフォームへ進めない。
        // 空欄や誤った値を店舗名としてフォームへ渡さないため(Issue #207)。
        if (!result.suggested.name) {
          toast.warn(
            "店舗名を読み取れませんでした。Googleマップの店舗ページURLを貼り直すか、エリア検索をご利用ください。",
          );
          return;
        }

        const hits = result.applied.filter(
          (f) => f.value !== "" && typeof f.confidence === "number",
        );
        const summary = `${result.applied.length} 項目中 ${hits.length} 項目を取得`;
        const placesReason = result.placesFallback?.reason;

        if (result.placesFallback?.used) {
          toast.info(`Googleマップから不足項目を補完しました (${result.suggested.name})`);
        } else if (placesReason !== undefined && PLACES_WARNING[placesReason]) {
          // Places 補完できなかった場合も、URL から取得済みの値は保持したままフォームへ進む。
          toast.warn(PLACES_WARNING[placesReason]);
        } else {
          toast.success(`「${result.suggested.name}」: ${summary}`);
        }

        onLoaded({
          suggested: result.suggested,
          applied: result.applied,
          sourceType: result.parsed.type,
        });
      } catch {
        // Node のエラー文言をそのまま UI へ出さない(内部情報の露出防止)。
        toast.error("URL の読込に失敗しました。時間をおいて再度お試しください。");
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      importNow();
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Googleマップの店舗ページURLを貼り付けて「読込」を押すと、
        店舗名・住所・電話番号・口コミ情報などを自動入力します。
        アプリの共有リンク (maps.app.goo.gl/…) も使えます。
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://www.google.com/maps/place/... または https://maps.app.goo.gl/..."
          className="flex-1"
          aria-label="GoogleマップURL"
        />
        <Button
          variant="primary"
          onClick={importNow}
          disabled={pending}
          className="sm:w-32 gap-2"
        >
          {pending ? (
            <>
              <Spinner tone="primary" />
              読込中…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              読込
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---- Area -----------------------------------------------------------------

/** 半径選択肢 (メートル)。初期値は1km。 */
const RADIUS_OPTIONS = [
  { value: 500, label: "500m" },
  { value: 1000, label: "1km" },
  { value: 2000, label: "2km" },
  { value: 3000, label: "3km" },
] as const;

const DEFAULT_RADIUS_METERS = 1000;

/** エリア検索1回分の結果。「もっと読み込む」で再検索する際に keyword/area/center/radius を引き継ぐ。 */
export interface AreaSearchSessionResult {
  places: readonly AreaSearchPlaceViewModel[];
  nextPageToken: string | null;
  keyword: string;
  /** 中心地点入力値 (駅名・住所など)。互換のためプロパティ名は `area` のまま。 */
  area: string;
  /** `area` を解決した緯度経度。 */
  center: SearchCenter;
  /** 検索半径 (メートル)。 */
  radiusMeters: number;
  /** 初回検索のメタ情報 (取得元・上限件数・API回数目安など)。 */
  meta: AreaSearchMeta;
}

export interface AreaSearchPanelProps {
  onSearched: (result: AreaSearchSessionResult) => void;
  isPlacesApiConfigured: boolean;
}

export function AreaSearchPanel({
  onSearched,
  isPlacesApiConfigured,
}: AreaSearchPanelProps) {
  const [keyword, setKeyword] = useState("");
  const [area, setArea] = useState("");
  const [radiusMeters, setRadiusMeters] = useState<number>(DEFAULT_RADIUS_METERS);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!isPlacesApiConfigured) return;
    setError(null);
    startTransition(async () => {
      const result = await searchPlacesWithMatchesAction(
        keyword,
        area,
        radiusMeters,
      );
      if (result.ok) {
        const { places, nextPageToken, center, meta } = result.data;
        if (places.length === 0) {
          setError(
            "該当する店舗が見つかりませんでした。条件を変えて再検索してください。",
          );
        }
        onSearched({ places, nextPageToken, keyword, area, center, radiusMeters, meta });
      } else {
        setError(result.error);
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      isPlacesApiConfigured
    ) {
      e.preventDefault();
      handleSearch();
    }
  };

  if (!isPlacesApiConfigured) {
    return (
      <EmptyState
        icon={<MapPinOff />}
        title="Google Places APIキーが未設定です"
        description="エリア検索を利用するには .env.local に GOOGLE_PLACES_API_KEY を設定してください。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_auto] gap-3 md:items-start">
        <FormField
          required
          label={
            <span className="inline-flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              キーワード
            </span>
          }
          htmlFor="keyword"
          hint="業態や店舗名"
        >
          <Input
            id="keyword"
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例: 居酒屋、カフェ、焼肉"
          />
        </FormField>
        <FormField
          required
          label={
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              中心地点
            </span>
          }
          htmlFor="area"
          hint="駅名や住所"
        >
          <Input
            id="area"
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例: 渋谷駅、新宿駅"
          />
        </FormField>
        <FormField
          label={
            <span className="inline-flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5 text-muted-foreground" />
              半径
            </span>
          }
          htmlFor="radius"
          hint="中心からの距離"
        >
          <Select
            width="full"
            id="radius"
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
          >
            {RADIUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </FormField>
        {/* ボタン列: ラベル高さ分の透明スペーサーで Input 行に水平整列。
            モバイル(grid-cols-1)では下に積まれる。 */}
        <div className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className="hidden md:inline text-xs font-semibold leading-none invisible"
          >
            _
          </span>
          <Button
            variant="primary"
            onClick={handleSearch}
            disabled={pending}
            className="gap-2 w-full md:w-auto"
          >
            {pending ? (
              <>
                <Spinner tone="primary" />
                検索中…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                店舗を検索
              </>
            )}
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}
