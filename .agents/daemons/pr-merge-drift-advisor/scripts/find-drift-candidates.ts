import { spawnSync } from "node:child_process";

/**
 * Read-only discovery for the pr-merge-drift-advisor daemon.
 *
 * For every open, non-draft pull request it reports:
 *   - GitHub mergeability (mergeable / mergeStateStatus)
 *   - the merge-base between the PR head and its current base
 *   - the PR's own changed files (head vs merge-base)
 *   - the files changed on base since the merge-base (with attributing commits)
 *   - the overlap between those two file sets
 *   - a drift tier: 0 (ignore), 1 (early warning), 2 (conflicting)
 *
 * The daemon uses this as a candidate list; it does not mutate anything.
 *
 * Usage:
 *   bun .agents/daemons/pr-merge-drift-advisor/scripts/find-drift-candidates.ts \
 *     [--repo <owner/repo>] [--max-pages N] [--unknown-retries N] [--unknown-retry-delay-ms N]
 */

const USAGE =
  "Usage: bun .agents/daemons/pr-merge-drift-advisor/scripts/find-drift-candidates.ts [--repo <owner/repo>] [--max-pages N] [--unknown-retries N] [--unknown-retry-delay-ms N]";

const DEFAULT_MAX_PAGES = 25;
const DEFAULT_UNKNOWN_RETRIES = 2;
const DEFAULT_UNKNOWN_RETRY_DELAY_MS = 1500;
// GitHub's compare endpoint paginates files; cap the per-PR file scan.
const COMPARE_FILE_LIMIT = 300;

type Args = {
  owner: string;
  repo: string;
  maxPages: number;
  unknownRetries: number;
  unknownRetryDelayMs: number;
};

type PullRequest = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  mergeStateStatus: string; // CLEAN | DIRTY | BEHIND | BLOCKED | ...
};

type Attribution = {
  file: string;
  commits: { sha: string; author: string | null; pr: number | null; message: string }[];
};

type Candidate = {
  number: number;
  title: string;
  url: string;
  base: string;
  headOid: string;
  isCrossRepository: boolean;
  mergeable: string;
  mergeStateStatus: string;
  mergeBase: string | null;
  prFileCount: number;
  baseSinceMergeBaseFileCount: number;
  overlapFiles: string[];
  tier: 0 | 1 | 2;
  attributions: Attribution[];
  error?: string;
};

const PULLS_QUERY = `
query OpenPulls($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 100, after: $cursor, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft
        baseRefName headRefName headRefOid
        isCrossRepository mergeable mergeStateStatus
      }
    }
  }
}`;

function fail(message: string): never {
  throw new TypeError(message);
}

function gh(args: string[]): string {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) {
    fail(`gh ${args[0]} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    fail(stderr.length > 0 ? `gh ${args.join(" ")} failed: ${stderr}` : `gh ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function parseArgs(argv: string[]): Args {
  let repoRaw: string | null = null;
  let maxPages = DEFAULT_MAX_PAGES;
  let unknownRetries = DEFAULT_UNKNOWN_RETRIES;
  let unknownRetryDelayMs = DEFAULT_UNKNOWN_RETRY_DELAY_MS;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "-h" || token === "--help") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("-")) {
      fail(`Missing value for ${token}.\n${USAGE}`);
    }
    if (token === "--repo") {
      repoRaw = value;
    } else if (token === "--max-pages") {
      maxPages = Number(value);
    } else if (token === "--unknown-retries") {
      unknownRetries = Number(value);
    } else if (token === "--unknown-retry-delay-ms") {
      unknownRetryDelayMs = Number(value);
    } else {
      fail(`Unknown argument: ${token}\n${USAGE}`);
    }
    i += 1;
  }

  if (!Number.isInteger(maxPages) || maxPages <= 0) fail("--max-pages must be a positive integer.");
  if (!Number.isInteger(unknownRetries) || unknownRetries < 0) fail("--unknown-retries must be >= 0.");
  if (!Number.isInteger(unknownRetryDelayMs) || unknownRetryDelayMs < 0)
    fail("--unknown-retry-delay-ms must be >= 0.");

  if (!repoRaw) {
    repoRaw = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  }
  const [owner, repo, extra] = repoRaw.split("/");
  if (!owner || !repo || extra) fail(`Invalid --repo value: ${repoRaw}. Expected owner/repo.`);

  return { owner, repo, maxPages, unknownRetries, unknownRetryDelayMs };
}

function fetchOpenPulls(args: Args): PullRequest[] {
  const pulls: PullRequest[] = [];
  let cursor: string | null = null;
  for (let page = 0; ; page += 1) {
    if (page >= args.maxPages) {
      fail(`Open PR scan exceeded --max-pages=${args.maxPages}.`);
    }
    const ghArgs = [
      "api",
      "graphql",
      "-f",
      `query=${PULLS_QUERY}`,
      "-F",
      `owner=${args.owner}`,
      "-F",
      `repo=${args.repo}`,
    ];
    if (cursor) ghArgs.push("-F", `cursor=${cursor}`);

    const parsed = JSON.parse(gh(ghArgs)) as {
      errors?: unknown[];
      data?: { repository?: { pullRequests?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PullRequest[] } } };
    };
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      fail(`GitHub GraphQL errors: ${JSON.stringify(parsed.errors)}`);
    }
    const connection = parsed.data?.repository?.pullRequests;
    if (!connection) fail("GitHub response missing repository.pullRequests.");
    pulls.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
    if (!cursor) fail("hasNextPage=true without endCursor.");
  }
  return pulls;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOpenPullsWithRetry(args: Args): Promise<PullRequest[]> {
  let pulls = fetchOpenPulls(args);
  let attempts = 0;
  while (
    attempts < args.unknownRetries &&
    pulls.some((p) => !p.isDraft && p.mergeable === "UNKNOWN")
  ) {
    await sleep(args.unknownRetryDelayMs);
    pulls = fetchOpenPulls(args);
    attempts += 1;
  }
  return pulls;
}

