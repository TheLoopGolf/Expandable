import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <SearchX className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Record not found</h1>
      <p className="text-sm text-muted-foreground">It may belong to another organization, or the link is out of date.</p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
