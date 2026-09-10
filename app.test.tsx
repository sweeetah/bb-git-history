// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import {
  loadPluginApp,
  renderSlot,
  type CapturedPluginApp,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import type { CommitDetails, HistoryPage } from "./contracts";
import type { rpcContract } from "./server";

const hash = "1234567890abcdef1234567890abcdef12345678";
const parentHash = "abcdef1234567890abcdef1234567890abcdef12";
const historyPage: HistoryPage = {
  repoName: "example-repo",
  currentBranch: "main",
  uncommittedFiles: [],
  commits: [
    {
      hash,
      parents: [parentHash, "fedcba0987654321fedcba0987654321fedcba09"],
      authorName: "History Test",
      authorEmail: "history@example.com",
      authorDate: "2026-01-02T03:04:05Z",
      committerDate: "2026-01-02T03:04:05Z",
      subject: "feat: render commit details",
      refs: [
        {
          fullName: "refs/heads/main",
          name: "main",
          kind: "local",
          isHead: true,
        },
      ],
    },
  ],
  offset: 0,
  total: 1,
  hasMore: false,
  revision: "revision-1",
  unavailableReason: null,
};

const commitDetails: CommitDetails = {
  ...historyPage.commits[0]!,
  body: "A longer explanation of the change.\n\nWith a second paragraph.",
  files: [
    {
      path: "src/example.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
    },
  ],
};

function rpcHandlers() {
  return {
    repositories: async () => ({ repositories: [], unavailableReason: null }),
    history: async () => historyPage,
    historyRevision: async () => ({ revision: "revision-1", unavailableReason: null }),
    details: async () => commitDetails,
    patch: async () => ({
      path: "src/example.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      truncated: false,
    }),
    workingPatch: async ({ path }: { path: string }) => ({
      path,
      patch: "",
      truncated: false,
    }),
  };
}

let app: CapturedPluginApp;

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 600,
  });
  app = await loadPluginApp(() => import("./app"));
});

describe("Git history app", () => {
  it("registers the history panel and opt-in header action", () => {
    expect(app.threadPanelActions.map((action) => action.id)).toEqual(["history"]);
    expect(app.threadHeaderActions.map((action) => action.id)).toEqual(["git-history"]);

    const header = renderSlot(
      app.threadHeaderActions[0]!,
      { threadId: "thread-1", projectId: "project-1", isCompactViewport: false },
      {
        settings: { showHeaderShortcut: true },
        openThreadPanel: () => true,
      },
    );

    fireEvent.click(header.getByRole("button", { name: "Open Git history" }));
    expect(header.inspection.navigateCalls).toEqual([
      {
        method: "openThreadPanel",
        options: { actionId: "history", title: "Git History" },
      },
    ]);
    header.lifecycle.unmount();
  });

  it("renders default experimental lanes and expanded commit details", async () => {
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: rpcHandlers(),
      },
    );

    await panel.findByText("example-repo / main");
    const commitButton = await panel.findByRole("button", {
      name: /render commit details/,
    });
    expect(panel.container.querySelector(".git-graph-cell")).not.toBeNull();

    fireEvent.click(commitButton);
    await panel.findByText("A longer explanation of the change.", { exact: false });
    expect(panel.getByTitle(hash).textContent).toBe(hash);
    expect(panel.container.querySelector(".git-expansion-graph")).not.toBeNull();
    expect(panel.inspection.rpcCalls).toContainEqual({
      method: "details",
      input: { threadId: "thread-1", hash },
    });
    panel.lifecycle.unmount();
  });
});
