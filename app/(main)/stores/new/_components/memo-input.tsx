"use client";

import { memo, type CSSProperties } from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";

interface BgProp {
  /** 信頼度由来の背景色(プリミティブ string)。React.memo の shallow compare を成立させるため、style オブジェクトではなく文字列で受け取る。 */
  bg?: string;
}

// confidence 背景色は lightness 92% の固定の薄色。`text-foreground` がダークモードでは
// 白くなり可読性が落ちるため、`bg` 指定時は必ず濃い文字色 (slate-900 相当) を強制する。
const CONFIDENCE_FG = "hsl(222 47% 11%)";

export const MemoInput = memo(function MemoInputImpl({
  bg,
  style,
  ...rest
}: InputProps & BgProp) {
  const merged: CSSProperties | undefined = bg
    ? { ...style, backgroundColor: bg, color: CONFIDENCE_FG }
    : style;
  return <Input {...rest} style={merged} />;
});

export const MemoTextarea = memo(function MemoTextareaImpl({
  bg,
  style,
  ...rest
}: TextareaProps & BgProp) {
  const merged: CSSProperties | undefined = bg
    ? { ...style, backgroundColor: bg, color: CONFIDENCE_FG }
    : style;
  return <Textarea {...rest} style={merged} />;
});
