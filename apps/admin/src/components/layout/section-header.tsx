import * as React from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

type SectionBreadcrumb = {
  label: string;
  href?: string;
};

type SectionHeaderProps = React.ComponentProps<"header"> & {
  title: string;
  breadcrumbs: SectionBreadcrumb[];
  subtitle?: React.ReactNode;
};

export function SectionHeader({
  title,
  breadcrumbs,
  subtitle,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <header className={cn("mb-5 space-y-1.5", className)} {...props}>
      {breadcrumbs.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              const canLink = Boolean(crumb.href) && !isLast;

              return (
                <React.Fragment key={`${crumb.label}-${index}`}>
                  <BreadcrumbItem>
                    {canLink ? (
                      <BreadcrumbLink
                        href={crumb.href!}
                        className="inline-block max-w-[14rem] truncate align-bottom md:max-w-[20rem]"
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="inline-block max-w-[14rem] truncate align-bottom md:max-w-[28rem]">
                        {crumb.label}
                      </BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {!isLast ? <BreadcrumbSeparator /> : null}
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}

      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
    </header>
  );
}
