import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";

import { createFeature, getFeaturesForMatrix } from "./actions";
import { FeatureMatrix } from "./feature-matrix";

export const dynamic = "force-dynamic";

export default async function FeaturesPage() {
  const features = await getFeaturesForMatrix();

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Features"
        breadcrumbs={[{ label: "Features" }]}
        subtitle="Create a feature once, then track its status across the admin matrix."
      />

      <form action={createFeature} className="rounded-2xl border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium">
              Title <span className="text-destructive">*</span>
            </span>
            <Input name="title" type="text" required placeholder="Feature title" />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium">
              Key <span className="text-destructive">*</span>
            </span>
            <Input name="key" type="text" required placeholder="feature_key" />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-medium">
              Description <span className="text-destructive">*</span>
            </span>
            <textarea
              name="description"
              required
              rows={3}
              placeholder="What the feature does and why it exists"
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium">Owner</span>
            <Input name="owner" type="text" placeholder="Team or person responsible" />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium">Notes</span>
            <Input name="notes" type="text" placeholder="Optional implementation notes" />
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <Button type="submit">Create feature</Button>
        </div>
      </form>

      <FeatureMatrix features={features} />
    </PageContainer>
  );
}
