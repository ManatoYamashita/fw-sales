import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground border border-border rounded-lg shadow-card overflow-hidden",
        "transition-shadow duration-200",
        className,
      )}
      {...props}
    />
  );
}

/**
 * カードの見出し行。左に `Card.Title`、右に操作を置く 2 カラムとして使う。
 *
 * ## `flex-wrap` を持つ理由 (#270)
 *
 * `Card` は `overflow-hidden` を持ち、`Button` の基底は `whitespace-nowrap` を持つ。
 * つまり**縮まないものを、逃げ場のない箱に入れている**。折り返しが無いと、狭幅で
 * 右側の操作はスクロールもできず切り取られ、押せなくなる。`app/globals.css` の
 * `overflow-x: clip` (`docs/architecture/responsive.md` §6) があるため、症状は
 * 「はみ出す」ではなく**「押せない」**として現れ、目視では気づきにくい。
 *
 * ただし症状は幅の帯で 2 段階に分かれる (#270 の掃引実測)。切り取りが起きるのは
 * Card 幅 294px 以下 = viewport 326px 相当で、**375px の下限より下**。下限内で
 * 起きていたのは切り取りではなく**潰し合い**で、`Card.Title` は `h3` かつ日本語の
 * min-content が文字単位まで小さいため、折り返しが無いとタイトル側が縮んで 2 行に
 * なっていた (375px で 109 → 87px)。
 *
 * `flex-wrap: wrap` は各アイテムの**縮小前の寸法**で行を決めるので、`whitespace-nowrap`
 * のボタン群はタイトルと同居できないとき丸ごと 2 行目へ落ちる。タイトルだけが残った
 * 1 行目で折り返す、という中途半端な潰れ方にはならない。
 *
 * 折り返しが起きるのは Card 幅がおおむね 380px 未満のときだけで、実アプリのコンテンツ
 * 幅 (767px viewport でも 733px、lg の 2 カラムでも 478px) では 1 行のまま。
 * **デスクトップの見た目は変わらない。**
 *
 * ## `min-w-0` を入れない理由
 *
 * §4.5 は `flex-wrap` と併せて `min-w-0` の欠如も挙げているが、`Card.Header` の子に
 * `truncate` を持つものは無い。`min-w-0` は min-content を割ることを許す指定なので、
 * 折り返し先が無い状況では要素どうしの重なりを招くだけになる。**必要になるのは
 * `truncate` を持つ子を足すときで、そのときに一緒に入れる。**
 *
 * ## 2 行目の寄せは `[&>*+*]:ml-auto` が持つ
 *
 * `justify-content` は**行ごとに**効くため、操作群だけが落ちた 2 行目は
 * `justify-between` だけでは左寄せになる。2 番目以降の子へ `margin-left: auto` を
 * 与えると、折り返した行でも右寄せが保たれる。
 *
 * **消費者へ配らず、ここで持つ。** 当初は操作ラッパ側へ `ml-auto` を書き、走査ガードで
 * 強制する設計だったが、`{editing ? <保存群/> : <編集/>}` のように分岐を持つヘッダでは
 * 「ブロック内に `ml-auto` が 1 つでもあれば通る」ため、**分岐の片方が欠けても素通り
 * した** (negative control で実証)。分岐まで読む走査は壊れやすく、壊れたことも
 * 分からない。CSS で構造的に効かせるほうが検知の問題ごと消える。
 *
 * 子が 1 つのときは `* + *` に当たらないので何も起きない (見出しだけのヘッダを
 * 右へ寄せてしまわない)。子が 3 つ以上のときは auto マージンが余白を等分するので、
 * `justify-between` と同じ配置になる。
 */
function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 [&>*+*]:ml-auto px-5 py-4 border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-base font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

type CardBodyProps = HTMLAttributes<HTMLDivElement> & {
  padding?: "default" | "compact" | "flush" | "spacious";
};

function CardBody({ className, padding = "default", ...props }: CardBodyProps) {
  const paddingClass = {
    default: "px-5 py-4",
    compact: "px-5 py-1",
    flush: "p-0",
    spacious: "px-5 py-8",
  }[padding];

  return <div className={cn(paddingClass, className)} {...props} />;
}

/**
 * カードの操作行。`Card.Header` と同じ理由で `flex-wrap` を持つ (#270)。
 *
 * `justify-end` なので折り返した行も右寄せのままになり、`Card.Header` の
 * `[&>*+*]:ml-auto` に相当するものは要らない。
 *
 * `Card` の外でも使える (中身は素の `div`)。フォーム末尾の送信バーのように、
 * カードの外に同じ見た目の操作行が要る場合は**クラスを逐語コピーせずここを呼ぶ**。
 * コピーするとプリミティブの修正が届かなくなる (実際に #270 の時点で 2 箇所あった)。
 */
function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30",
        className,
      )}
      {...props}
    />
  );
}

const CardCompound = Object.assign(Card, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Body: CardBody,
  Footer: CardFooter,
});

export {
  CardCompound as Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  CardFooter,
};
