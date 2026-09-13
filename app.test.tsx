// @vitest-environment jsdom

import { fireEvent, waitFor } from "@testing-library/react";
import {
  loadPluginApp,
  renderSlot,
  type CapturedPluginApp,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CommitDetails, HistoryPage, RepositoryDescriptor } from "./contracts";
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
    repositories: async () => ({
      repositories: [{ key: "repos/api", name: "API" }],
      unavailableReason: null,
    }),
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

function historyFor(repositoryKey: string): HistoryPage {
  const name = repositoryKey === "repos/web" ? "Web" : "API";
  return {
    ...historyPage,
    repoName: name,
    commits: historyPage.commits.map((commit) => ({
      ...commit,
      subject: `${name} history`,
    })),
    uncommittedFiles: [
      {
        path: "src/working.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
      },
    ],
  };
}

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: resolve! };
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

beforeEach(() => {
  window.localStorage.clear();
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
      input: { threadId: "thread-1", repositoryKey: "repos/api", hash },
    });
    panel.lifecycle.unmount();
  });

  it("keeps the native repository selector hidden for one repository", async () => {
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      { settings: {}, rpc: rpcHandlers() },
    );

    await panel.findByText("example-repo / main");
    expect(panel.queryByLabelText("Repository")).toBeNull();
    expect(panel.inspection.rpcCalls).toContainEqual({
      method: "history",
      input: {
        threadId: "thread-1",
        repositoryKey: "repos/api",
        offset: 0,
        limit: 200,
      },
    });
    panel.lifecycle.unmount();
  });

  it("scopes history, details, and patches to the selected repository", async () => {
    const repositories: RepositoryDescriptor[] = [
      { key: "repos/api", name: "API", currentBranch: "main", dirtyCount: 0 },
      { key: "repos/web", name: "Web", currentBranch: "feature/ui", dirtyCount: 1 },
    ];
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => ({ repositories, unavailableReason: null }),
          history: async ({ repositoryKey }: { repositoryKey?: string }) =>
            historyFor(repositoryKey ?? "repos/api"),
          details: async () => ({
            ...commitDetails,
            subject: "Web history",
          }),
          patch: async () => ({
            path: "src/example.ts",
            patch: "",
            truncated: false,
          }),
        },
      },
    );

    const webRepository = await panel.findByRole("button", { name: "Show Web history" });
    expect(panel.getByText("feature/ui")).toBeTruthy();
    expect(panel.getByText("1 change")).toBeTruthy();
    fireEvent.click(webRepository);
    await panel.findByRole("button", { name: /^Web history/ });
    expect(panel.inspection.rpcCalls).toContainEqual({
      method: "history",
      input: {
        threadId: "thread-1",
        repositoryKey: "repos/web",
        offset: 0,
        limit: 200,
      },
    });

    fireEvent.click(panel.getByRole("button", { name: /^Web history/ }));
    await panel.findByText("A longer explanation of the change.", { exact: false });
    expect(panel.inspection.rpcCalls).toContainEqual({
      method: "details",
      input: { threadId: "thread-1", repositoryKey: "repos/web", hash },
    });

    fireEvent.click(panel.getByTitle("Open diff for src/example.ts"));
    await panel.findByText("No textual diff for this file.");
    expect(panel.inspection.rpcCalls).toContainEqual({
      method: "patch",
      input: {
        threadId: "thread-1",
        repositoryKey: "repos/web",
        hash,
        path: "src/example.ts",
      },
    });

    fireEvent.click(panel.getByRole("button", { name: "Back to Git history" }));
    fireEvent.click(panel.getByRole("button", { name: /Uncommitted/ }));
    fireEvent.click(panel.getByTitle("Open uncommitted diff for src/working.ts"));
    await panel.findByText("No textual diff for this file.");
    expect(panel.inspection.rpcCalls).toContainEqual({
      method: "workingPatch",
      input: {
        threadId: "thread-1",
        repositoryKey: "repos/web",
        path: "src/working.ts",
      },
    });
    panel.lifecycle.unmount();
  });

  it("remembers the selected repository for the thread", async () => {
    const repositories: RepositoryDescriptor[] = [
      { key: "repos/api", name: "API", currentBranch: "main", dirtyCount: 0 },
      { key: "repos/web", name: "Web", currentBranch: "feature/ui", dirtyCount: 0 },
    ];
    const options = {
      settings: {},
      rpc: {
        ...rpcHandlers(),
        repositories: async () => ({ repositories, unavailableReason: null }),
        history: async ({ repositoryKey }: { repositoryKey?: string }) =>
          historyFor(repositoryKey ?? "repos/api"),
      },
    };
    const firstPanel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "remembered-thread", params: null },
      options,
    );

    fireEvent.click(await firstPanel.findByRole("button", { name: "Show Web history" }));
    await firstPanel.findByRole("button", { name: /^Web history/ });
    firstPanel.lifecycle.unmount();

    const reopenedPanel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "remembered-thread", params: null },
      options,
    );
    await reopenedPanel.findByRole("button", { name: /^Web history/ });
    expect(reopenedPanel.getByRole("button", { name: "Show Web history" })
      .getAttribute("aria-pressed")).toBe("true");
    reopenedPanel.lifecycle.unmount();
  });

  it("filters a constrained repository list when the workspace is large", async () => {
    const repositories: RepositoryDescriptor[] = Array.from({ length: 12 }, (_, index) => ({
      key: `repos/service-${index}`,
      name: `service-${index}`,
      currentBranch: "main",
      dirtyCount: index,
    }));
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "large-thread", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => ({ repositories, unavailableReason: null }),
          history: async ({ repositoryKey }: { repositoryKey?: string }) =>
            historyFor(repositoryKey ?? repositories[0]!.key),
        },
      },
    );

    const search = await panel.findByRole("searchbox", { name: "Search repositories" });
    fireEvent.change(search, { target: { value: "service-11" } });
    expect(panel.getByRole("button", { name: "Show service-11 history" })).toBeTruthy();
    expect(panel.queryByRole("button", { name: "Show service-1 history" })).toBeNull();
    expect(panel.container.querySelector(".git-repository-list")).not.toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Collapse repositories" }));
    expect(panel.queryByRole("searchbox", { name: "Search repositories" })).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Expand repositories" }));
    expect(panel.getByRole("searchbox", { name: "Search repositories" })).toBeTruthy();
    panel.lifecycle.unmount();
  });

  it("keeps an active repository search clearable after the list shrinks", async () => {
    let repositories: RepositoryDescriptor[] = Array.from({ length: 9 }, (_, index) => ({
      key: `repos/service-${index}`,
      name: `service-${index}`,
      currentBranch: "main",
      dirtyCount: 0,
    }));
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "shrinking-thread", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => ({ repositories, unavailableReason: null }),
        },
      },
    );

    try {
      await panel.findByText("example-repo / main");
      fireEvent.change(panel.getByRole("searchbox", { name: "Search repositories" }), {
        target: { value: "service-8" },
      });
      repositories = repositories.slice(0, 8);
      fireEvent.click(panel.getByRole("button", { name: "Refresh Git history" }));
      await panel.findByText("No matching repositories.");

      fireEvent.change(panel.getByRole("searchbox", { name: "Search repositories" }), {
        target: { value: "" },
      });
      expect(panel.queryByRole("searchbox", { name: "Search repositories" })).toBeNull();
      for (const repository of repositories) {
        expect(panel.getByRole("button", { name: `Show ${repository.name} history` })).toBeTruthy();
      }
    } finally {
      panel.lifecycle.unmount();
    }
  });

  it("does not render a late previous-repository history response after switching", async () => {
    const apiHistory = deferred<HistoryPage>();
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => ({
            repositories: [
              { key: "repos/api", name: "API" },
              { key: "repos/web", name: "Web" },
            ],
            unavailableReason: null,
          }),
          history: async ({ repositoryKey }: { repositoryKey?: string }) =>
            repositoryKey === "repos/web"
              ? historyFor("repos/web")
              : apiHistory.promise,
        },
      },
    );

    fireEvent.click(await panel.findByRole("button", { name: "Show Web history" }));
    await panel.findByRole("button", { name: /^Web history/ });
    apiHistory.resolve(historyFor("repos/api"));
    await Promise.resolve();

    expect(panel.getByRole("button", { name: /^Web history/ })).toBeTruthy();
    expect(panel.queryByRole("button", { name: /^API history/ })).toBeNull();
    panel.lifecycle.unmount();
  });

  it("requires a new selection when the selected repository disappears on refresh", async () => {
    let discoveryCalls = 0;
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => {
            discoveryCalls += 1;
            return {
              repositories: discoveryCalls === 1
                ? [
                  { key: "repos/api", name: "API" },
                  { key: "repos/web", name: "Web" },
                ]
                : [{ key: "repos/api", name: "API" }],
              unavailableReason: null,
            };
          },
          history: async ({ repositoryKey }: { repositoryKey?: string }) =>
            historyFor(repositoryKey ?? "repos/api"),
        },
      },
    );

    fireEvent.click(await panel.findByRole("button", { name: "Show Web history" }));
    await panel.findByRole("button", { name: /^Web history/ });
    const historyCallsBeforeRefresh = panel.inspection.rpcCalls.filter((call) => call.method === "history");
    fireEvent.click(panel.getByRole("button", { name: "Refresh Git history" }));

    await panel.findByText("The selected repository is no longer available.");
    expect(panel.queryByRole("button", { name: /^Web history/ })).toBeNull();
    expect(panel.inspection.rpcCalls.filter((call) => call.method === "history"))
      .toHaveLength(historyCallsBeforeRefresh.length);
    fireEvent.click(panel.getByRole("button", { name: "Show API history" }));
    await panel.findByRole("button", { name: /^API history/ });
    panel.lifecycle.unmount();
  });

  it("completes an explicit refresh when an overlapping poll discovery supersedes it", async () => {
    const explicitDiscovery = deferred<{
      repositories: RepositoryDescriptor[];
      unavailableReason: null;
    }>();
    let repositoryCalls = 0;
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => {
            repositoryCalls += 1;
            if (repositoryCalls === 2) return explicitDiscovery.promise;
            return {
              repositories: [{ key: "repos/api", name: "API" }],
              unavailableReason: null,
            };
          },
        },
      },
    );

    await panel.findByText("example-repo / main");
    const historyCallsBeforeRefresh = panel.inspection.rpcCalls.filter((call) => call.method === "history");
    fireEvent.click(panel.getByRole("button", { name: "Refresh Git history" }));
    await waitFor(() => expect(repositoryCalls).toBe(2));

    document.dispatchEvent(new Event("visibilitychange"));
    expect(repositoryCalls).toBe(2);
    explicitDiscovery.resolve({
      repositories: [{ key: "repos/api", name: "API" }],
      unavailableReason: null,
    });

    await waitFor(() => {
      expect(panel.inspection.rpcCalls.filter((call) => call.method === "history"))
        .toHaveLength(historyCallsBeforeRefresh.length + 1);
    });
    panel.lifecycle.unmount();
  });

  it("keeps the selected repository mounted through a transient discovery failure and retries", async () => {
    let discoveryCalls = 0;
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => {
            discoveryCalls += 1;
            if (discoveryCalls === 2) throw new Error("temporary discovery outage");
            return {
              repositories: [{ key: "repos/api", name: "API" }],
              unavailableReason: null,
            };
          },
        },
      },
    );

    await panel.findByText("example-repo / main");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(discoveryCalls).toBe(2));
    expect(panel.getByText("example-repo / main")).toBeTruthy();

    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(discoveryCalls).toBe(3));
    expect(panel.getByText("example-repo / main")).toBeTruthy();
    panel.lifecycle.unmount();
  });

  it("rediscovers repositories when commit details report an unavailable selection", async () => {
    let discoveryCalls = 0;
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => ({
            repositories: discoveryCalls++ === 0 ? [{ key: "repos/api", name: "API" }] : [],
            unavailableReason: null,
          }),
          details: async () => {
            throw new Error("GIT_HISTORY_REPOSITORY_UNAVAILABLE: selected repository disappeared");
          },
        },
      },
    );

    const commitButton = await panel.findByRole("button", { name: /render commit details/ });
    fireEvent.click(commitButton);

    await panel.findByText("No Git repositories are available in this environment.");
    expect(discoveryCalls).toBe(2);
    panel.lifecycle.unmount();
  });

  it("rediscovers repositories when an open commit patch reports an unavailable selection", async () => {
    let discoveryCalls = 0;
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => ({
            repositories: discoveryCalls++ === 0 ? [{ key: "repos/api", name: "API" }] : [],
            unavailableReason: null,
          }),
          details: async () => commitDetails,
          patch: async () => {
            throw new Error("GIT_HISTORY_REPOSITORY_UNAVAILABLE: selected repository disappeared");
          },
        },
      },
    );

    const commitButton = await panel.findByRole("button", { name: /render commit details/ });
    fireEvent.click(commitButton);
    await panel.findByText("A longer explanation of the change.", { exact: false });
    fireEvent.click(panel.getByTitle("Open diff for src/example.ts"));

    await panel.findByText("No Git repositories are available in this environment.");
    expect(discoveryCalls).toBe(2);
    panel.lifecycle.unmount();
  });

  it("rediscovers repositories when an open working patch reports an unavailable selection", async () => {
    let discoveryCalls = 0;
    const panel = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      app.threadPanelActions[0]!,
      { threadId: "thread-1", params: null },
      {
        settings: {},
        rpc: {
          ...rpcHandlers(),
          repositories: async () => ({
            repositories: discoveryCalls++ === 0 ? [{ key: "repos/api", name: "API" }] : [],
            unavailableReason: null,
          }),
          history: async () => historyFor("repos/api"),
          workingPatch: async () => {
            throw new Error("GIT_HISTORY_REPOSITORY_UNAVAILABLE: selected repository disappeared");
          },
        },
      },
    );

    await panel.findByRole("button", { name: /^API history/ });
    fireEvent.click(panel.getByRole("button", { name: /Uncommitted/ }));
    fireEvent.click(panel.getByTitle("Open uncommitted diff for src/working.ts"));

    await panel.findByText("No Git repositories are available in this environment.");
    expect(discoveryCalls).toBe(2);
    panel.lifecycle.unmount();
  });
});
