import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <Card className={`min-w-0 ${className}`}>
      <CardHeader className="gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-3/4 max-w-lg" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[220px] w-full" />
      </CardContent>
    </Card>
  );
}

export function MetricsLatencySkeleton() {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full max-w-3xl" />
        <Skeleton className="h-4 w-2/3 max-w-2xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card className="gap-2 py-4" key={index}>
            <CardHeader className="gap-2 px-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-24" />
            </CardHeader>
            <CardContent className="px-4">
              <Skeleton className="h-4 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>
      <SkeletonCard className="min-h-[510px]" />
      <Card className="min-w-0 min-h-[500px]">
        <CardHeader className="gap-2">
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-[320px] w-full" />
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton className="h-14 w-full" key={index} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SurfaceSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

export function MetricsDashboardSkeleton() {
  return (
    <div aria-hidden="true" className="min-h-[1000px] space-y-8">
      <div className="flex min-h-[74px] flex-wrap gap-x-10 gap-y-3 rounded-lg border bg-card px-4 py-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="flex min-w-28 flex-col gap-2" key={index}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
      <SurfaceSkeleton />
      <SurfaceSkeleton />
    </div>
  );
}

export function MetricsLoadingSkeleton() {
  return (
    <div className="space-y-10">
      <MetricsLatencySkeleton />
      <MetricsDashboardSkeleton />
    </div>
  );
}
