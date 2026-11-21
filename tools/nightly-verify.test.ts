import { describe, expect, it, vi } from 'vitest';
import { parseVerifierOutcome } from '../apps/api/src/modules/settlement/integrity-divergence.store';
import { exitCodeFor, nightlyOptions, reportOutcome, runVerifierBinary } from './nightly-verify';

describe('INT-VER-002 contrôle nocturne : lecture du résultat du vérificateur', () => {
  it('0 vérifié ; 1 divergence avec le code du vérificateur ; autre code : non exécuté', () => {
    expect(parseVerifierOutcome(0, '')).toEqual({ kind: 'VERIFIED' });
    expect(parseVerifierOutcome(1, 'VERIFICATION_FAILED ENTRY_HASH_MISMATCH seq=3\n')).toEqual({ kind: 'DIVERGENCE', code: 'ENTRY_HASH_MISMATCH' });
    expect(parseVerifierOutcome(2, 'EXPORT_INVALID champ inconnu')).toEqual({ kind: 'NOT_RUN' });
    expect(parseVerifierOutcome(null, '')).toEqual({ kind: 'NOT_RUN' });
  });

  it('une divergence n’est jamais ignorée : sortie illisible ou forgée → code générique', () => {
    expect(parseVerifierOutcome(1, '')).toEqual({ kind: 'DIVERGENCE', code: 'VERIFIER_DIVERGENCE' });
    expect(parseVerifierOutcome(1, "VERIFICATION_FAILED x'; DROP TABLE y")).toEqual({ kind: 'DIVERGENCE', code: 'VERIFIER_DIVERGENCE' });
    expect(parseVerifierOutcome(1, 'bruit\nVERIFICATION_FAILED SEQUENCE_GAP\n')).toEqual({ kind: 'DIVERGENCE', code: 'SEQUENCE_GAP' });
    expect(parseVerifierOutcome(1, 'VERIFICATION_FAILED ENTRY_HASH_MISMATCH;rm -rf')).toEqual({ kind: 'DIVERGENCE', code: 'VERIFIER_DIVERGENCE' });
  });

  it('seule une divergence écrit en base ; codes de sortie 0 / 1 / 2', async () => {
    const record = vi.fn((code: string) => Promise.resolve(`id-${code}`));
    const verified = await reportOutcome({ kind: 'VERIFIED' }, record);
    const notRun = await reportOutcome({ kind: 'NOT_RUN' }, record);
    expect(record).not.toHaveBeenCalled();
    const diverged = await reportOutcome({ kind: 'DIVERGENCE', code: 'ENTRY_UNBALANCED' }, record);
    expect(record).toHaveBeenCalledExactlyOnceWith('ENTRY_UNBALANCED');
    expect(diverged).toEqual({ status: 'DIVERGENCE', code: 'ENTRY_UNBALANCED', divergenceId: 'id-ENTRY_UNBALANCED' });
    expect([exitCodeFor(verified), exitCodeFor(diverged), exitCodeFor(notRun)]).toEqual([0, 1, 2]);
  });

  it('arguments en liste blanche ; binaire absent : non exécuté (alerte, sans gel)', () => {
    expect(nightlyOptions(['--export', 'e.json', '--public-key', 'k.txt'])).toEqual({ exportPath: 'e.json', publicKeyPath: 'k.txt' });
    for (const args of [[], ['--export', 'e.json'], ['--public-key', 'k', '--export', 'e'], ['--export', '', '--public-key', 'k'], ['--export', 'e', '--public-key', 'k', '--x']]) {
      expect(() => nightlyOptions(args), JSON.stringify(args)).toThrow('NIGHTLY_ARGUMENTS_INVALID');
    }
    expect(runVerifierBinary('/nonexistent/verifier', 'e.json', 'k.txt')).toEqual({ kind: 'NOT_RUN' });
  });
});
