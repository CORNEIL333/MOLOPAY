import type { DispatchCounts } from './dispatch.store';
import { BusinessError } from '@achat/contracts';

export type QueueThresholds = Readonly<{ maxPending: bigint; maxDeferredReminders: bigint }>;
export type QueueReport = Readonly<{
  status: 'OK' | 'ATTENTION'; reasons: readonly string[];
  counts: Readonly<Record<keyof DispatchCounts, string>>;
}>;
function bigintFields(value: object, keys: readonly string[]): void {
  if (typeof value !== 'object' || value === null || Reflect.ownKeys(value).length !== keys.length) {
    throw new BusinessError('NOTIFICATION_INVALID_REQUEST');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key]!, 'value')
    || typeof descriptors[key]!.value !== 'bigint' || descriptors[key]!.value < 0n)) {
    throw new BusinessError('NOTIFICATION_INVALID_REQUEST');
  }
}
export function assessNotificationQueue(counts: DispatchCounts, thresholds: QueueThresholds): QueueReport {
  bigintFields(counts, ['pending', 'leased', 'retryWait', 'exhausted', 'deferredReminders']);
  bigintFields(thresholds, ['maxPending', 'maxDeferredReminders']);
  const reasons: string[] = [];
  if (counts.exhausted > 0n) reasons.push('NOTIFICATION_QUEUE_EXHAUSTED');
  if (counts.pending > thresholds.maxPending) reasons.push('NOTIFICATION_QUEUE_BACKLOG');
  if (counts.deferredReminders > thresholds.maxDeferredReminders) reasons.push('NOTIFICATION_REMINDERS_DEFERRED');
  return Object.freeze({ status: reasons.length === 0 ? 'OK' : 'ATTENTION', reasons: Object.freeze(reasons),
    counts: Object.freeze({ pending: counts.pending.toString(), leased: counts.leased.toString(), retryWait: counts.retryWait.toString(),
      exhausted: counts.exhausted.toString(), deferredReminders: counts.deferredReminders.toString() }) });
}
