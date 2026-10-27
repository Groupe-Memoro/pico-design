import Skeleton from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40 rounded" />
          <Skeleton className="h-4 w-48 rounded" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden card shadow-sm"
          >
            <Skeleton className="h-32" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
