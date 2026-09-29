import type { Transaction } from 'dexie';
import { upgradeV1Row, type TweetRecordV1 } from '@/core/domain/snapshot';
import type { TweetRecord } from '@/core/domain/tweet';

/**
 * v1 → v2: every stored post gains the snapshot fields (work order 3.2), so no
 * reader ever meets a half-shaped row. Folders, memberships and the recent
 * list are untouched. Idempotent, like upgradeV1Row itself.
 */
export async function upgradeToV2(tx: Transaction): Promise<void> {
  await tx
    .table('tweets')
    .toCollection()
    .modify((row: TweetRecordV1 & Partial<TweetRecord>) => {
      Object.assign(row, upgradeV1Row(row));
    });
}
