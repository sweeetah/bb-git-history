import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export type RepositoryDescriptor = { key: string; name: string };

export type GitRunner = (
  cwd: string,
  args: string[],
  signal: AbortSignal,
) => Promise<string>;

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  );
}

function repositoryKey(root: string, repositoryPath: string): string {
  const pathFromRoot = relative(root, repositoryPath);
  return pathFromRoot === "" ? "." : pathFromRoot.split(sep).join("/");
}

async function gitTopLevel(
  candidate: string,
  signal: AbortSignal,
  run: GitRunner,
): Promise<string | undefined> {
  try {
    const output = await run(candidate, ["rev-parse", "--show-toplevel"], signal);
    return await realpath(output.replace(/[\r\n]+$/, ""));
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

async function isRepository(
  candidate: string,
  signal: AbortSignal,
  run: GitRunner,
): Promise<boolean> {
  return (await gitTopLevel(candidate, signal, run)) === candidate;
}

export async function discoverRepositories(
  environmentPath: string,
  signal: AbortSignal,
  run: GitRunner,
): Promise<RepositoryDescriptor[]> {
  const environmentRoot = await realpath(environmentPath);

  if (await isRepository(environmentRoot, signal, run)) {
    return [{ key: ".", name: basename(environmentRoot) }];
  }

  let entries: Dirent<string>[];
  try {
    entries = await readdir(resolve(environmentRoot, "repos"), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const discovered = new Map<string, RepositoryDescriptor>();
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    try {
      const candidate = await realpath(resolve(environmentRoot, "repos", entry.name));
      if (!isInside(environmentRoot, candidate)) continue;
      if (!(await isRepository(candidate, signal, run))) continue;

      const key = repositoryKey(environmentRoot, candidate);
      discovered.set(candidate, { key, name: basename(candidate) });
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }

  return [...discovered.values()].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
}

function isRelativeRepositoryKey(repositoryKey: string): boolean {
  return (
    repositoryKey.length > 0 &&
    !isAbsolute(repositoryKey) &&
    !repositoryKey.split(/[\\/]/).includes("..")
  );
}

export async function resolveRepositorySelection(
  environmentPath: string,
  repositoryKey: string | undefined,
  signal: AbortSignal,
  run: GitRunner,
): Promise<string> {
  const repositories = await discoverRepositories(environmentPath, signal, run);

  if (repositoryKey === undefined) {
    if (repositories.length === 1) {
      const environmentRoot = await realpath(environmentPath);
      return realpath(resolve(environmentRoot, repositories[0]!.key));
    }
    throw new Error("Repository selection requires an explicit repository key.");
  }

  if (!isRelativeRepositoryKey(repositoryKey)) {
    throw new Error("Invalid repository selection.");
  }

  const selected = repositories.find((repository) => repository.key === repositoryKey);
  if (!selected) throw new Error("Invalid repository selection.");

  const environmentRoot = await realpath(environmentPath);
  return realpath(resolve(environmentRoot, selected.key));
}
