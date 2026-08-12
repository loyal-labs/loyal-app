"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

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
  addLibraryArticle,
  addLibrarySection,
  deleteLibraryArticle,
  deleteLibrarySection,
  toggleLibraryArticleActive,
  updateLibraryArticle,
  updateLibrarySection,
  uploadLibraryCover,
} from "./actions";

type SectionRow = {
  id: string;
  title: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type ArticleRow = {
  id: string;
  sectionId: string;
  title: string;
  coverImageUrl: string;
  contentMarkdown: string;
  readTime: string;
  excerpt: string | null;
  isFeatured: boolean;
  isActive: boolean;
  displayOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ActionResult = { error?: string; success?: boolean };

// ============================================================================
// Sections
// ============================================================================

function SectionForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: SectionRow;
  onSubmit: (fd: FormData) => Promise<ActionResult>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await onSubmit(fd);
      if (result.error) setError(result.error);
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
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-medium">
            Title <span className="text-destructive">*</span>
          </span>
          <Input
            name="title"
            required
            placeholder="App Updates"
            defaultValue={initial?.title ?? ""}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Display Order</span>
          <Input
            name="displayOrder"
            type="number"
            defaultValue={String(initial?.displayOrder ?? 0)}
          />
        </label>
        <label className="col-span-3 flex items-center gap-2">
          <Switch name="isActive" defaultChecked={initial?.isActive ?? true} />
          <span className="text-xs font-medium">Active</span>
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : initial ? "Save" : "Add section"}
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

function SectionsPanel({ sections }: { sections: SectionRow[] }) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleAdd(fd: FormData) {
    return addLibrarySection(fd).then((result) => {
      if (result.success) {
        setIsAdding(false);
        router.refresh();
      }
      return result;
    });
  }

  function handleUpdate(id: string) {
    return (fd: FormData) =>
      updateLibrarySection(id, fd).then((result) => {
        if (result.success) {
          setEditingId(null);
          router.refresh();
        }
        return result;
      });
  }

  function handleDelete(id: string) {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteLibrarySection(id);
      if (result.error) {
        setDeleteError(result.error);
      } else {
        setDeletingId(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sections</h2>
        {!isAdding && (
          <Button
            size="sm"
            onClick={() => {
              setIsAdding(true);
              setEditingId(null);
            }}
          >
            Add section
          </Button>
        )}
      </div>

      {isAdding && (
        <SectionForm onSubmit={handleAdd} onCancel={() => setIsAdding(false)} />
      )}

      {editingId && (
        <SectionForm
          initial={sections.find((s) => s.id === editingId)}
          onSubmit={handleUpdate(editingId)}
          onCancel={() => setEditingId(null)}
        />
      )}

      {deleteError && (
        <div className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </div>
      )}

      {sections.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Order</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-[80px]">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((section) => (
                <TableRow key={section.id}>
                  <TableCell className="text-muted-foreground">
                    {section.displayOrder}
                  </TableCell>
                  <TableCell className="font-medium">{section.title}</TableCell>
                  <TableCell>{section.isActive ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setEditingId(section.id);
                          setIsAdding(false);
                        }}
                      >
                        Edit
                      </Button>
                      {deletingId === section.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="xs"
                            onClick={() => handleDelete(section.id)}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              setDeletingId(null);
                              setDeleteError(null);
                            }}
                          >
                            No
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeletingId(section.id)}
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
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No sections configured
        </div>
      ) : null}
    </section>
  );
}

// ============================================================================
// Articles
// ============================================================================

