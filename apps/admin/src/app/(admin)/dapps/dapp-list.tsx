"use client";

import { TRUSTED_DAPP_CATEGORIES } from "@loyal-labs/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  addTrustedDapp,
  deleteTrustedDapp,
  seedAllowlist,
  toggleTrustedDappActive,
  updateTrustedDapp,
} from "./actions";

type DappRow = {
  id: string;
  origin: string;
  name: string;
  startUrl: string;
  category: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const UNCATEGORIZED_VALUE = "__uncategorized__";

function DappForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: DappRow;
  onSubmit: (fd: FormData) => Promise<{ error?: string; success?: boolean }>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<string>(
    initial?.category ?? UNCATEGORIZED_VALUE,
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (category === UNCATEGORIZED_VALUE) {
      fd.delete("category");
    } else {
      fd.set("category", category);
    }
    startTransition(async () => {
      const result = await onSubmit(fd);
      if (result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-4"
    >
      {error && (
        <div className="mb-3 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Name <span className="text-destructive">*</span>
          </span>
          <Input
            name="name"
            type="text"
            required
            placeholder="Jupiter"
            defaultValue={initial?.name ?? ""}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Category</span>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Uncategorized" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNCATEGORIZED_VALUE}>Uncategorized</SelectItem>
              {TRUSTED_DAPP_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Origin <span className="text-destructive">*</span>
          </span>
          <Input
            name="origin"
            type="url"
            required
            placeholder="https://jup.ag"
            defaultValue={initial?.origin ?? ""}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Start URL <span className="text-destructive">*</span>
          </span>
          <Input
            name="startUrl"
            type="url"
            required
            placeholder="https://jup.ag"
            defaultValue={initial?.startUrl ?? ""}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Display Order</span>
          <Input
            name="displayOrder"
            type="number"
            inputMode="numeric"
            defaultValue={String(initial?.displayOrder ?? 0)}
          />
        </label>
        <label className="col-span-2 flex items-center gap-2">
          <Switch name="isActive" defaultChecked={initial?.isActive ?? true} />
          <span className="text-xs font-medium">Active</span>
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : initial ? "Save" : "Add dApp"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function DappList({ dapps }: { dapps: DappRow[] }) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [seedPending, startSeedTransition] = useTransition();

  function handleAdd(fd: FormData) {
    return addTrustedDapp(fd).then((result) => {
      if (result.success) {
        setIsAdding(false);
        router.refresh();
      }
      return result;
    });
  }

  function handleUpdate(id: string) {
    return (fd: FormData) =>
      updateTrustedDapp(id, fd).then((result) => {
        if (result.success) {
          setEditingId(null);
          router.refresh();
        }
        return result;
      });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteTrustedDapp(id);
      setDeletingId(null);
      router.refresh();
    });
  }

  function handleToggle(id: string, next: boolean) {
    startTransition(async () => {
      await toggleTrustedDappActive(id, next);
      router.refresh();
    });
  }

  function handleSeed() {
    setSeedStatus(null);
    startSeedTransition(async () => {
      const result = await seedAllowlist();
      if (result.error) {
        setSeedStatus(`Error: ${result.error}`);
        return;
      }
      setSeedStatus(
        `Inserted ${result.inserted} · backfilled ${result.backfilled} · skipped ${result.skipped}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {isAdding && (
        <DappForm onSubmit={handleAdd} onCancel={() => setIsAdding(false)} />
      )}

      {editingId && (
        <DappForm
          initial={dapps.find((d) => d.id === editingId)}
          onSubmit={handleUpdate(editingId)}
          onCancel={() => setEditingId(null)}
        />
      )}

      {dapps.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Order</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>Start URL</TableHead>
                <TableHead className="w-[80px]">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dapps.map((dapp) => (
                <TableRow key={dapp.id}>
                  <TableCell className="text-muted-foreground">
                    {dapp.displayOrder}
                  </TableCell>
                  <TableCell className="font-medium">{dapp.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {dapp.category ?? (
                      <span className="italic">Uncategorized</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dapp.origin}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate text-muted-foreground">
                    {dapp.startUrl}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={dapp.isActive}
                      onCheckedChange={(next) => handleToggle(dapp.id, next)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setEditingId(dapp.id);
                          setIsAdding(false);
                        }}
                      >
                        Edit
                      </Button>
                      {deletingId === dapp.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="xs"
                            onClick={() => handleDelete(dapp.id)}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setDeletingId(null)}
                          >
                            No
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeletingId(dapp.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : !isAdding ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
          No dApps configured
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!isAdding && (
          <Button
            size="sm"
            onClick={() => {
              setIsAdding(true);
              setEditingId(null);
            }}
          >
            Add dApp
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleSeed}
          disabled={seedPending}
        >
          {seedPending ? "Seeding..." : "Seed from allowlist v0.1"}
        </Button>
        {seedStatus && (
          <span className="text-xs text-muted-foreground">{seedStatus}</span>
        )}
      </div>
    </div>
  );
}
