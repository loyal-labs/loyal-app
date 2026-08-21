import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function EarnRebalanceLoading() {
  return (
    <PageContainer>
      <SectionHeader
        breadcrumbs={[{ href: "/earn", label: "Earn" }, { label: "Rebalance" }]}
        subtitle="Stablecoin Safe reserve APY and optimizer decision monitoring"
        title="Rebalance"
      />
      <div className="mx-auto grid w-full max-w-4xl gap-6">
        <section className="grid h-[42rem] gap-6">
          <Skeleton className="h-24 w-full" />
          <Card className="min-w-0">
            <CardHeader>
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-3"
                  key={index}
                >
                  {Array.from({ length: 5 }, (_, cellIndex) => (
                    <Skeleton className="h-8" key={cellIndex} />
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
        <section className="h-[52rem]">
          <Card className="w-full">
            <CardHeader className="border-b">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </CardHeader>
            <CardContent className="px-2 sm:px-6">
              <Skeleton className="h-[300px] w-full" />
              <div className="mt-4 flex flex-wrap gap-3">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton className="h-4 w-28" key={index} />
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </PageContainer>
  );
}
