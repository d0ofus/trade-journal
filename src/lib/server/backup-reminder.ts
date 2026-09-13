export function backupReminderDue(current: boolean, verifiedAt: string | Date | null, now = Date.now()) {
  return !current && (!verifiedAt || now - new Date(verifiedAt).getTime() > 7 * 86400_000);
}
