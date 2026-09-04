import * as React from "react";

import { cn } from "@/lib/utils";

type PageContainerProps = React.ComponentProps<"main">;

export function PageContainer({ className, ...props }: PageContainerProps) {
  return <main className={cn("mx-auto w-full max-w-5xl px-6 py-10", className)} {...props} />;
}
