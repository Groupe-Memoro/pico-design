import Skeleton from "@/components/Skeleton";

export default function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32 rounded" />
          <Skeleton className="h-4 w-48 rounded" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <div className="overflow-hidden card shadow-sm">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-t border-neutral-100 p-4 first:border-t-0"
          >
            <Skeleton className="h-4 w-1/4 rounded" />
            <Skeleton className="h-4 w-1/6 rounded" />
            <Skeleton className="h-4 w-1/5 rounded" />
            <Skeleton className="ml-auto h-4 w-16 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
