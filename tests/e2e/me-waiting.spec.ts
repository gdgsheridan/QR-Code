import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, signIn } from '../fixtures/e2e';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC F14 (v0.11.25): someone without a menu learns why, in words that match their state; and the 404 for a
// menu page they can't open leads back to the menu.
let f: StandardFixture;
test.beforeEach(async () => {
  f = await createStandardFixture();
});
test.afterEach(async () => {
  await f.close();
});

async function applicant(name: string, status: 'pending' | 'withdrawn', invited: boolean): Promise<string> {
  const email = `${name.toLowerCase()}-${f.slug}@example.test`;
  await f.pool.query(
    `insert into participants (event_id, email, first_name, search_text, status, source, rsvp_token_hash, rsvp_sent_at)
     values ($1, $2, $3, lower($3), $4, 'sheet', $5, $6)`,
    [f.e1.id, email, name, status, invited ? sha256hex(generateToken()) : null, invited ? new Date(Date.now() - 3 * 86_400_000).toISOString() : null],
  );
  await createAccount(email);
  return email;
}

test('/me tells a never-invited applicant they applied, and a withdrawn hacker whether they can still say yes', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: E2E_ORIGIN });
  const p = await ctx.newPage();
  await signIn(p, await applicant('Appl', 'pending', false), '/me');
  await expect(p.getByText(`You’ve applied to ${f.e1.name}. We’ll email you if you get a spot.`)).toBeVisible();
  await expect(p.getByText(/waitlist/)).toHaveCount(0);
  await ctx.clearCookies();

  // No deadline: the invitation never closes, so they can reopen it.
  await signIn(p, await applicant('Wanda', 'withdrawn', true), '/me');
  await expect(p.getByText('Changed your mind? Open your invitation link again before the RSVP deadline.', { exact: false })).toBeVisible();
  await ctx.clearCookies();

  // Deadline passed (and the 48 h after sending): RSVPs are closed.
  await f.pool.query(`update events set rsvp_deadline = now() - interval '1 day' where id = $1`, [f.e1.id]);
  await signIn(p, await applicant('Late', 'withdrawn', true), '/me');
  await expect(p.getByText(`You gave your spot at ${f.e1.name} away. RSVPs are closed.`)).toBeVisible();
  await expect(p.getByText(/Open your invitation link again/)).toHaveCount(0);

  // A menu page they can't open: the link says where it goes.
  await p.goto('/me/team');
  await expect(p.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(p.getByRole('link', { name: 'My menu' })).toHaveAttribute('href', '/me');
  await ctx.close();
});

test('/me: before a badge is linked the profile item says when it happens, not that something is missing', async ({ page }) => {
  const a = (await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A])).rows[0]!.email;
  await f.pool.query(`update participants set overnight = 'no', team_status = 'solo' where id = $1`, [f.p.A]);
  await createAccount(a);
  await signIn(page, a, '/me');
  await expect(page.getByRole('link', { name: /Hacker profile/ })).toContainText('Badge: linked at check-in');
});
