import { describe, expect, it } from 'vitest';
import { localNotificationDatabase, notificationMonitorOptions } from './check-notification-queue';

describe('NF-REL-005 / SEC-SDLC-001 · commande de supervision locale', () => {
  it('exige les deux seuils explicites et accepte zéro', () => {
    expect(notificationMonitorOptions(['--max-pending', '0', '--max-deferred-reminders', '9007199254740993']))
      .toEqual({ maxPending: 0n, maxDeferredReminders: 9007199254740993n });
  });
  for (const args of [[], ['--max-pending', '1'], ['--max-pending', '1', '--max-pending', '2'],
    ['--other', '1', '--max-deferred-reminders', '0'],
    ...['-1', '+1', '1.1', '1e3', '01', ' 1', 'NaN', ''].map((value) => ['--max-pending', value, '--max-deferred-reminders', '0']),
    ['--max-pending', '1', '--max-deferred-reminders', '0', 'extra']]) {
    it('refuse les arguments hors contrat sans afficher leur contenu', () => {
      expect(() => notificationMonitorOptions(args)).toThrow('NOTIFICATION_MONITOR_ARGUMENTS_INVALID');
    });
  }
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    it('autorise seulement la base de test locale explicite', () => {
      const url = `postgres://postgres@${host}:54329/molopay_test`;
      expect(localNotificationDatabase(url)).toBe(url);
    });
  }
  for (const url of [undefined, '', 'not-an-url', 'https://127.0.0.1/molopay_test', 'postgres://remote.invalid/molopay_test',
    'postgres://127.0.0.1/production', 'postgres://127.0.0.1/molopay_test?options=unsafe',
    'postgres://127.0.0.1/molopay_test#unsafe', 'postgres://127.0.0.1/molopay_test/other']) {
    it('refuse les destinations hors liste blanche avec une erreur fermée', () => {
      expect(() => localNotificationDatabase(url)).toThrow('NOTIFICATION_MONITOR_DATABASE_FORBIDDEN');
    });
  }
});
