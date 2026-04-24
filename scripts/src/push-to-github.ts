// One-shot uploader: pushes all git-tracked files to GitHub via the
// Git Data API (no `git push` needed). Reads creds from env.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const username = process.env["GITHUB_USERNAME"];
const token = process.env["GITHUB_TOKEN"];
const repo = process.env["GITHUB_REPO"] ?? "tedauuu-ai";
const branch = process.env["GITHUB_BRANCH"] ?? "main";

if (!username || !token) {
  console.error("Missing GITHUB_USERNAME or GITHUB_TOKEN env var");
  process.exit(1);
}

const apiBase = `https://api.github.com/repos/${username}/${repo}`;

const headers: Record<string, string> = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "tedauuu-uploader",
};

async function gh(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const res = await fetch(`${apiBase}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok && res.status !== 404 && res.status !== 409 && res.status !== 422) {
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path} ${res.status}: ${text}`);
  }
  if (res.status >= 400) {
    console.log(`  [${res.status}] ${init?.method ?? "GET"} ${path} -> ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  process.chdir(repoRoot);

  // Seed empty repo with an initial commit so the Git Data API works.
  // The Contents API (PUT /contents/{path}) auto-creates the initial commit.
  const probe = (await gh("/git/ref/heads/" + branch)) as { status: number };
  if (probe.status === 409 || probe.status === 404) {
    console.log("Seeding empty repo with initial README commit...");
    await gh("/contents/.gh-init", {
      method: "PUT",
      body: {
        message: "Initial commit",
        content: Buffer.from("init\n").toString("base64"),
        branch,
      },
    });
  }

  const files = execSync("git ls-files", { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Uploading ${files.length} files to ${username}/${repo}#${branch}...`);

  // 1. Create blobs for each file
  const treeEntries: { path: string; mode: string; type: string; sha: string }[] = [];
  let i = 0;
  for (const file of files) {
    i++;
    const content = readFileSync(file);
    const blobRes = (await gh("/git/blobs", {
      method: "POST",
      body: {
        content: content.toString("base64"),
        encoding: "base64",
      },
    })) as { status: number; body: { sha: string } };
    treeEntries.push({
      path: file,
      mode: "100644",
      type: "blob",
      sha: blobRes.body.sha,
    });
    if (i % 20 === 0 || i === files.length) {
      console.log(`  blobs: ${i}/${files.length}`);
    }
  }

  // 2. Create the tree
  console.log("Creating tree...");
  const treeRes = (await gh("/git/trees", {
    method: "POST",
    body: { tree: treeEntries },
  })) as { status: number; body: { sha: string } };
  console.log("  tree sha:", treeRes.body.sha);

  // 3. Look up existing branch HEAD if any
  const refRes = (await gh(`/git/ref/heads/${branch}`)) as {
    status: number;
    body: { object?: { sha: string } } | null;
  };
  const parentSha =
    refRes.status === 200 && refRes.body?.object?.sha
      ? refRes.body.object.sha
      : undefined;

  // 4. Create commit
  console.log("Creating commit...");
  const commitRes = (await gh("/git/commits", {
    method: "POST",
    body: {
      message: "Deploy: Tedauuu AI WhatsApp chatbot",
      tree: treeRes.body.sha,
      parents: parentSha ? [parentSha] : [],
      author: {
        name: username,
        email: `${username}@users.noreply.github.com`,
        date: new Date().toISOString(),
      },
    },
  })) as { status: number; body: { sha: string; html_url: string } };
  console.log("  commit:", commitRes.body.html_url);

  // 5. Create or update the ref
  if (parentSha) {
    console.log("Updating branch...");
    await gh(`/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: { sha: commitRes.body.sha, force: false },
    });
  } else {
    console.log("Creating branch...");
    await gh("/git/refs", {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: commitRes.body.sha },
    });
  }

  console.log(`\n✅ Done! https://github.com/${username}/${repo}/tree/${branch}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
