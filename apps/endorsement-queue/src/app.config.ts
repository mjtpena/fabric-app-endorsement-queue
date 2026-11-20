/**
 * App configuration. No React imports here: tools/seed-fabric.mjs loads this file in Node to export seed rows.
 */
import type { Persona } from '@x10/shared/identity';
import type { AppConfig } from '@x10/shared/runtime';

import { defs, type Schema } from './model';
import { seed } from './seed';

/**
 * Demo personas. Two reviewers (admins) and two model owners. Alex is a reviewer who also owns a model
 * (Procurement Spend), which shows that a reviewer can never review their own request.
 */
export const personas: Persona[] = [
  { sub: 'demo-reviewer-alex', name: 'Alex Rivera', email: 'alex@example.com', isAdmin: true, role: 'Reviewer, also an owner' },
  { sub: 'demo-reviewer-jordan', name: 'Jordan Lee', email: 'jordan@example.com', isAdmin: true, role: 'Reviewer' },
  { sub: 'demo-owner-sam', name: 'Sam Taylor', email: 'sam@example.com', isAdmin: false, role: 'Model owner' },
  { sub: 'demo-owner-priya', name: 'Priya Nair', email: 'priya@example.com', isAdmin: false, role: 'Model owner' },
];

export const PERSONA = {
  alex: personas[0].sub,
  jordan: personas[1].sub,
  sam: personas[2].sub,
  priya: personas[3].sub,
} as const;

export const config: AppConfig<Schema> = {
  appId: 'endorsement-queue',
  title: 'Model Endorsement Queue',
  tagline: 'A review trail for the models you tell people to trust.',
  defs,
  personas,
  seed,
  accent: 'gold',
  // A seal with its ribbon tails (JSX-free so the seed tools can load this file in Node).
  logoPaths: ['M12 3.2a6.6 6.6 0 1 0 0 13.2a6.6 6.6 0 1 0 0-13.2Z', 'M12 6.9a2.9 2.9 0 1 0 0 5.8a2.9 2.9 0 1 0 0-5.8Z', 'M8.4 15.2 7.3 21l4.7-2.4 4.7 2.4-1.1-5.8'],
  // Phone tab-bar icons are attached in main.tsx (navIcons) to keep this file JSX-free.
  nav: [
    { to: '/', label: 'Hall', end: true },
    { to: '/queue', label: 'Assay desk', adminOnly: true },
    { to: '/register', label: 'Seal register' },
    { to: '/renewals', label: 'Renewals' },
    { to: '/mine', label: 'My requests' },
    { to: '/submit', label: 'Submit' },
    { to: '/about', label: 'About' },
  ],
};
