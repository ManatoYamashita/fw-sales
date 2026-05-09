"use client";

import { memo, type CSSProperties } from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";

interface BgProp {
  /** 信頼度由来の背景色(プリミティブ string)。React.memo の shallow compare を成立させるため、style オブジェクトではなく文字列で受け取る。 */
  bg?: string;
}

export const MemoInput = memo(function MemoInputImpl({
  bg,
  style,
  ...rest
}: InputProps & BgProp) {
  const merged: CSSProperties | undefined = bg
    ? { ...style, backgroundColor: bg }
    : style;
  return <Input {...rest} style={merged} />;
});

export const MemoTextarea = memo(function MemoTextareaImpl({
  bg,
  style,
  ...rest
}: TextareaProps & BgProp) {
  const merged: CSSProperties | undefined = bg
    ? { ...style, backgroundColor: bg }
    : style;
  return <Textarea {...rest} style={merged} />;
});
