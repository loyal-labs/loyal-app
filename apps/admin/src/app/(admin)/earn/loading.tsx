import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function EarnLoading() {
  return (
    <PageContainer>
      <SectionHeader
        breadcrumbs={[{ label: "Earn" }]}
        subtitle="Internal Yield Neon monitoring for Earn positions and autodeposit health"
        title="Earn"
      />
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Card key={index}>
              <CardHeader className="gap-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-24" />
              </CardHeader>
            </Card>
          ))}
        </div>
        <Skeleton className="h-[32rem] w-full" />
      </div>
    </PageContainer>
  );
}
