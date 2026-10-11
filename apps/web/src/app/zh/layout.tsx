/**
 * Marks everything under /zh as Simplified Chinese. Only the root layout owns
 * <html>, and its lang stays "en", so the language is declared on this wrapper
 * instead.
 */
export default function ZhLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div lang="zh-Hans">{children}</div>;
}
