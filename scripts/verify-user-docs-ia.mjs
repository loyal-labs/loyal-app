import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const repoRoot = process.cwd();
const docsDir = resolve(repoRoot, args.get("--docs-dir") ?? "user-docs");
const planPath = resolve(
  repoRoot,
  args.get("--plan") ?? "docs/user-docs-information-architecture-plan.md"
);
const baselinePath = resolve(
  repoRoot,
  args.get("--baseline") ?? "docs/user-docs-baseline.json"
);

const failures = [];
const pass = (message) => process.stdout.write(`PASS ${message}\n`);
const fail = (message) => failures.push(message);

const docsJson = JSON.parse(readFileSync(join(docsDir, "docs.json"), "utf8"));
const plan = readFileSync(planPath, "utf8");
const navigationMatch = plan.match(/```json\n([\s\S]*?)\n```/);
if (!navigationMatch) {
  throw new Error("The plan does not contain an exhaustive JSON navigation block");
}
const plannedNavigation = JSON.parse(navigationMatch[1]).navigation;

if (JSON.stringify(docsJson.navigation) === JSON.stringify(plannedNavigation)) {
  pass("navigation matches the approved plan");
} else {
  fail("docs.json navigation differs from the approved plan");
}

const pageTargets = new Set();
const visitNavigation = (value) => {
  if (Array.isArray(value)) {
    value.forEach(visitNavigation);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.root === "string") pageTargets.add(value.root);
  if (Array.isArray(value.pages)) {
    for (const page of value.pages) {
      if (typeof page === "string") pageTargets.add(page);
      else visitNavigation(page);
    }
  }
  for (const child of Object.values(value)) {
    if (child !== value.pages) visitNavigation(child);
  }
};
visitNavigation(docsJson.navigation);

for (const target of pageTargets) {
  const mdx = join(docsDir, `${target}.mdx`);
  const markdown = join(docsDir, `${target}.md`);
  if (!existsSync(mdx) && !existsSync(markdown)) {
    fail(`missing navigation target: ${target}`);
  }
}
if (!failures.some((message) => message.startsWith("missing navigation"))) {
  pass(`${pageTargets.size} navigation targets exist`);
}

const targetRoute = (target) => (target === "index" ? "/" : `/${target}`);
const activeRoutes = new Set([...pageTargets].map(targetRoute));
const redirects = docsJson.redirects ?? [];
for (const redirect of redirects) {
  if (activeRoutes.has(redirect.source)) {
    fail(`redirect source is also active: ${redirect.source}`);
  }
}
if (!failures.some((message) => message.startsWith("redirect source"))) {
  pass("redirect sources do not conflict with active pages");
}

const expectedRedirects = new Map([
  ["/automations/thesis", "/"],
  ["/business/noncustodial-account-model", "/trust/ownership-and-control"],
  ["/business/economics", "/business/economics-and-responsibilities"],
  ["/business/neobank-example", "/business/use-cases#neobank"],
  ["/business/payment-processor-example", "/business/use-cases#payment-processor"],
  ["/trust/risk-and-transparency", "/trust/risk-and-liquidity"],
  ["/earn/overview", "/earn/smart-account"],
  ["/earn/safety-and-faq", "/earn/trust-model"],
  ["/Introduction", "/"],
  ["/Introduction/howitworks", "/sdk/private-transactions/how-it-works"],
  ["/Introduction/solution", "/"],
  ["/Introduction/usecases", "/business/use-cases"],
  ["/Introduction/vision", "/"],
  ["/architecture/network", "/build/system-architecture"],
  ["/architecture/payments", "/build/system-architecture"],
  ["/architecture/privacy", "/sdk/private-transactions/how-it-works"],
  ["/quickstart", "/build/first-automation"],
  ["/surveillance-crisis", "/"],
  ["/launch/MetaDAO", "/launch/token"],
  ["/launch/Futarchy", "/launch/token"],
  ["/loyal_manifesto", "/"],
]);
const actualRedirects = new Map(
  redirects.map(({ source, destination }) => [source, destination])
);
if (JSON.stringify([...actualRedirects]) === JSON.stringify([...expectedRedirects])) {
  pass("redirect map matches the approved disposition");
} else {
  fail("redirect map differs from the approved disposition");
}

const publicSources = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath);
    else if ([".md", ".mdx"].includes(extname(entry.name))) {
      publicSources.push(entryPath);
    }
  }
};
walk(docsDir);

const allowedUnlisted = new Set(["README.md"]);
for (const source of publicSources) {
  const sourceRelative = relative(docsDir, source);
  const target = sourceRelative.replace(/\.(md|mdx)$/, "");
  if (!pageTargets.has(target) && !allowedUnlisted.has(sourceRelative)) {
    fail(`unlisted public source: ${sourceRelative}`);
  }
}
if (!failures.some((message) => message.startsWith("unlisted public"))) {
  pass("no unintended Markdown source remains public");
}

const legacyFiles = [
  "Introduction/index.mdx",
  "Introduction/howitworks.mdx",
  "Introduction/solution.mdx",
  "Introduction/usecases.mdx",
  "Introduction/vision.mdx",
  "architecture/network.mdx",
  "architecture/payments.mdx",
  "architecture/privacy.mdx",
  "quickstart.mdx",
  "surveillance-crisis.mdx",
  "launch/MetaDAO.mdx",
  "launch/Futarchy.mdx",
  "loyal_manifesto.md",
];
for (const legacyFile of legacyFiles) {
  if (existsSync(join(docsDir, legacyFile))) fail(`legacy source remains: ${legacyFile}`);
}
if (!failures.some((message) => message.startsWith("legacy source"))) {
  pass("legacy sources are removed");
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
for (const [file, expectedHash] of Object.entries(baseline.protectedFiles)) {
  const actualHash = createHash("sha256")
    .update(readFileSync(resolve(repoRoot, file)))
    .digest("hex");
  if (actualHash !== expectedHash) fail(`protected file changed: ${file}`);
}
if (!failures.some((message) => message.startsWith("protected file"))) {
  pass("protected Transparency content matches the baseline");
}

const nontechnicalTargets = [...pageTargets].filter(
  (target) =>
    target === "index" ||
    target.startsWith("automations/") ||
    target.startsWith("business/") ||
    target.startsWith("trust/")
);
for (const target of nontechnicalTargets) {
  const filePath = join(docsDir, `${target}.mdx`);
  const text = readFileSync(filePath, "utf8");
  if (/[—–]/u.test(text)) fail(`prohibited dash in nontechnical page: ${target}`);
}
if (!failures.some((message) => message.startsWith("prohibited dash"))) {
  pass("nontechnical pages contain no em dash or en dash");
}

if (activeRoutes.has("/README")) fail("README.md is active in navigation");
else pass("README.md remains repository-only");

if (failures.length > 0) {
  for (const message of failures) process.stderr.write(`FAIL ${message}\n`);
  process.exit(1);
}

process.stdout.write("PASS user docs information architecture\n");
