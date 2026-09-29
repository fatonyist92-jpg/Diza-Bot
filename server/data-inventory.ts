// What belongs to a normal DIZA data backup. Credentials are deliberately
// not on this list. A future export UI can copy exactly this inventory and
// require a separate explicit action for secrets.
export const DATA_BACKUP_ENTRIES = [
  "bots.json",
  "messages",
  "projects.json",
  "project-memory",
  "attachments",
  "imagine.json",
  "workspaces",
  "avatars",
] as const;

export const SECRET_BACKUP_ENTRIES = ["config.json"] as const;

export interface BackupManifest {
  format: "diza-data-backup";
  version: 1;
  createdAt: string;
  includesSecrets: false;
  entries: readonly string[];
}

export function dataBackupManifest(now = new Date()): BackupManifest {
  return {
    format: "diza-data-backup",
    version: 1,
    createdAt: now.toISOString(),
    includesSecrets: false,
    entries: DATA_BACKUP_ENTRIES,
  };
}
