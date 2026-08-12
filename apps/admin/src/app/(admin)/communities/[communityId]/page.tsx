import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { CommunityTrendLineChart } from "../community-trend-line-chart";
import { CommunityMessagesBarChart } from "./community-messages-bar-chart";
import { CommunityActiveUsersBarChart } from "./community-active-users-bar-chart";
import { CommunityNotificationSettingsCard } from "./community-notification-settings-card";
import { CommunityTopUsersBarChart } from "./community-top-users-bar-chart";
import { CommunitySummariesTable } from "./community-summaries-table";

import { getCommunityOverviewData, isValidUuid } from "./community-overview-data";
import { getCommunitySummariesPage, parsePageParam } from "./community-summaries-data";

export const dynamic = "force-dynamic";

type CommunityPageProps = {
  params: Promise<{
    communityId: string;
  }>;
  searchParams?: Promise<{
    page?: string | string[];
  }>;
};

export default async function CommunityPage({ params, searchParams }: CommunityPageProps) {
  const { communityId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const pageParam = Array.isArray(resolvedSearchParams.page)
    ? resolvedSearchParams.page[0]
    : resolvedSearchParams.page;
  const requestedPage = parsePageParam(pageParam);

  if (!isValidUuid(communityId)) {
    notFound();
  }

  const data = await getCommunityOverviewData(communityId);

  if (!data) {
    notFound();
  }

  const summariesPage = await getCommunitySummariesPage(communityId, requestedPage);

  return (
    <PageContainer>
      <SectionHeader
        title={data.community.chatTitle}
        breadcrumbs={[
          { label: "Community", href: "/" },
          { label: data.community.chatTitle },
        ]}
        subtitle={`Telegram ID: ${String(data.community.chatId)}`}
      />

      <div className="space-y-6">
        <CommunityNotificationSettingsCard
          communityId={data.community.id}
          settings={{
            isActive: data.community.isActive,
            isPublic: data.community.isPublic,
            summaryNotificationsEnabled: data.community.summaryNotificationsEnabled,
            summaryNotificationTimeHours: data.community.summaryNotificationTimeHours,
            summaryNotificationMessageCount: data.community.summaryNotificationMessageCount,
          }}
        />

        <CommunitySummariesTable
          summaries={summariesPage.rows}
          totalCount={summariesPage.totalCount}
          currentPage={summariesPage.currentPage}
          totalPages={summariesPage.totalPages}
          hasPreviousPage={summariesPage.hasPreviousPage}
          hasNextPage={summariesPage.hasNextPage}
          basePath={`/communities/${data.community.id}`}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="min-w-0 h-full">
            <CommunityMessagesBarChart data={data.messagesChartPoints} stats={data.messagesStats30d} />
          </div>
          <div className="min-w-0 h-full">
            <CommunityActiveUsersBarChart
              data={data.activeUsersChartPoints}
              stats={data.activeUsersStats30d}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="min-w-0 h-full">
            <CommunityTopUsersBarChart data={data.topUsersChartPoints} />
          </div>
          <div className="min-w-0 h-full">
            <CommunityTrendLineChart
              title="Activity trend"
              description="Total number of summaries created in the last 30 days for this community"
              primaryLabel="Summaries"
              secondaryLabel="Messages"
              dataKey="summaries"
              data={data.chartPoints}
              totals={{
                primary: data.totals30d.summaries,
                secondary: data.totals30d.messages,
              }}
              yAxisLabel="Cumulative summaries"
            />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
