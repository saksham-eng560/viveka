import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { apiErrorMessage, generateStandup } from "../lib/api";
import type { StandupNotesResponse } from "../lib/types";
import { Typewriter } from "./Typewriter";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: StandupNotesResponse }
  | { kind: "error"; message: string };

export function StandupGenerator({ date }: { date: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const requestId = useRef(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Do not leave the "Copied" reset timer running after unmount.
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // Reset when the selected day changes; ignore any in-flight response.
  useEffect(() => {
    requestId.current++;
    setState({ kind: "idle" });
    setCopied(false);
  }, [date]);

  async function run() {
    const id = ++requestId.current;
    setState({ kind: "loading" });
    setCopied(false);
    try {
      const result = await generateStandup(date);
      if (id === requestId.current) setState({ kind: "success", result });
    } catch (e) {
      if (id === requestId.current) setState({ kind: "error", message: apiErrorMessage(e) });
    }
  }

  async function copy() {
    if (state.kind !== "success") return;
    try {
      await navigator.clipboard.writeText(state.result.markdown);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const loading = state.kind === "loading";

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Standup notes</CardTitle>
          <CardDescription>Turn today's activity into a ready-to-paste standup.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {state.kind === "success" && (
            <Badge variant={state.result.generatedBy === "llm" ? "indigo" : "amber"}>
              {state.result.generatedBy === "llm" ? "AI" : "template"}
            </Badge>
          )}
          <Button onClick={run} disabled={loading} aria-busy={loading}>
            {loading ? "Generating..." : state.kind === "success" ? "Regenerate" : "Generate Standup"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {state.kind === "idle" && (
          <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Click <span className="font-medium">Generate Standup</span> to draft notes from your tracked day.
          </p>
        )}
        {loading && (
          <div className="space-y-3" role="status" aria-label="Generating standup">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {state.kind === "error" && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <p className="font-medium">Could not generate standup</p>
            <p className="mt-1">{state.message}</p>
          </div>
        )}
        {state.kind === "success" && (
          <div>
            <div className="markdown rounded-xl bg-zinc-50 p-4 dark:bg-zinc-950/50">
              <Typewriter
                key={state.result.markdown}
                text={state.result.markdown}
                speedMs={10}
                render={(visible) => <ReactMarkdown>{visible}</ReactMarkdown>}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 018 0v4" />
                </svg>
                Processed locally. No data left the machine.
              </p>
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <span className="sr-only" role="status">{copied ? "Copied to clipboard" : ""}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
