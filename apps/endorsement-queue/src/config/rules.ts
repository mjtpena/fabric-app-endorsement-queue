/** Workflow thresholds. Shown on the About page; change them here only. */
export const rules = {
  /** A certified endorsement expires this many months after approval. Promoted has no expiry. */
  certifiedValidityMonths: 12,
  /** The register flags "renewal due" when the expiry is this close (or nearer). */
  renewalDueDays: 30,
  /** The Renewals page lists certified models expiring within this many days (and expired ones). */
  renewalsWindowDays: 60,
  /** Review queue age chip: amber after this many days waiting... */
  ageAmberDays: 5,
  /** ...and red after this many. */
  ageRedDays: 10,
} as const;

export type Rules = typeof rules;
