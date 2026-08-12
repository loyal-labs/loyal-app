"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { addAdmin, deleteAdmin, updateAdmin } from "./actions";

type AdminRow = {
  id: string;
  telegramId: string;
  username: string | null;
  displayName: string;
  addedAt: string;
  addedBy: string | null;
  notes: string | null;
};

function AdminForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: AdminRow;
  onSubmit: (fd: FormData) => Promise<{ error?: string; success?: boolean }>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await onSubmit(fd);
      if (result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4">
      {error && (
        <div className="mb-3 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Telegram ID <span className="text-destructive">*</span>
          </span>
          <Input
            name="telegramId"
            type="text"
            inputMode="numeric"
            pattern="[0-9]+"
            required
            defaultValue={initial?.telegramId ?? ""}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Display Name <span className="text-destructive">*</span>
          </span>
          <Input
            name="displayName"
            type="text"
            required
            defaultValue={initial?.displayName ?? ""}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Username</span>
          <Input
            name="username"
            type="text"
            defaultValue={initial?.username ?? ""}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Added By</span>
          <Input
            name="addedBy"
            type="text"
            defaultValue={initial?.addedBy ?? ""}
          />
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-medium">Notes</span>
          <Input
            name="notes"
            type="text"
            defaultValue={initial?.notes ?? ""}
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : initial ? "Save" : "Add Admin"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AdminList({ admins }: { admins: AdminRow[] }) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleAdd(fd: FormData) {
    return addAdmin(fd).then((result) => {
      if (result.success) {
        setIsAdding(false);
        router.refresh();
      }
      return result;
    });
  }

  function handleUpdate(id: string) {
    return (fd: FormData) =>
      updateAdmin(id, fd).then((result) => {
        if (result.success) {
          setEditingId(null);
          router.refresh();
        }
        return result;
      });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteAdmin(id);
      setDeletingId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {isAdding && (
        <AdminForm onSubmit={handleAdd} onCancel={() => setIsAdding(false)} />
      )}

      {editingId && (
        <AdminForm
          initial={admins.find((a) => a.id === editingId)}
          onSubmit={handleUpdate(editingId)}
          onCancel={() => setEditingId(null)}
        />
      )}

      {admins.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Telegram ID</TableHead>
                <TableHead>Added By</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((admin) => (
                <TableRow key={admin.id}>
                  <TableCell className="font-medium">
                    {admin.displayName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {admin.username ? `@${admin.username}` : "—"}
                  </TableCell>
                  <TableCell>{String(admin.telegramId)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {admin.addedBy ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(admin.addedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setEditingId(admin.id);
                          setIsAdding(false);
                        }}
                      >
                        Edit
                      </Button>
                      {deletingId === admin.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="xs"
                            onClick={() => handleDelete(admin.id)}
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
                          onClick={() => setDeletingId(admin.id)}
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
          No admins found
        </div>
      ) : null}

      {!isAdding && (
        <Button
          size="sm"
          onClick={() => {
            setIsAdding(true);
            setEditingId(null);
          }}
        >
          Add Admin
        </Button>
      )}
    </div>
  );
}
