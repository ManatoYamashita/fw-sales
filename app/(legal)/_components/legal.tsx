/**
 * 法的ページ ((legal) Route Group) 共通のプレゼンテーション部品。
 *
 * プライバシーポリシー / 利用規約のような縦長の文書ページで、見出し・本文の
 * タイポグラフィを 1 箇所に集約する。各ページ側は `LegalArticle` の中に
 * `LegalSection` を並べるだけで、統一された体裁になる。
 */

import type { ReactNode } from "react";

interface LegalArticleProps {
  /** 文書タイトル (h1 相当)。例: "プライバシーポリシー" */
  readonly title: string;
  /** 制定日 / 最終改定日などの注記。未指定なら表示しない。 */
  readonly effectiveDate?: string;
  /** タイトル直下に置く前文 (任意)。 */
  readonly lead?: ReactNode;
  /** 本文。通常は複数の `LegalSection` を渡す。 */
  readonly children: ReactNode;
}

export function LegalArticle({
  title,
  effectiveDate,
  lead,
  children,
}: LegalArticleProps) {
  return (
    <article className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {effectiveDate ? (
          <p className="text-xs text-muted-foreground">{effectiveDate}</p>
        ) : null}
      </div>
      {lead ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{lead}</p>
      ) : null}
      <div className="space-y-8">{children}</div>
    </article>
  );
}

interface LegalSectionProps {
  /** 章見出し (h2 相当)。 */
  readonly heading: string;
  /** 章本文。段落・リストなどを自由に配置する。 */
  readonly children: ReactNode;
}

export function LegalSection({ heading, children }: LegalSectionProps) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{heading}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
