"use client";

import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CommunitySummaryRow } from "./community-summaries-data";

type CommunitySummariesTableProps = {
  summaries: CommunitySummaryRow[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  basePath: string;
};

type PaginationToken = number | "start-ellipsis" | "end-ellipsis";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getPaginationTokens(currentPage: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens: PaginationToken[] = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) {
    tokens.push("start-ellipsis");
  }

  for (let page = start; page <= end; page += 1) {
    tokens.push(page);
  }

  if (end < totalPages - 1) {
    tokens.push("end-ellipsis");
  }

  tokens.push(totalPages);
  return tokens;
}

function getPageHref(basePath: string, page: number) {
  return `${basePath}?page=${page}`;
}

function formatVoteCount(value: number) {
  return value === 0 ? "-" : String(value);
}

export function CommunitySummariesTable({
  summaries,
  totalCount,
  currentPage,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  basePath,
}: CommunitySummariesTableProps) {
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  const [selectedSummaryId, setSelectedSummaryId] = React.useState<string | null>(null);

  const selectedSummary = React.useMemo(
    () => summaries.find((summary) => summary.id === selectedSummaryId) ?? null,
    [summaries, selectedSummaryId],
  );
  const paginationTokens = React.useMemo(
    () => getPaginationTokens(currentPage, totalPages),
    [currentPage, totalPages],
  );

  React.useEffect(() => {
    if (isSheetOpen && !selectedSummary) {
      setIsSheetOpen(false);
      setSelectedSummaryId(null);
    }
  }, [isSheetOpen, selectedSummary]);

  function openSummary(summaryId: string) {
    setSelectedSummaryId(summaryId);
    setIsSheetOpen(true);
  }

  function onOpenChange(nextOpen: boolean) {
    setIsSheetOpen(nextOpen);
    if (!nextOpen) {
      setSelectedSummaryId(null);
    }
  }

  return (
    <Card className="w-full min-w-0">
      <details className="group">
        <summary className="flex list-none cursor-pointer items-start justify-between gap-4 px-6 py-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle>Recent summaries</CardTitle>
            <CardDescription>
              Browse the latest summary runs for this community.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {totalCount.toLocaleString("en-US")} total
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>One-line summary</TableHead>
                <TableHead className="text-right">Votes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.length > 0 ? (
                summaries.map((summary) => (
                  <TableRow
                    key={summary.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
                    onClick={() => openSummary(summary.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openSummary(summary.id);
                      }
                    }}
                  >
                    <TableCell className="w-40 font-mono text-xs text-muted-foreground">
                      {formatDate(summary.createdAt)}
                    </TableCell>
                    <TableCell
                      title={summary.oneliner}
                      className="max-w-[46rem] overflow-hidden text-ellipsis font-medium"
                    >
                      {summary.oneliner}
                    </TableCell>
                    <TableCell className="w-28 text-right font-mono text-xs">
                      <span className="sr-only">Likes / Dislikes: </span>
                      <span
                        className={
                          summary.likesCount > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                        }
                      >
                        {formatVoteCount(summary.likesCount)}
                      </span>
                      <span className="px-1 text-muted-foreground">/</span>
                      <span
                        className={
                          summary.dislikesCount > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                        }
                      >
                        {formatVoteCount(summary.dislikesCount)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="px-4 py-10 text-center whitespace-normal text-muted-foreground"
                  >
                    No summaries found for this community.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="border-t border-border px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>

              <Pagination className="mx-0 w-auto justify-start sm:justify-end">
                <PaginationContent>
                  <PaginationItem>
                    {hasPreviousPage ? (
                      <PaginationLink asChild size="default" className="gap-1 pl-2.5">
                        <Link href={getPageHref(basePath, currentPage - 1)} prefetch={false}>
                          <ChevronLeftIcon className="size-4" />
                          <span>Previous</span>
                        </Link>
                      </PaginationLink>
                    ) : (
                      <PaginationLink
                        size="default"
                        aria-disabled="true"
                        className="pointer-events-none gap-1 pl-2.5 opacity-50"
                      >
                        <ChevronLeftIcon className="size-4" />
                        <span>Previous</span>
                      </PaginationLink>
                    )}
                  </PaginationItem>

                  {paginationTokens.map((token) => {
                    if (token === "start-ellipsis" || token === "end-ellipsis") {
                      return (
                        <PaginationItem key={token}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      );
                    }

                    return (
                      <PaginationItem key={token}>
                        <PaginationLink asChild isActive={token === currentPage}>
                          <Link href={getPageHref(basePath, token)} prefetch={false}>
                            {token}
                          </Link>
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}

                  <PaginationItem>
                    {hasNextPage ? (
                      <PaginationLink asChild size="default" className="gap-1 pr-2.5">
                        <Link href={getPageHref(basePath, currentPage + 1)} prefetch={false}>
                          <span>Next</span>
                          <ChevronRightIcon className="size-4" />
                        </Link>
                      </PaginationLink>
                    ) : (
                      <PaginationLink
                        size="default"
                        aria-disabled="true"
                        className="pointer-events-none gap-1 pr-2.5 opacity-50"
                      >
                        <span>Next</span>
                        <ChevronRightIcon className="size-4" />
                      </PaginationLink>
                    )}
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        </div>
      </details>

      <Sheet open={isSheetOpen} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          {selectedSummary ? (
            <>
              <SheetHeader>
                <SheetTitle>Summary details</SheetTitle>
                <SheetDescription>{formatDate(selectedSummary.createdAt)}</SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold tracking-tight">One-line summary</h3>
                  <p className="text-sm text-muted-foreground">{selectedSummary.oneliner}</p>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold tracking-tight">Votes</h3>
                  <p className="text-sm text-muted-foreground">
                    Likes:{" "}
                    <span
                      className={
                        selectedSummary.likesCount > 0
                          ? "font-medium text-green-600 dark:text-green-400"
                          : "text-muted-foreground"
                      }
                    >
                      {formatVoteCount(selectedSummary.likesCount)}
                    </span>{" "}
                    · Dislikes:{" "}
                    <span
                      className={
                        selectedSummary.dislikesCount > 0
                          ? "font-medium text-red-600 dark:text-red-400"
                          : "text-muted-foreground"
                      }
                    >
                      {formatVoteCount(selectedSummary.dislikesCount)}
                    </span>
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold tracking-tight">
                    Topics ({selectedSummary.topics.length})
                  </h3>

                  {selectedSummary.topics.length > 0 ? (
                    <div className="space-y-3">
                      {selectedSummary.topics.map((topic, index) => (
                        <article
                          key={`${selectedSummary.id}-topic-${index}`}
                          className="space-y-2 rounded-lg border border-border p-3"
                        >
                          <h4 className="text-sm font-semibold">{topic.title}</h4>
                          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                            {topic.content}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">Sources:</span>{" "}
                            {topic.sources.length > 0
                              ? topic.sources.join(", ")
                              : "No sources listed."}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This summary does not include any topics.
                    </p>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
