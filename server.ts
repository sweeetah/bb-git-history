import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract } from "./contracts";

export { rpcContract } from "./contracts";

interface RepositoryTarget {
  hostId: string;
  environmentPath: string;
}

class RepositoryUnavailableError extends Error {}

function repositoryInput(
  target: RepositoryTarget,
  repositoryKey: string | undefined,
) {
  return {
    environmentPath: target.environmentPath,
    ...(repositoryKey === undefined ? {} : { repositoryKey }),
  };
}

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
    async repositories({ threadId }) {
      try {
        const target = await repositoryForThread(bb, threadId);
        const result = await host.call(
          "repositories",
          { environmentPath: target.environmentPath },
          { hostId: target.hostId },
        );
        return { ...result, unavailableReason: null };
      } catch (error) {
        if (!(error instanceof RepositoryUnavailableError)) throw error;
        return {
          repositories: [],
          unavailableReason: error.message,
        };
      }
    },

    async history({ threadId, repositoryKey, offset, limit }) {
      try {
        const target = await repositoryForThread(bb, threadId);
        return await host.call(
          "history",
          { ...repositoryInput(target, repositoryKey), offset, limit },
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

    async historyRevision({ threadId, repositoryKey }) {
      try {
        const target = await repositoryForThread(bb, threadId);
        return await host.call(
          "historyRevision",
          repositoryInput(target, repositoryKey),
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

    async details({ threadId, repositoryKey, hash }) {
      const target = await repositoryForThread(bb, threadId);
      return host.call(
        "details",
        { ...repositoryInput(target, repositoryKey), hash },
        { hostId: target.hostId },
      );
    },

    async patch({ threadId, repositoryKey, hash, path }) {
      const target = await repositoryForThread(bb, threadId);
      return host.call(
        "patch",
        { ...repositoryInput(target, repositoryKey), hash, path },
        { hostId: target.hostId },
      );
    },

    async workingPatch({ threadId, repositoryKey, path }) {
      const target = await repositoryForThread(bb, threadId);
      return host.call(
        "workingPatch",
        { ...repositoryInput(target, repositoryKey), path },
        { hostId: target.hostId },
      );
    },
  });

  bb.log.info("Git History loaded");
}
