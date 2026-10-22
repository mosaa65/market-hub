import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // One loading language: `shimmer` — matches CardSkeletonGrid / TableSkeleton.
  return <div className={cn("shimmer rounded-md bg-primary/10", className)} {...props} />;
}

export { Skeleton };
