import type { Quote } from "../../lib/quotes";
import { cn } from "../../lib/utils";

export function QuoteBlock({ quote, className }: { quote: Quote; className?: string }) {
  return (
    <figure className={cn("border-l-[3px] border-saffron pl-3 text-left", className)} data-testid="quote-block">
      <blockquote className="font-serif text-[15px] leading-[23px] text-heading italic">{quote.text}</blockquote>
      <figcaption className="mt-1.5 text-[11px] leading-[15px] font-medium text-muted">
        — Swami Vivekananda, {quote.source}
      </figcaption>
    </figure>
  );
}
