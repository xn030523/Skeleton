/**
 * Credential Files — file passthrough registry for remote terminal backends.
 *
 * Ensures credential files, skill directories, and host-side cache directories
 * are mounted/synced into sandboxes (Docker, SSH). Provides mount specs
 * that backend adapters translate to -v / --mount or rsync commands.
 */

interface CredentialMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

const mounts: CredentialMount[] = [];

/** Register a host file/directory for passthrough into sandboxes */
export function registerCredentialFile(
  hostPath: string,
  containerPath: string,
  readOnly: boolean = true,
): void {
  const existing = mounts.find(
    (m) => m.hostPath === hostPath && m.containerPath === containerPath,
  );
  if (existing) {
    existing.readOnly = readOnly;
    return;
  }
  mounts.push({ hostPath, containerPath, readOnly });
}

/** Get all registered credential file mount specifications */
export function getCredentialFileMounts(): Array<{
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}> {
  return mounts.map((m) => ({ ...m }));
}
