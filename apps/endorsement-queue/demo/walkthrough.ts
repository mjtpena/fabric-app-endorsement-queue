import type { DemoScript } from '@x10/shared/demo';

const ALEX = 'demo-reviewer-alex';

export const script: DemoScript = {
  title: 'Model Endorsement Queue: a hall of seals for the models you tell people to trust',
  persona: ALEX,
  scenes: [
    {
      id: 'hook',
      say: [
        'This is the hall of seals: every endorsed semantic model hangs here as its own medallion.',
        'Gold rings are Certified, slate rings are Promoted, and the outer arc is how much of the year is left.',
      ],
      async run(h) {
        await h.goto('/', ALEX);
        await h.pause(2500);
        await h.hover(h.page.locator('[data-testid="hall-seal"][data-model="Supply Chain Inventory"] .eq-seal'));
        await h.pause(2500);
      },
    },
    {
      id: 'lens',
      say: ['Switch the lens to expiry and the hall regroups: expired, renewal due, valid, and no expiry.'],
      async run(h) {
        await h.click(h.page.getByRole('radio', { name: /Expiry/ }));
        await h.pause(3500);
      },
    },
    {
      id: 'today',
      say: ['Today ranks what needs attention; this one flies me to Sales Performance, ten days from running out.'],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: /Sales Performance seal is nearly drained/ }));
        await h.pause(3500);
      },
    },
    {
      id: 'view-as',
      say: ['View as owner, and everything that is not mine steps back.', 'Back to everyone.'],
      async run(h) {
        await h.page.keyboard.press('Escape');
        await h.click(h.page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: 'Owner', exact: true }));
        await h.pause(3000);
        await h.click(h.page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: 'All', exact: true }));
        await h.click(h.page.getByRole('radio', { name: /Level/ }));
      },
    },
    {
      id: 'bench',
      say: ['Open requests wait on the assay bench as unstamped wax, with the reviewer’s progress around each one.'],
      async run(h) {
        await h.click(h.page.locator('[data-testid="hall-blank"][data-model="Field Service Operations"] .eq-seal'));
        await h.pause(2500);
        await h.click(h.page.getByTestId('focus-open'));
      },
    },
    {
      id: 'assay',
      say: [
        'On the assay desk, the owner’s claim and evidence sit beside my verdict for every item.',
        'Not applicable is only allowed for security, tests and labels, and only with evidence.',
      ],
      async run(h) {
        for (const key of ['rls', 'measures']) {
          await h.click(h.page.getByTestId(`item-${key}`).getByRole('radio', { name: 'Pass' }));
        }
        await h.scrollTo(h.page.getByTestId('item-tests'));
        await h.click(h.page.getByTestId('item-tests').getByRole('radio', { name: 'N/A' }));
        await h.type(h.page.getByTestId('item-tests').getByLabel(/Evidence for Test suite passing/), 'Simple counts; row checks cover it.');
        for (const key of ['lineage', 'label', 'cleanup']) {
          await h.click(h.page.getByTestId(`item-${key}`).getByRole('radio', { name: 'Pass' }));
        }
        await h.spotlight(h.page.getByTestId('decision-panel'), 2000);
      },
    },
    {
      id: 'approve',
      say: [
        'Approving needs a note, and a Certified seal runs for twelve months.',
        'The app strikes the seal and records the review; I still apply the badge in Fabric, under Settings, Endorsement.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: 'Approve' }));
        const dialog = h.page.getByRole('dialog');
        await h.spotlight(dialog.getByTestId('approve-expiry'), 1500);
        await h.type(dialog.getByLabel('Decision note'), 'All items pass. Certified.');
        await h.click(dialog.getByRole('button', { name: 'Approve' }));
        await h.pause(1800);
        await h.spotlight(h.page.getByTestId('badge-reminder'), 3000);
      },
    },
    {
      id: 'sealed',
      say: ['Back in the hall, the new seal is pressed into the wax and hangs with the others, its arc full.'],
      async run(h) {
        await h.click(h.page.getByTestId('see-in-hall'));
        await h.pause(4000);
      },
    },
    {
      id: 'renewals',
      say: [
        'Renewals lists the seals whose arc is nearly drained.',
        'Start renewal opens a new request prefilled from the old one.',
        'The seal register holds the same records as a table, with a trail check on every row and a CSV export.',
      ],
      async run(h) {
        await h.goto('/renewals', ALEX);
        await h.spotlight(h.page.locator('[data-testid="renewal-row"][data-model="Sales Performance"]'), 2500);
        await h.click(h.page.locator('[data-testid="renewal-row"][data-model="Sales Performance"]').getByTestId('start-renewal'));
        await h.pause(1500);
        await h.goto('/register', ALEX);
        await h.spotlight(h.page.getByTestId('register-table'), 3000);
      },
    },
    {
      id: 'takeaway',
      say: ['A checklist, a named reviewer and a trail you can show anyone: that is what a badge should stand on.'],
      async run(h) {
        await h.goto('/', ALEX);
        await h.pause(3500);
      },
    },
  ],
};
