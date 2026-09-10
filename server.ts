import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract } from "./contracts";

export { rpcContract } from "./contracts";

interface RepositoryTarget {
  hostId: string;
  environmentPath: string;
}

class RepositoryUnavailableError extends Error {}

async function repositoryForThread(
  bb: BbPluginApi,
  threadId: string,
): Promise<RepositoryTarget> {
  const thread = await bb.sdk.threads.get({
    threadId,
    include: "environment",
  });

  if (!("environment" in thread) || !thread.environment) {
    throw new RepositoryUnavailableError("This thread has no active project environment.");
  }

  const environment = thread.environment;
  if (!environment.path) {
    throw new RepositoryUnavailableError("The thread environment has no workspace path yet.");
  }
  if (environment.status !== "ready") {
    throw new RepositoryUnavailableError(`The thread environment is ${environment.status}.`);
  }

  return {
    hostId: environment.hostId,
    environmentPath: environment.path,
  };
}

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  bb.settings.define({
    showHeaderShortcut: {
      type: "boolean",
      label: "Show thread header shortcut",
      description: "Show Git History beside the editor controls. Git History remains available from New tab.",
      default: false,
    },
    experimentalCommitGraph: {
      type: "boolean",
      label: "Experimental commit graph",
      description: "Show branch and merge lanes in Git History.",
      default: true,
    },
  });

  bb.rpc.register(rpcContract, {
    async history({ threadId, offset, limit }) {
      try {
        const target = await repositoryForThread(bb, threadId);
        return await host.call(
          "history",
          { environmentPath: target.environmentPath, offset, limit },
          { hostId: target.hostId },
        );
      } catch (error) {
        if (!(error instanceof RepositoryUnavailableError)) throw error;
        return {
          repoName: "Git history",
          currentBranch: null,
          uncommittedFiles: [],
          commits: [],
          offset,
          total: 0,
          hasMore: false,
          revision: "",
          unavailableReason: error.message,
        };
      }
    },

    async historyRevision({ threadId }) {
      try {
        const target = await repositoryForThread(bb, threadId);
        return await host.call(
          "historyRevision",
          { environmentPath: target.environmentPath },
          { hostId: target.hostId },
        );
      } catch (error) {
        if (!(error instanceof RepositoryUnavailableError)) throw error;
        return {
          revision: "",
          unavailableReason: error.message,
        };
      }
    },

    async details({ threadId, hash }) {
      const target = await repositoryForThread(bb, threadId);
      return host.call(
        "details",
        { environmentPath: target.environmentPath, hash },
        { hostId: target.hostId },
      );
    },

    async patch({ threadId, hash, path }) {
      const target = await repositoryForThread(bb, threadId);
      return host.call(
        "patch",
        { environmentPath: target.environmentPath, hash, path },
        { hostId: target.hostId },
      );
    },

    async workingPatch({ threadId, path }) {
      const target = await repositoryForThread(bb, threadId);
      return host.call(
        "workingPatch",
        { environmentPath: target.environmentPath, path },
        { hostId: target.hostId },
      );
    },
  });

  bb.log.info("Git History loaded");
}
