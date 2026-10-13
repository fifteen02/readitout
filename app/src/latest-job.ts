/** Serialize shared-state work, skipping superseded jobs and exposing ownership after awaits. */
export function createLatestJobQueue() {
  let revision = 0;
  let tail: Promise<void> = Promise.resolve();
  return (job: (isCurrent: () => boolean) => Promise<void>): Promise<void> => {
    const ownRevision = ++revision;
    const isCurrent = () => ownRevision === revision;
    const result = tail.then(async () => { if (isCurrent()) await job(isCurrent); });
    tail = result.catch(() => {}); // A failed job must not block a later document.
    return result;
  };
}
