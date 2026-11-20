import type { ReactNode } from 'react';

import { AppLogo } from '@x10/shared/runtime';
import { Table, TableWrap, Td, Th } from '@x10/shared/ui';

import { LevelMark } from '../components/chips';
import { CHECKLISTS, CURRENT_CHECKLIST_VERSION, getChecklist } from '../config/checklist';
import { rules } from '../config/rules';
import { SealBadge } from '../hall/Seal';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-line py-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
      <h2 className="x-legend-label m-0 pt-1 text-muted">{title}</h2>
      <div className="min-w-0 text-sm leading-6 text-fg">{children}</div>
    </section>
  );
}

/** About: what the app is for, the rules and thresholds from config, and who can see what. */
export function AboutPage() {
  const current = getChecklist(CURRENT_CHECKLIST_VERSION);
  return (
    <div className="mx-auto max-w-[880px]">
      <header className="mb-8 flex flex-wrap items-center gap-6">
        <div className="flex -space-x-5">
          <SealBadge size={84} kind="seal" seed={42} initials="Ce" level="certified" rim="gold" fraction={0.72} arcTone="ok" legend="CERTIFIED · YOUR MODEL" />
          <SealBadge size={84} kind="seal" seed={17} initials="Pr" level="promoted" rim="slate" fraction={null} legend="PROMOTED · YOUR MODEL" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <AppLogo size={20} />
            <span className="x-legend-label text-muted">Model Endorsement Queue</span>
          </div>
          <h1 className="x-serif m-0 text-4xl leading-tight text-fg">A review trail for the models you tell people to trust.</h1>
        </div>
      </header>

      <Block title="Why">
        <p className="m-0">
          Fabric lets you mark a semantic model as Promoted or Certified, but it has no review process around the badge. This app is that process: an owner
          submits a model with a self-assessment, a reviewer claims it on the assay desk and passes or fails every checklist item with evidence, and every step
          lands in an append-only decision trail. Each approval strikes a seal in the hall; a Certified seal&apos;s arc drains over {rules.certifiedValidityMonths}{' '}
          months toward renewal.
        </p>
        <p className="m-0 mt-3 rounded-lg bg-surface-sunken px-3.5 py-3 text-ui" role="note">
          <strong className="font-medium">Scope:</strong> the app records the review. It does not set the endorsement badge. After approving, the reviewer applies
          the badge in Fabric (the model&apos;s Settings → Endorsement).
        </p>
      </Block>

      <Block title="The hall">
        <ul className="m-0 space-y-1.5 pl-4">
          <li>
            Each endorsed model is a medallion: its initials, a guilloché pattern unique to it, and a level ring. <LevelMark level="certified" /> seals are gold
            with a scalloped edge; <LevelMark level="promoted" /> seals are slate.
          </li>
          <li>The outer arc is the validity left: green, amber within {rules.renewalDueDays} days of the end, a red bead once it has run out. Promoted seals do not expire.</li>
          <li>Open requests are unstamped wax blanks on the assay bench; the ring shows the reviewer&apos;s progress, or the items to fix.</li>
          <li>A cracked seal does not match its decision trail (the row was changed outside the app).</li>
          <li>Lenses regroup the hall by level, expiry, owner, reviewer or workspace; the list view holds the same items.</li>
        </ul>
      </Block>

      <Block title="Rules">
        <ul className="m-0 space-y-1.5 pl-4">
          <li>Approve only when every item the level needs is Pass, or N/A where allowed (with evidence text).</li>
          <li>The reviewer is never the owner, and only the reviewer who claimed a request can decide it.</li>
          <li>
            Certified approvals expire after <span className="num">{rules.certifiedValidityMonths}</span> months; Promoted never expires.
          </li>
          <li>
            Renewals lists certified seals with <span className="num">{rules.renewalsWindowDays}</span> days or less left. The first time a reviewer opens it after a
            model&apos;s renewal date, one “renewal due” event is added to that model&apos;s trail.
          </li>
          <li>
            Waiting time turns amber after <span className="num">{rules.ageAmberDays}</span> days and red after <span className="num">{rules.ageRedDays}</span>.
          </li>
          <li>One open request per model and workspace: a duplicate is blocked with a link to the open one.</li>
        </ul>
      </Block>

      <Block title="Who sees what">
        <p className="m-0">
          Everyone who can open this app can read every request, the register and the trails. Only names are shown; data stays in this app&apos;s Fabric SQL
          database. Reviewers are the people the deployer marks as admins.
        </p>
        <p className="m-0 mt-3 text-ui text-muted">
          The database only lets you create requests as yourself, stamps every answer and event with its author, and never lets anyone edit or delete answers or
          events. Reviewer-only actions are checked by the app, and the register flags any approval that does not match the trail.
        </p>
      </Block>

      <section className="border-t border-line pt-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="x-legend-label m-0 text-muted">Checklist v{current.version}</h2>
          <span className="text-ui text-muted">Requests keep the version they were submitted with.</span>
        </div>
        <TableWrap label="Current checklist">
          <Table className="min-w-[620px]">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>What the reviewer checks</Th>
                <Th>Needed for</Th>
                <Th>N/A</Th>
              </tr>
            </thead>
            <tbody>
              {current.items.map((i) => (
                <tr key={i.key}>
                  <Td className="font-medium">{i.label}</Td>
                  <Td muted>{i.help}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {i.levels.map((l) => (
                        <LevelMark key={l} level={l} />
                      ))}
                    </span>
                  </Td>
                  <Td muted>{i.naAllowed ? 'With evidence' : 'No'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
        <ul className="m-0 mt-3 list-none space-y-1 p-0 text-ui text-muted">
          {Object.values(CHECKLISTS).map((c) => (
            <li key={c.version}>
              <span className="font-mono text-xs num">v{c.version}</span> {c.summary}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-ui text-faint">Built by Datachain Consulting for AI @Work. Runs on Microsoft Fabric Apps (preview).</p>
      </section>
    </div>
  );
}
