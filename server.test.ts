import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import type { HistoryPage } from "./contracts";
import plugin from "./server";

describe("Git history server", () => {
  it("checks the host when cached environment metadata says non-Git", async () => {
    const thread = {
      ...makeThreadResponse({
        id: "thread-1",
        projectId: "project-1",
        environmentId: "environment-1",
      }),
      environment: {
        id: "environment-1",
        projectId: "project-1",
        hostId: "host-1",
        name: null,
        path: "/workspace/plain-folder",
        branchName: null,
        baseBranch: null,
        defaultBranch: null,
        mergeBaseBranch: null,
        isGitRepo: false,
        isWorktree: false,
        managed: false,
        status: "ready" as const,
        workspaceProvisionType: "unmanaged" as const,
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const historyPage: HistoryPage = {
      repoName: "late-init-repo",
      currentBranch: "main",
      uncommittedFiles: [],
      commits: [],
      offset: 0,
      total: 0,
      hasMore: false,
      revision: "abc123\0main\0",
      unavailableReason: null,
    };
    const { bb, harness } = createFakePluginHost({
      pluginId: "git-history",
      sdk: {
        threads: {
          get: async () => thread,
        },
      },
      experimental_callHostRpc: async ({ method }) => method === "workingPatch"
        ? { path: "README.md", patch: "@@ -1 +1,2 @@", truncated: false }
        : historyPage,
    });
    plugin(bb);

    expect(harness.registrations.settingsDescriptors.showHeaderShortcut).toEqual({
      type: "boolean",
      label: "Show thread header shortcut",
      description: "Show Git History beside the editor controls. Git History remains available from New tab.",
      default: false,
    });
    expect(harness.registrations.settingsDescriptors.experimentalCommitGraph).toEqual({
      type: "boolean",
      label: "Experimental commit graph",
      description: "Show branch and merge lanes in Git History.",
      default: true,
    });

    const result = (await harness.behavior.callRpc("history", {
      threadId: "thread-1",
      offset: 0,
      limit: 200,
    })) as HistoryPage;

    expect(result.repoName).toBe("late-init-repo");
    expect(result.currentBranch).toBe("main");
    expect(result.unavailableReason).toBeNull();
    expect(result.commits).toEqual([]);
    expect(harness.inspection.experimental_hostRpcCalls).toEqual([
      {
        method: "history",
        hostId: "host-1",
        input: {
          environmentPath: "/workspace/plain-folder",
          offset: 0,
          limit: 200,
        },
      },
    ]);

    const patch = await harness.behavior.callRpc("workingPatch", {
      threadId: "thread-1",
      path: "README.md",
    });

    expect(patch).toEqual({
      path: "README.md",
      patch: "@@ -1 +1,2 @@",
      truncated: false,
    });
    expect(harness.inspection.experimental_hostRpcCalls.at(-1)).toEqual({
      method: "workingPatch",
      hostId: "host-1",
      input: {
        environmentPath: "/workspace/plain-folder",
        path: "README.md",
      },
    });

    await harness.lifecycle.dispose();
  });
});
