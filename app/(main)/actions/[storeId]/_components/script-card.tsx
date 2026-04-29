import { type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { CopyButton } from "./copy-button";

export function ScriptCard({
  title,
  icon,
  text,
}: {
  title: string;
  icon: ReactNode;
  text: string;
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title className="inline-flex items-center gap-2">
          {icon}
          {title}
        </Card.Title>
        <CopyButton text={text} />
      </Card.Header>
      <Card.Body>
        <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 leading-7 bg-slate-900/5 rounded-md p-3">
          {text}
        </pre>
      </Card.Body>
    </Card>
  );
}
