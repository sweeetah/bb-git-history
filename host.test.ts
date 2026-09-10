import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "./host";

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

describe("Git history host entry", () => {
  let workspaceRoot = "";
  let repo = "";
  let apiRepo = "";
  let mergeHash = "";
  let checkpointHash = "";

  beforeAll(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "bb-git-history-test-"));
    repo = join(workspaceRoot, "repos", "web");
    apiRepo = join(workspaceRoot, "repos", "api");
    mkdirSync(repo, { recursive: true });
    mkdirSync(apiRepo, { recursive: true });
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.name", "History Test");
    git(repo, "config", "user.email", "history@example.com");

    writeFileSync(join(repo, "README.md"), "base\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-m", "base commit");
    const baseHash = git(repo, "rev-parse", "HEAD");

    git(repo, "checkout", "-b", "feature");
    writeFileSync(join(repo, "feature.txt"), "feature line\n");
    git(repo, "add", "feature.txt");
    git(repo, "commit", "-m", "feature commit");

    git(repo, "checkout", "main");
    writeFileSync(join(repo, "main.txt"), "main line\n");
    git(repo, "add", "main.txt");
    git(repo, "commit", "-m", "main commit");
    git(
      repo,
      "merge",
      "--no-ff",
      "feature",
      "-m",
      "merge feature",
      "-m",
      "Merge body details.",
    );
    mergeHash = git(repo, "rev-parse", "HEAD");
    git(repo, "tag", "v1.0.0");

    git(repo, "checkout", "-b", "side", baseHash);
    writeFileSync(join(repo, "side.txt"), "side line\n");
    git(repo, "add", "side.txt");
    git(repo, "commit", "-m", "side only");
    git(repo, "checkout", "main");

    git(repo, "checkout", "-b", "checkpoint");
    git(repo, "commit", "--allow-empty", "-m", "t3 checkpoint ref=refs/t3/checkpoints/test");
    checkpointHash = git(repo, "rev-parse", "HEAD");
    git(repo, "update-ref", "refs/t3/checkpoints/test", checkpointHash);
    git(repo, "update-ref", "refs/t3/checkpoints/shared", mergeHash);
    git(repo, "checkout", "main");
    git(repo, "branch", "-D", "checkpoint");

    git(apiRepo, "init", "-b", "main");
    git(apiRepo, "config", "user.name", "History Test");
    git(apiRepo, "config", "user.email", "history@example.com");
  });

  afterAll(() => {
    if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("discovers workspace repositories and routes history by repository key", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    const repositories = await harness.experimental_call("repositories", {
      environmentPath: workspaceRoot,
    });
    const history = await harness.experimental_call("history", {
      environmentPath: workspaceRoot,
      repositoryKey: "repos/web",
      offset: 0,
      limit: 20,
    });

    expect(repositories.repositories.map((repository) => repository.key)).toEqual([
      "repos/api",
      "repos/web",
    ]);
    expect(history.repoName).toBe("web");

    await harness.experimental_dispose();
  });

  it("rejects absolute repository keys at the host boundary", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);

    await expect(
      harness.experimental_call("history", {
        environmentPath: workspaceRoot,
        repositoryKey: repo,
        offset: 0,
        limit: 20,
      }),
    ).rejects.toThrow(/repository selection/i);

    await harness.experimental_dispose();
  });

  it("pages commits reachable from every ref", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    const first = await harness.experimental_call("history", {
      environmentPath: repo,
      offset: 0,
      limit: 2,
    });
    const all = await harness.experimental_call("history", {
      environmentPath: repo,
      offset: 0,
      limit: 20,
    });

    expect(first.commits).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(all.total).toBe(5);
    expect(all.currentBranch).toBe("main");
    expect(all.commits.map((commit) => commit.subject)).toContain("side only");
    expect(all.commits.map((commit) => commit.hash)).not.toContain(checkpointHash);
    expect(
      all.commits.find((commit) => commit.hash === mergeHash)?.refs.map((ref) => ref.name),
    ).toEqual(expect.arrayContaining(["main", "v1.0.0"]));
    expect(
      all.commits.find((commit) => commit.hash === mergeHash)?.refs.map((ref) => ref.fullName),
    ).not.toContain("refs/t3/checkpoints/shared");

    await harness.experimental_dispose();
  });

  it("loads first-parent file details and a patch", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    const details = await harness.experimental_call("details", {
      environmentPath: repo,
      hash: mergeHash,
    });
    const patch = await harness.experimental_call("patch", {
      environmentPath: repo,
      hash: mergeHash,
      path: "feature.txt",
    });

    expect(details.subject).toBe("merge feature");
    expect(details.body).toContain("Merge body details.");
    expect(details.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "feature.txt", status: "added" }),
      ]),
    );
    expect(patch.patch).toContain("feature line");
    expect(patch.truncated).toBe(false);

    await harness.experimental_dispose();
  });

  it("lists uncommitted files and loads their patches", async () => {
    writeFileSync(join(repo, "README.md"), "base\nworking tree line\n");
    writeFileSync(join(repo, "staged.txt"), "staged line\n");
    writeFileSync(join(repo, "untracked.txt"), "untracked line\n");
    git(repo, "add", "staged.txt");
    rmSync(join(repo, "main.txt"));

    const harness = experimental_createHostEntryHarness(hostEntry);
    const history = await harness.experimental_call("history", {
      environmentPath: repo,
      offset: 0,
      limit: 20,
    });
    const patch = await harness.experimental_call("workingPatch", {
      environmentPath: repo,
      path: "README.md",
    });
    const untrackedPatch = await harness.experimental_call("workingPatch", {
      environmentPath: repo,
      path: "untracked.txt",
    });

    expect(history.uncommittedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "README.md", status: "modified", additions: 1 }),
        expect.objectContaining({ path: "main.txt", status: "deleted" }),
        expect.objectContaining({ path: "staged.txt", status: "added", additions: 1 }),
        expect.objectContaining({
          path: "untracked.txt",
          status: "added",
          additions: null,
          deletions: null,
        }),
      ]),
    );
    expect(patch.patch).toContain("working tree line");
    expect(patch.truncated).toBe(false);
    expect(untrackedPatch.patch).toContain("+untracked line");
    expect(untrackedPatch.truncated).toBe(false);

    await harness.experimental_dispose();
  });

  it("returns a lightweight revision that changes with repeated working-tree edits", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    const clean = await harness.experimental_call("historyRevision", {
      environmentPath: repo,
    });

    writeFileSync(join(repo, "poll-refresh.txt"), "poll one\n");

    const dirty = await harness.experimental_call("historyRevision", {
      environmentPath: repo,
    });

    writeFileSync(join(repo, "poll-refresh.txt"), "poll two\n");

    const editedAgain = await harness.experimental_call("historyRevision", {
      environmentPath: repo,
    });

    expect(clean.revision).not.toBe(dirty.revision);
    expect(dirty.revision).not.toBe(editedAgain.revision);
    expect(clean.unavailableReason).toBeNull();
    expect(dirty.unavailableReason).toBeNull();
    expect(editedAgain.unavailableReason).toBeNull();

    await harness.experimental_dispose();
  });

  it("changes the revision when a non-HEAD ref changes", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    const before = await harness.experimental_call("historyRevision", {
      environmentPath: repo,
    });

    git(repo, "update-ref", "refs/remotes/origin/poll-refresh", checkpointHash);

    const after = await harness.experimental_call("historyRevision", {
      environmentPath: repo,
    });

    expect(before.revision).not.toBe(after.revision);
    expect(before.unavailableReason).toBeNull();
    expect(after.unavailableReason).toBeNull();

    await harness.experimental_dispose();
  });

  it("reports unmerged working-tree paths as conflicted", async () => {
    const conflictRepo = mkdtempSync(join(tmpdir(), "bb-git-history-conflict-test-"));
    try {
      git(conflictRepo, "init", "-b", "main");
      git(conflictRepo, "config", "user.name", "History Test");
      git(conflictRepo, "config", "user.email", "history@example.com");
      writeFileSync(join(conflictRepo, "conflict.txt"), "base\n");
      git(conflictRepo, "add", "conflict.txt");
      git(conflictRepo, "commit", "-m", "base");
      git(conflictRepo, "checkout", "-b", "other");
      writeFileSync(join(conflictRepo, "conflict.txt"), "other\n");
      git(conflictRepo, "commit", "-am", "other change");
      git(conflictRepo, "checkout", "main");
      writeFileSync(join(conflictRepo, "conflict.txt"), "main\n");
      git(conflictRepo, "commit", "-am", "main change");
      expect(() => git(conflictRepo, "merge", "other")).toThrow();

      const harness = experimental_createHostEntryHarness(hostEntry);
      const history = await harness.experimental_call("history", {
        environmentPath: conflictRepo,
        offset: 0,
        limit: 20,
      });

      expect(history.uncommittedFiles).toContainEqual(
        expect.objectContaining({ path: "conflict.txt", status: "conflicted" }),
      );
      await harness.experimental_dispose();
    } finally {
      rmSync(conflictRepo, { recursive: true, force: true });
    }
  });
});
