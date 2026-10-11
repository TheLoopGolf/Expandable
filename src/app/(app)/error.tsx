"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <TriangleAlert className="size-10 text-destructive" />
      <h1 className="text-lg font-semibold">This page failed to load</h1>
      <p className="text-sm text-muted-foreground">No data was changed. Try again, or go back to the dashboard.</p>
      {error.digest && <code className="text-xs text-muted-foreground">Reference {error.digest}</code>}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
