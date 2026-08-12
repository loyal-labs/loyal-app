"use client";

import { useMemo, useState } from "react";
import { Clock4 } from "lucide-react";

import {
  AddressLink,
  OrbTransactionLink,
} from "@/components/blockchain/address-link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { SmartAccountRegistrationRow } from "./smart-accounts-data";

type TimeZoneMode = "local" | "utc";

const dateTimeFormatOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "short",
  timeZoneName: "short",
  year: "numeric",
};

const utcDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  ...dateTimeFormatOptions,
  timeZone: "UTC",
});

function formatRegistrationDate(
  value: string,
  timeZoneMode: TimeZoneMode,
  localDateTimeFormatter: Intl.DateTimeFormat
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return timeZoneMode === "utc"
    ? utcDateTimeFormatter.format(date)
    : localDateTimeFormatter.format(date);
}

export function RecentRegistrationsTable({
  registrations,
}: {
  registrations: SmartAccountRegistrationRow[];
}) {
  const [timeZoneMode, setTimeZoneMode] = useState<TimeZoneMode>("utc");
  const localDateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat("en-US", dateTimeFormatOptions),
    []
  );
  const nextTimeZoneMode = timeZoneMode === "utc" ? "local" : "utc";
  const nextTimeZoneLabel = nextTimeZoneMode === "utc" ? "UTC" : "local";

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <div className="flex items-center gap-1.5">
                <span>Registration date</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={`Show registration dates in ${nextTimeZoneLabel} time`}
                      aria-pressed={timeZoneMode === "local"}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setTimeZoneMode(nextTimeZoneMode)}
                      size="icon-xs"
                      title={`Show ${nextTimeZoneLabel} time`}
                      type="button"
                      variant="ghost"
                    >
                      <Clock4 aria-hidden="true" className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Show {nextTimeZoneLabel} time
                  </TooltipContent>
                </Tooltip>
              </div>
            </TableHead>
            <TableHead>User address</TableHead>
            <TableHead>Vault address</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {registrations.length > 0 ? (
            registrations.map((registration) => {
              const formattedRegistrationDate = formatRegistrationDate(
                registration.registeredAt,
                timeZoneMode,
                localDateTimeFormatter
              );

              return (
                <TableRow key={registration.id}>
                  <TableCell className="tabular-nums">
                    {registration.sponsorshipSignature ? (
                      <OrbTransactionLink
                        signature={registration.sponsorshipSignature}
                      >
                        {formattedRegistrationDate}
                      </OrbTransactionLink>
                    ) : (
                      formattedRegistrationDate
                    )}
                  </TableCell>
                  <TableCell>
                    <AddressLink address={registration.userAddress} />
                  </TableCell>
                  <TableCell>
                    {registration.vaultAddress ? (
                      <AddressLink address={registration.vaultAddress} />
                    ) : (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell
                className="py-8 text-center text-muted-foreground"
                colSpan={3}
              >
                No smart account registrations found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