/** GET /repos/{o}/{r}/compare/{base}...{head} (three-dot: head vs merge-base). */
function compare(args: Args, base: string, head: string): {
  mergeBaseSha: string | null;
  files: string[];
  commits: { sha: string; author: string | null; message: string }[];
} {
  const raw = gh([
    "api",
    `repos/${args.owner}/${args.repo}/compare/${base}...${head}?per_page=${COMPARE_FILE_LIMIT}`,
  ]);
  const parsed = JSON.parse(raw) as {
    merge_base_commit?: { sha?: string };
    files?: { filename: string }[];
    commits?: { sha: string; commit: { message: string }; author: { login: string } | null }[];
  };
  return {
    mergeBaseSha: parsed.merge_base_commit?.sha ?? null,
    files: (parsed.files ?? []).map((f) => f.filename),
    commits: (parsed.commits ?? []).map((c) => ({
      sha: c.sha,
      author: c.author?.login ?? null,
      message: c.commit.message.split("\n", 1)[0] ?? "",
    })),
  };
}

const PR_IN_MESSAGE = /\(#(\d+)\)/;

function attribute(
  overlapFiles: string[],
  baseFiles: string[],
  baseCommits: { sha: string; author: string | null; message: string }[],
): Attribution[] {
  // Coarse attribution: we know which files changed on base and which commits
  // landed on base since the merge-base, but the compare endpoint does not map
  // file -> commit. Attach the candidate base commits to each overlapping file
  // so the daemon can link them for coordination.
  const overlapSet = new Set(overlapFiles);
  if (overlapSet.size === 0) return [];
  const commits = baseCommits.map((c) => ({
    sha: c.sha.slice(0, 12),
    author: c.author,
    pr: PR_IN_MESSAGE.exec(c.message)?.[1] ? Number(PR_IN_MESSAGE.exec(c.message)?.[1]) : null,
    message: c.message,
  }));
  return overlapFiles
    .filter((f) => baseFiles.includes(f))
    .map((file) => ({ file, commits }));
}

function classify(pr: PullRequest, overlapCount: number, baseAhead: boolean): 0 | 1 | 2 {
  if (pr.mergeable === "CONFLICTING") return 2;
  if (baseAhead && overlapCount > 0) return 1;
  return 0;
}

function buildCandidate(args: Args, pr: PullRequest): Candidate {
  const head = pr.headRefOid;
  const base = pr.baseRefName;
  const baseline: Candidate = {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    base,
    headOid: head,
    isCrossRepository: pr.isCrossRepository,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    mergeBase: null,
    prFileCount: 0,
    baseSinceMergeBaseFileCount: 0,
    overlapFiles: [],
    tier: 0,
    attributions: [],
  };

  try {
    // PR diff (head vs merge-base) + the merge-base sha.
    const prCompare = compare(args, base, head);
    const mergeBase = prCompare.mergeBaseSha;
    if (!mergeBase) return { ...baseline, error: "no merge-base" };

    // What changed on base since the merge-base.
    const baseCompare = compare(args, mergeBase, base);
    const baseAhead = baseCompare.commits.length > 0;

    const prFiles = new Set(prCompare.files);
    const overlapFiles = baseCompare.files.filter((f) => prFiles.has(f));
    const tier = classify(pr, overlapFiles.length, baseAhead);

    return {
      ...baseline,
      mergeBase,
      prFileCount: prCompare.files.length,
      baseSinceMergeBaseFileCount: baseCompare.files.length,
      overlapFiles,
      tier,
      attributions: tier === 0 ? [] : attribute(overlapFiles, baseCompare.files, baseCompare.commits),
    };
  } catch (error) {
    return { ...baseline, error: error instanceof Error ? error.message : "compare failed" };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pulls = await fetchOpenPullsWithRetry(args);

  const nonDraft = pulls.filter((p) => !p.isDraft);
  const unknown = nonDraft.filter((p) => p.mergeable === "UNKNOWN");
  const evaluable = nonDraft.filter((p) => p.mergeable !== "UNKNOWN");

  const candidates = evaluable.map((pr) => buildCandidate(args, pr));
  const tier1 = candidates.filter((c) => c.tier === 1);
  const tier2 = candidates.filter((c) => c.tier === 2);

  process.stdout.write(
    `${JSON.stringify(
      {
        repo: `${args.owner}/${args.repo}`,
        collectedAt: new Date().toISOString(),
        scan: {
          openNonDraft: nonDraft.length,
          unknownMergeability: unknown.length,
          tier1Count: tier1.length,
          tier2Count: tier2.length,
        },
        unknownPullRequests: unknown.map((p) => ({ number: p.number, url: p.url })),
        // Tier-2 first: conflicting PRs are the priority payload.
        candidates: [...tier2, ...tier1],
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "drift scan failed"}\n`);
  process.exitCode = 1;
});
