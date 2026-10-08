/**
 * Marks everything under /ru as Russian. Only the root layout owns <html>, and
 * its lang stays "en", so the language is declared on this wrapper instead.
 */
export default function RuLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div lang="ru">{children}</div>;
}
