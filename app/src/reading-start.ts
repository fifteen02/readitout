import type { ReadItem } from './types';

/** Text extraction can outlive the document or the listening request that started it. */
export async function collectReadingPages(
  from: number, to: number,
  load: (page: number) => Promise<ReadItem[]>, isCurrent: () => boolean
): Promise<ReadItem[] | null> {
  const chunks: ReadItem[] = [];
  for (let page = from; page <= to; page++) {
    if (!isCurrent()) return null;
    try {
      const items = await load(page);
      if (!isCurrent()) return null;
      chunks.push(...items);
    } catch (error) {
      if (!isCurrent()) return null;
      throw error;
    }
  }
  return isCurrent() ? chunks : null;
}
