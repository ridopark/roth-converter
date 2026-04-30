import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roth Converter",
  description: "How much should I convert from Traditional to Roth this year?",
};

// Browser extensions (Dark Reader, Grammarly, etc.) routinely mutate <html>/<body>
// attributes before React hydrates, causing benign hydration mismatch warnings.
// suppressHydrationWarning is scoped to these root tags only.
const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
