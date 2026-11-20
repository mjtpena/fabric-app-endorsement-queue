/** Seal props for a single request row (register, desk, my requests), without building the whole hall. */
import { validityFraction } from '../domain/hall';
import { expiryState } from '../domain/register';
import type { EndorsementRequest } from '../model';
import { sealInitials, sealSeed } from './geometry';
import { levelRim, type SealMarkProps } from './Seal';

export function sealForRequest(
  r: EndorsementRequest,
  now: Date,
  opts: { verified?: boolean; checked?: number; total?: number; failed?: number } = {},
): SealMarkProps {
  const seed = sealSeed(r.modelName, r.workspace);
  const initials = sealInitials(r.modelName);
  if (r.status === 'approved') {
    const ex = expiryState(r, now);
    return {
      kind: 'seal',
      seed,
      initials,
      level: r.requestedLevel,
      rim: levelRim(r.requestedLevel),
      legend: `${r.requestedLevel === 'certified' ? 'CERTIFIED' : 'PROMOTED'} · ${r.workspace.toUpperCase()} · ${(r.decidedAt ?? r.submittedAt).slice(0, 4)}`,
      fraction: validityFraction(r, now),
      arcTone: ex.kind === 'expired' ? 'bad' : ex.kind === 'due' ? 'warn' : ex.kind === 'valid' ? 'ok' : null,
      verified: opts.verified ?? true,
    };
  }
  const st = r.status;
  const open = st === 'submitted' || st === 'in_review' || st === 'changes_requested';
  return {
    kind: 'blank',
    seed,
    initials,
    level: r.requestedLevel,
    rim: open ? levelRim(r.requestedLevel) : 'none',
    status: st === 'in_review' || st === 'changes_requested' ? st : 'submitted',
    checked: opts.checked ?? 0,
    total: opts.total ?? 1,
    failed: opts.failed ?? 0,
    verified: opts.verified ?? true,
  };
}
