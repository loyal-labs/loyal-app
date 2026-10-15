const bundle = await Bun.build({
  entrypoints: [new URL("./journey-browser.tsx", import.meta.url).pathname],
  target: "browser",
  plugins: [
    {
      name: "controlled-wallet",
      setup(build) {
        build.onResolve(
          { filter: /^@privy-io\/react-auth(?:\/solana)?$/ },
          () => ({
            path: new URL("./privy.ts", import.meta.url).pathname,
          })
        );
        build.onResolve({ filter: /^@solana\/wallet-adapter-react$/ }, () => ({
          path: new URL("./swap-wallet.ts", import.meta.url).pathname,
        }));
      },
    },
  ],
  define: {
    "process.env.NEXT_PUBLIC_GIT_COMMIT_HASH": JSON.stringify("a".repeat(40)),
  },
});
if (!bundle.success) throw new Error("Journey fixture compilation failed");
const javascript = await bundle.outputs[0].text();
const standardBundle = await Bun.build({
  entrypoints: [new URL("./standard-browser.tsx", import.meta.url).pathname],
  target: "browser",
  plugins: [
    {
      name: "controlled-privy-only",
      setup(build) {
        build.onResolve(
          { filter: /^@privy-io\/react-auth(?:\/solana)?$/ },
          () => ({
            path: new URL("./standard-privy.tsx", import.meta.url).pathname,
          })
        );
      },
    },
  ],
  define: {
    "process.env": "{}",
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
});
if (!standardBundle.success) throw new Error(String(standardBundle.logs));
const standardJavascript = await standardBundle.outputs[0].text();
Bun.serve({
  hostname: "127.0.0.1",
  port: 4317,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/standard.js")
      return new Response(standardJavascript, {
        headers: { "content-type": "text/javascript" },
      });
    if (path === "/runtime.js")
      return new Response(javascript, {
        headers: { "content-type": "text/javascript" },
      });
    if (path === "/api/observability/events")
      return Response.json({ accepted: true }, { status: 202 });
    return new Response(
      `<!doctype html><title>Journey contract fixture</title><h1>Controlled journey fixture</h1><div id="auth"></div><script type="module" src="${
        path === "/standard" ? "/standard.js" : "/runtime.js"
      }"></script>`,
      { headers: { "content-type": "text/html" } }
    );
  },
});
