import { SummariesProvider } from "@/components/summaries/SummariesContext";

export default function SummariesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SummariesProvider>{children}</SummariesProvider>;
}
