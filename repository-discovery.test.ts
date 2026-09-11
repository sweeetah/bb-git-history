import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverRepositories,
  resolveRepositorySelection,
  type GitRunner,
} from "./repository-discovery";

const temporaryRoots: string[] = [];

const runGit: GitRunner = (cwd, args, signal) =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8", signal }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bb-git-history-discovery-"));
  temporaryRoots.push(root);
  return root;
}

async function createRepository(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await runGit(path, ["init", "--quiet", "--initial-branch", "main"], new AbortController().signal);
}

function runGitWithCandidateSwapOnSecondValidation(
  candidate: string,
  outside: string,
): GitRunner {
  let candidateValidations = 0;
  return async (cwd, args, signal) => {
    if (cwd === candidate && args.join(" ") === "rev-parse --show-toplevel") {
      candidateValidations += 1;
      if (candidateValidations === 2) {
        await rm(candidate, { recursive: true, force: true });
        await symlink(outside, candidate);
      }
    }

    return runGit(cwd, args, signal);
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("discoverRepositories", () => {
  it("returns a root worktree alone without scanning repos children", async () => {
    const root = await createRoot();
    await createRepository(root);
    await createRepository(join(root, "repos", "ignored-child"));

    const result = await discoverRepositories(root, new AbortController().signal, runGit);

    expect(result).toEqual([{
      key: ".",
      name: basename(root),
      currentBranch: "main",
      dirtyCount: 1,
    }]);
    await expect(
      resolveRepositorySelection(root, undefined, new AbortController().signal, runGit),
    ).resolves.toBe(await realpath(root));
  });

  it("discovers only immediate canonical repositories in stable key order", async () => {
    const root = await createRoot();
    const web = join(root, "repos", "web");
    const api = join(root, "repos", "api");
    const outside = await createRoot();
    await createRepository(web);
    await createRepository(api);
    await writeFile(join(web, "working.txt"), "uncommitted\n");
    await mkdir(join(root, "repos", "plain"), { recursive: true });
    await createRepository(join(root, "repos", "group", "nested"));
    await createRepository(outside);
    await symlink(outside, join(root, "repos", "escaped"));

    const result = await discoverRepositories(root, new AbortController().signal, runGit);

    expect(result).toEqual([
      { key: "repos/api", name: "api", currentBranch: "main", dirtyCount: 0 },
      { key: "repos/web", name: "web", currentBranch: "main", dirtyCount: 1 },
    ]);
  });

  it("rejects inward symlinks whose canonical repositories are not immediate repos children", async () => {
    const root = await createRoot();
    const hiddenRepository = join(root, "hidden-repo");
    const nestedRepository = join(root, "repos", "group", "nested");
    await createRepository(hiddenRepository);
    await createRepository(nestedRepository);
    await symlink(hiddenRepository, join(root, "repos", "hidden-alias"));
    await symlink(nestedRepository, join(root, "repos", "nested-alias"));

    const result = await discoverRepositories(root, new AbortController().signal, runGit);

    expect(result).toEqual([]);
  });
});

describe("resolveRepositorySelection", () => {
  it("accepts an exact discovered key and returns its canonical path", async () => {
    const root = await createRoot();
    const api = join(root, "repos", "api");
    const web = join(root, "repos", "web");
    await createRepository(api);
    await createRepository(web);

    await expect(
      resolveRepositorySelection(root, "repos/web", new AbortController().signal, runGit),
    ).resolves.toBe(await realpath(web));
  });

  it("rejects traversal, absolute, missing, and ambiguous selections", async () => {
    const root = await createRoot();
    const api = join(root, "repos", "api");
    const outside = await createRoot();
    await createRepository(api);
    await createRepository(join(root, "repos", "web"));

    const signal = new AbortController().signal;
    await expect(resolveRepositorySelection(root, "../outside", signal, runGit)).rejects.toThrow(
      /repository selection/i,
    );
    await expect(resolveRepositorySelection(root, outside, signal, runGit)).rejects.toThrow(
      /repository selection/i,
    );
    await expect(resolveRepositorySelection(root, "repos/missing", signal, runGit)).rejects.toThrow(
      /repository selection/i,
    );
    await expect(resolveRepositorySelection(root, undefined, signal, runGit)).rejects.toThrow(
      /repository selection/i,
    );
  });

  it("uses the only discovered repository when no key is supplied", async () => {
    const root = await createRoot();
    const api = join(root, "repos", "api");
    await createRepository(api);

    await expect(
      resolveRepositorySelection(root, undefined, new AbortController().signal, runGit),
    ).resolves.toBe(await realpath(api));
  });

  it("rejects an explicit selection whose final path escapes after discovery", async () => {
    const root = await createRoot();
    const api = join(root, "repos", "api");
    const outside = await createRoot();
    await createRepository(api);
    await createRepository(outside);
    const swappingRun = runGitWithCandidateSwapOnSecondValidation(await realpath(api), outside);

    await expect(
      resolveRepositorySelection(root, "repos/api", new AbortController().signal, swappingRun),
    ).rejects.toThrow(/repository selection/i);
    expect(await realpath(api)).toBe(await realpath(outside));
  });

  it("rejects an implicit selection whose final path escapes after discovery", async () => {
    const root = await createRoot();
    const api = join(root, "repos", "api");
    const outside = await createRoot();
    await createRepository(api);
    await createRepository(outside);
    const swappingRun = runGitWithCandidateSwapOnSecondValidation(await realpath(api), outside);

    await expect(
      resolveRepositorySelection(root, undefined, new AbortController().signal, swappingRun),
    ).rejects.toThrow(/repository selection/i);
    expect(await realpath(api)).toBe(await realpath(outside));
  });
});
