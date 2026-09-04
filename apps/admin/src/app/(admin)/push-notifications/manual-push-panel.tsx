import { SendIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  submitManualPushNotification,
  submitPushReceiptCheck,
} from "./actions";

type PushCounts = {
  all: number;
  ios: number;
  android: number;
};

type RecentSend = {
  id: string;
  source: string;
  audience: string;
  platform: string | null;
  title: string;
  status: string;
  requestedCount: number;
  ticketCount: number;
  receiptOkCount: number;
  receiptErrorCount: number;
  deviceNotRegisteredCount: number;
  sentAt: string | null;
  receiptsCheckedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  receiptIdCount: number;
  lastTicketError: string | null;
};

type ActionMessage = {
  kind: "success" | "error";
  message: string;
} | null;

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusVariant(status: string): "default" | "outline" | "destructive" {
  if (status === "failed") return "destructive";
  if (status === "receipt_checked") return "outline";
  return "default";
}

export function ManualPushPanel({
  counts,
  recentSends,
  actionMessage,
}: {
  counts: PushCounts;
  recentSends: RecentSend[];
  actionMessage: ActionMessage;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">
            All mobile tokens
          </div>
          <div className="mt-2 text-2xl font-semibold">{counts.all}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">
            iOS
          </div>
          <div className="mt-2 text-2xl font-semibold">{counts.ios}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">
            Android
          </div>
          <div className="mt-2 text-2xl font-semibold">{counts.android}</div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Compose broadcast</CardTitle>
          <CardDescription>
            Sends to registered mobile wallet push tokens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actionMessage ? (
            <div
              className={cn(
                "mb-4 rounded-md border px-3 py-2 text-sm",
                actionMessage.kind === "error"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-foreground"
              )}
            >
              {actionMessage.message}
            </div>
          ) : null}

          <form action={submitManualPushNotification} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
              <label className="block">
                <span className="mb-1 block text-xs font-medium">Title</span>
                <Input name="title" maxLength={120} required />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium">Audience</span>
                <select
                  name="platform"
                  defaultValue="all"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="all">All mobile</option>
                  <option value="ios">iOS only</option>
                  <option value="android">Android only</option>
                  <option value="wallet">Wallet test</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium">
                Wallet public key
              </span>
              <Input
                name="walletPublicKey"
                placeholder="Solana wallet address for Wallet test"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium">Body</span>
              <textarea
                name="body"
                rows={4}
                maxLength={900}
                required
                className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium">Data JSON</span>
              <textarea
                name="data"
                rows={3}
                placeholder='{"screen":"wallet"}'
                className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
              <label className="block">
                <span className="mb-1 block text-xs font-medium">Operator</span>
                <Input name="createdBy" placeholder="name or handle" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium">
                  Confirmation
                </span>
                <Input name="confirmation" placeholder="SEND" required />
              </label>
            </div>

            <div className="flex justify-end">
              <Button type="submit">
                <SendIcon className="size-4" />
                Send push
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent sends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Receipts</TableHead>
                  <TableHead className="text-right">Pruned</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSends.length > 0 ? (
                  recentSends.map((send) => (
                    <TableRow key={send.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(send.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-56 truncate font-medium">
                          {send.title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {send.createdBy ?? send.source}
                        </div>
                        {send.lastTicketError ? (
                          <div className="mt-1 max-w-80 text-xs text-destructive">
                            {send.lastTicketError}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(send.status)}>
                          {send.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {send.platform ? send.platform : send.audience}
                      </TableCell>
                      <TableCell className="text-right">
                        {send.ticketCount}/{send.requestedCount}
                        {send.ticketCount > 0 ? (
                          <div className="text-xs text-muted-foreground">
                            {send.receiptIdCount} receipt IDs
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {send.receiptOkCount}/{send.receiptErrorCount}
                      </TableCell>
                      <TableCell className="text-right">
                        {send.deviceNotRegisteredCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <form action={submitPushReceiptCheck}>
                          <input
                            type="hidden"
                            name="sendId"
                            value={send.id}
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            size="xs"
                            disabled={send.receiptIdCount === 0}
                          >
                            {send.receiptIdCount === 0
                              ? "No receipts"
                              : "Check receipts"}
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No sends yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
