// Answers the risk-profile step (pillar buttons and regulatory screening) the way a person does.
// idx: option to pick in every pillar question (clamped, never "Not known" unless unknown=true).
// annex: 'none' or a word from the Annex III label, e.g. 'Essential'.
async function answerRiskProfile(p, { idx = 1, annex = 'none', unknown = false } = {}) {
  for (const g of await p.locator('.risk-pillar .risk-options').all()) {
    const opts = g.locator('[role=radio]'); const n = await opts.count();
    await opts.nth(unknown ? n - 1 : Math.min(idx, n - 2)).click();
  }
  const screen = p.locator('section.panel', { hasText: 'Regulatory screening' });
  if (!(await screen.count())) throw new Error(`Not on the risk profile step: ${(await p.locator('main').innerText()).slice(0, 300)}`);
  await screen.locator('.risk-options').first().locator('[role=radio]', { hasText: /^\s*No\s*$/ }).click();
  const annexGroup = screen.locator('.risk-options').nth(1);
  if (await annexGroup.count()) {
    if (annex === 'none') await annexGroup.locator('[role=radio]', { hasText: /None of these/ }).click();
    else await annexGroup.locator('[role=radio]', { hasText: new RegExp(`^\\s*${annex}`) }).click();
  }
}
// From the review step: register, then open the control assessment (answered at stage 2, can be started at once).
async function registerAndOpenControls(p, wait = 1500) {
  await p.getByRole('button', { name: 'Register product', exact: true }).click(); await p.waitForTimeout(700);
  await p.getByRole('button', { name: 'Start', exact: true }).click(); await p.waitForTimeout(wait);
}
module.exports = { answerRiskProfile, registerAndOpenControls };