function ArticleForm({
  sections,
  initial,
  onSubmit,
  onCancel,
}: {
  sections: SectionRow[];
  initial?: ArticleRow;
  onSubmit: (fd: FormData) => Promise<ActionResult>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [coverUrl, setCoverUrl] = useState(initial?.coverImageUrl ?? "");
  const [sectionId, setSectionId] = useState(
    initial?.sectionId ?? sections[0]?.id ?? ""
  );
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);

    const fd = new FormData();
    fd.set("file", file);
    const result = await uploadLibraryCover(fd);
    setUploading(false);

    if (result.error) {
      setError(result.error);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (result.url) {
      setCoverUrl(result.url);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!coverUrl) {
      setError("Cover image is required");
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set("coverImageUrl", coverUrl);
    fd.set("sectionId", sectionId);
    startTransition(async () => {
      const result = await onSubmit(fd);
      if (result.error) setError(result.error);
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
            Section <span className="text-destructive">*</span>
          </span>
          <Select
            value={sectionId}
            onValueChange={setSectionId}
            disabled={sections.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  sections.length === 0
                    ? "Create a section first"
                    : "Select section"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Title (admin label) <span className="text-destructive">*</span>
          </span>
          <Input
            name="title"
            required
            placeholder="Shielded transfers release"
            defaultValue={initial?.title ?? ""}
          />
        </label>
        <div className="col-span-2">
          <span className="mb-1 block text-xs font-medium">
            Cover image <span className="text-destructive">*</span>
          </span>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFile}
              disabled={uploading || pending}
              className="block text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
            />
            {uploading && (
              <span className="text-xs text-muted-foreground">Uploading...</span>
            )}
          </div>
          {coverUrl && (
            <div className="mt-2 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverUrl}
                alt="Cover preview"
                className="h-24 w-24 rounded-lg object-cover"
              />
              <div className="break-all text-xs text-muted-foreground">
                {coverUrl}
              </div>
            </div>
          )}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Read time <span className="text-destructive">*</span>
          </span>
          <Input
            name="readTime"
            required
            placeholder="4 min read"
            defaultValue={initial?.readTime ?? ""}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Display Order</span>
          <Input
            name="displayOrder"
            type="number"
            defaultValue={String(initial?.displayOrder ?? 0)}
          />
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-medium">Excerpt</span>
          <Input
            name="excerpt"
            placeholder="Short share preview text (optional)"
            defaultValue={initial?.excerpt ?? ""}
          />
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-medium">
            Content (Markdown) <span className="text-destructive">*</span>
          </span>
          <textarea
            name="contentMarkdown"
            required
            rows={14}
            placeholder={"# Heading\n\nWrite the body in markdown."}
            defaultValue={initial?.contentMarkdown ?? ""}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-xs"
          />
        </label>
        <label className="flex items-center gap-2">
          <Switch
            name="isFeatured"
            defaultChecked={initial?.isFeatured ?? false}
          />
          <span className="text-xs font-medium">Featured</span>
        </label>
        <label className="flex items-center gap-2">
          <Switch name="isActive" defaultChecked={initial?.isActive ?? true} />
          <span className="text-xs font-medium">Active</span>
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending || uploading}>
          {pending ? "Saving..." : initial ? "Save" : "Add article"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={pending || uploading}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ArticlesPanel({
  sections,
  articles,
}: {
  sections: SectionRow[];
  articles: ArticleRow[];
}) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sectionTitleById = new Map(sections.map((s) => [s.id, s.title]));

  function handleAdd(fd: FormData) {
    return addLibraryArticle(fd).then((result) => {
      if (result.success) {
        setIsAdding(false);
        router.refresh();
      }
      return result;
    });
  }

  function handleUpdate(id: string) {
    return (fd: FormData) =>
      updateLibraryArticle(id, fd).then((result) => {
        if (result.success) {
          setEditingId(null);
          router.refresh();
        }
        return result;
      });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteLibraryArticle(id);
      setDeletingId(null);
      router.refresh();
    });
  }

  function handleToggle(id: string, next: boolean) {
    startTransition(async () => {
      await toggleLibraryArticleActive(id, next);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Articles</h2>
        {!isAdding && (
          <Button
            size="sm"
            disabled={sections.length === 0}
            onClick={() => {
              setIsAdding(true);
              setEditingId(null);
            }}
          >
            Add article
          </Button>
        )}
      </div>

      {isAdding && (
        <ArticleForm
          sections={sections}
          onSubmit={handleAdd}
          onCancel={() => setIsAdding(false)}
        />
      )}

      {editingId && (
        <ArticleForm
          sections={sections}
          initial={articles.find((a) => a.id === editingId)}
          onSubmit={handleUpdate(editingId)}
          onCancel={() => setEditingId(null)}
        />
      )}

      {articles.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Cover</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Section</TableHead>
                <TableHead className="w-[80px]">Featured</TableHead>
                <TableHead className="w-[80px]">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.map((article) => (
                <TableRow key={article.id}>
                  <TableCell>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={article.coverImageUrl}
                      alt=""
                      className="h-12 w-12 rounded object-cover"
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {article.title}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sectionTitleById.get(article.sectionId) ?? "—"}
                  </TableCell>
                  <TableCell>{article.isFeatured ? "Yes" : "—"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={article.isActive}
                      onCheckedChange={(next) =>
                        handleToggle(article.id, next)
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setEditingId(article.id);
                          setIsAdding(false);
                        }}
                      >
                        Edit
                      </Button>
                      {deletingId === article.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="xs"
                            onClick={() => handleDelete(article.id)}
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
                          onClick={() => setDeletingId(article.id)}
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
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {sections.length === 0
            ? "Create a section before adding articles"
            : "No articles yet"}
        </div>
      ) : null}
    </section>
  );
}

// ============================================================================
// Root
// ============================================================================

export function LibraryList({
  sections,
  articles,
}: {
  sections: SectionRow[];
  articles: ArticleRow[];
}) {
  return (
    <div className="space-y-8">
      <SectionsPanel sections={sections} />
      <ArticlesPanel sections={sections} articles={articles} />
    </div>
  );
}
