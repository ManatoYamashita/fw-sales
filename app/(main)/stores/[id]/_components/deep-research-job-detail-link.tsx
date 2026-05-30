import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DeepResearchJobDetailLinkProps {
  jobId: string;
  className?: string;
}

export function DeepResearchJobDetailLink({
  jobId,
  className,
}: DeepResearchJobDetailLinkProps) {
  return (
    <Link
      href={`/research/jobs/${jobId}`}
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium text-primary",
        "hover:text-primary/80 hover:underline underline-offset-4",
        className,
      )}
    >
      ジョブ詳細
      <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </Link>
  );
}
