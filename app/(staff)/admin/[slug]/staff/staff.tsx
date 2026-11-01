'use client';

import { SectionLabel } from '@/components/section-label';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';

import { useCallback, useState } from 'react';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog } from '../dialog';

interface StaffData {
  staff: Array<{ userId: string; role: 'organizer' | 'volunteer'; displayName: string | null; isMe: boolean }>;
  invites: Array<{ email: string; role: 'organizer' | 'volunteer' }>;
}
type Pending = { kind: 'remove'; userId: string; name: string } | { kind: 'cancel'; email: string } | null;

// F9: invite by email + role. New addresses get an email to set a password; the invite is consumed on sign-in.
// Existing accounts are added at once and emailed a link to sign in (v0.11.12).
export function Staff({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<StaffData | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'volunteer' | 'organizer'>('volunteer');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    const r = await api<StaffData>(adminUrl(slug, '/staff'));
    if (r.ok) setData(r.data);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug]);

  useLoad(load);

  async function invite() {
    const r = await api<{ code: string; emailed?: boolean }>(adminUrl(slug, '/staff/invites'), { method: 'POST', body: { email, role } });
    if (r.ok) {
      // PR #11 (M4): the answer is the same whether or not the address has an account, so the message covers both.
      setMessage(
        r.data.emailed === false
          ? `! Invited, but the email didn’t go out. Ask them to use “Forgot or never set your password?” on the sign-in page.`
          : `✓ Done. We emailed them a link to sign in, or to set a password if they don’t have an account yet.`,
      );
      setEmail('');
    } else setMessage(r.status === 400 ? '✕ Enter a valid email.' : `✕ ${errorText(r)}`);
    await load();
  }

  async function confirm(p: NonNullable<Pending>) {
    setPending(null);
    const r =
      p.kind === 'remove'
        ? await api<{ code: string }>(adminUrl(slug, `/staff/${p.userId}`), { method: 'DELETE' })
        : await api<{ code: string }>(adminUrl(slug, `/staff/invites/${encodeURIComponent(p.email)}`), { method: 'DELETE' });
    if (r.ok) setMessage(p.kind === 'remove' ? `✓ Removed ${p.name}. Their next scan will be refused.` : '✓ Invite cancelled.');
    else setMessage(r.data.code === 'LAST_ORGANIZER' ? '✕ You can’t remove the last organizer.' : `✕ ${errorText(r)}`);
    await load();
  }

  return (
    <>
      <div className="grid gap-[24px] min-w-0 pb-[32px] [&_button:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_button:focus-visible]:[outline-offset:3px] [&_input:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_input:focus-visible]:[outline-offset:3px] [&_select:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_select:focus-visible]:[outline-offset:3px]">
        <header className="flex items-start justify-between gap-[20px] p-[8px_0px] max-[760.001px]:items-stretch

          max-[480.001px]:flex-wrap [&_h1]:m-0 [&_h1]:text-[clamp(1.8rem,_3vw,_2.3rem)] [&_h1]:tracking-[-0.045em]">
          <div>
            <SectionLabel>EVENT MANAGEMENT</SectionLabel>
            <h1>Staff</h1>
            <p className="copy m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.6]">
              Manage your team, assign roles, and invite people to help run your event.
            </p>
          </div>
          <Card className="grid gap-[3px] [flex-shrink:0] min-w-[112px] p-[14px_18px] [background:var(--card)] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card

          max-[760.001px]:min-w-[84px] max-[760.001px]:p-[12px] max-[480.001px]:w-full max-[480.001px]:box-border

          [&_span:first-child]:text-[1.65rem] [&_span:first-child]:[font-weight:750]

          [&_span:first-child]:leading-[1.2] [&_span:last-child]:text-muted-foreground [&_span:last-child]:text-[0.78rem]">
            <span>{data?.staff.length ?? '—'}</span>
            <span>Team members</span>
          </Card>
        </header>

        <section className="min-w-0 p-[22px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-ticket max-[760.001px]:p-[16px]">
          <div className="flex items-center justify-between gap-[16px] mb-[20px] max-[760.001px]:items-start

          max-[480.001px]:flex-col [&_h2]:m-0 [&_h2]:text-[1.08rem] [&_h2]:tracking-[-0.02em]">
            <div>
              <h2>Invite a team member</h2>
              <p className="copy m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.6]">
                Send an invitation by email and choose their access level.
              </p>
            </div>
          </div>

          <form
            className="grid [grid-template-columns:minmax(0px,_1.6fr)_minmax(150px,_0.8fr)_auto] [align-items:end] gap-[14px]

          max-[760.001px]:[grid-template-columns:1fr_1fr] [&_.tw-admin-field]:min-w-0

          [&_.tw-admin-field]:gap-[8px] [&_.tw-admin-field]:text-[0.82rem] [&_.tw-admin-field]:[font-weight:650]

          [&_.tw-admin-input]:w-full [&_.tw-admin-input]:min-h-[44px] [&_.tw-admin-input]:box-border

          [&_.tw-admin-input]:rounded-md max-[760.001px]:[&_.tw-admin-field:first-child]:[grid-column:1_/_-1]

          [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:text-fg

          [&_select]:[font-family:inherit] [&_select]:[font-size:inherit] [&_select]:text-fg

          [&_input::placeholder]:[font-family:inherit] [&_input::placeholder]:text-muted-foreground

          [&_select_option]:[font-family:inherit] [&_select_option]:text-fg

          [&_select_option]:[background:var(--card)]"
            onSubmit={(e) => {
              e.preventDefault();
              void invite();
            }}
          >
            <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
              Email address
              <Input
                className="tw-admin-input w-full"
                type="email"
                placeholder="name@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Label>

            <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
              Role
              <NativeSelect
                className="tw-admin-input w-full"
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as 'volunteer' | 'organizer')
                }
              >
                <option value="volunteer">Volunteer</option>
                <option value="organizer">Organizer</option>
              </NativeSelect>
            </Label>

            <Button type="submit" className="whitespace-nowrap text-sm max-[760px]:col-span-full max-[760px]:w-full">
              <span aria-hidden="true">+ </span>Invite
            </Button>
          </form>

          {message && (
            <Alert className={
                `flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]
                [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]
                [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]
                leading-[1.65] [overflow-wrap:anywhere]` +
                ' ' +
                (message.startsWith('✓') ? `[&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]` : `[&&]:[border-color:color-mix(in_srgb,_var(--warn,_#fbbf24)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#fbbf24_6%,_var(--card))]`)
              } asChild role="status"><p

              data-tone={message.startsWith('✓') ? 'ok' : message.startsWith('✕') ? 'bad' : 'warn'}
              role="status"
            >
              {message}
            </p></Alert>
          )}
        </section>

        <section className="min-w-0 p-[22px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-ticket max-[760.001px]:p-[16px]">
          <div className="flex items-center justify-between gap-[16px] mb-[20px] max-[760.001px]:items-start

          max-[480.001px]:flex-col [&_h2]:m-0 [&_h2]:text-[1.08rem] [&_h2]:tracking-[-0.02em]">
            <div>
              <h2>Your team</h2>
              <p className="copy m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.6]">
                People who currently have access to this event.
              </p>
            </div>
            <span className="[flex-shrink:0] p-[5px_10px] text-muted-foreground [background:transparent] [border-width:1px]
          [border-style:solid]
 [border-top-color:var(--line)] [border-right-color:var(--line)]
          [border-bottom-color:var(--line)]
 [border-left-color:var(--line)] rounded-sm text-[0.75rem]
          [font-weight:650]">
              {data?.staff.length ?? 0} members
            </span>
          </div>

          {!data ? (
            <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Loading team…</p>
          ) : data.staff.length === 0 ? (
            <p className="m-0 p-[24px_12px] [border-width:1px] [border-style:dashed] [border-top-color:var(--line)]

          [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)]

          rounded-md text-muted-foreground text-[0.88rem] text-center">No team members yet.</p>
          ) : (
            <div className="tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full">
              <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Team member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.staff.map((s) => {
                    const name = s.displayName ?? '(no name yet)';

                    return (
                      <TableRow key={s.userId}>
                        <TableCell>
                          <div className="flex items-center gap-[12px] min-w-0 [&_strong]:text-[0.88rem] [&_strong]:[font-weight:650]

          [&_strong]:[overflow-wrap:anywhere]">
                            <span className="grid [place-items:center] w-[38px] h-[38px] [flex-shrink:0] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-[50%] [background:transparent] text-fg text-[0.9rem]

          [font-weight:750]" aria-hidden="true">
                              {(s.displayName?.trim() || '?').charAt(0).toUpperCase()}
                            </span>
                            <span>
                              <strong>{name}</strong>
                              {s.isMe && (
                                <span className="inline-block ml-[8px] p-[3px_7px] [border-width:1px] [border-style:solid]
          [border-top-color:var(--line)]
 [border-right-color:var(--line)] [border-bottom-color:var(--line)]
          [border-left-color:var(--line)]
 rounded-sm text-muted-foreground text-[0.7rem] font-semibold
          [vertical-align:middle]">You</span>
                              )}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`tw-admin-staffRole inline-flex items-center p-[5px_9px] [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-sm text-[0.76rem] [font-weight:650] whitespace-nowrap ${s.role === 'organizer'
                                ? `[&.tw-admin-staffRole]:text-fg [&.tw-admin-staffRole]:[background:var(--card)]
                [&.tw-admin-staffRole]:border-accent`
                                : " [&.tw-admin-staffRole]:text-muted-foreground [&.tw-admin-staffRole]:[background:transparent]"
                              }`}
                          >
                            {s.role === 'organizer' ? 'Organizer' : 'Volunteer'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {!s.isMe && (
                            <Button
                              type="button"
                              variant="ghost" className="tw-admin-danger text-destructive hover:bg-destructive/10"
                              aria-label={`Remove ${name}`}
                              onClick={() =>
                                setPending({
                                  kind: 'remove',
                                  userId: s.userId,
                                  name,
                                })
                              }
                            >
                              Remove
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="min-w-0 p-[22px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-ticket max-[760.001px]:p-[16px]">
          <div className="flex items-center justify-between gap-[16px] mb-[20px] max-[760.001px]:items-start

          max-[480.001px]:flex-col [&_h2]:m-0 [&_h2]:text-[1.08rem] [&_h2]:tracking-[-0.02em]">
            <div>
              <h2>Pending invitations</h2>
              <p className="copy m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.6]">
                Invitations waiting to be accepted.
              </p>
            </div>
            <span className="[flex-shrink:0] p-[5px_10px] text-muted-foreground [background:transparent] [border-width:1px]
          [border-style:solid]
 [border-top-color:var(--line)] [border-right-color:var(--line)]
          [border-bottom-color:var(--line)]
 [border-left-color:var(--line)] rounded-sm text-[0.75rem]
          [font-weight:650]">
              {data?.invites.length ?? 0} pending
            </span>
          </div>

          {!data ? (
            <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Loading invitations…</p>
          ) : data.invites.length === 0 ? (
            <p className="m-0 p-[24px_12px] [border-width:1px] [border-style:dashed] [border-top-color:var(--line)]

          [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)]

          rounded-md text-muted-foreground text-[0.88rem] text-center">
              No pending invitations. Invite someone to get started.
            </p>
          ) : (
            <div className="tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full">
              <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Email address</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.invites.map((i) => (
                    <TableRow key={i.email}>
                      <TableCell className="[overflow-wrap:anywhere] text-[0.87rem]">{i.email}</TableCell>
                      <TableCell>
                        <span
                          className={`tw-admin-staffRole inline-flex items-center p-[5px_9px] [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-sm text-[0.76rem] [font-weight:650] whitespace-nowrap ${i.role === 'organizer'
                              ? `[&.tw-admin-staffRole]:text-fg [&.tw-admin-staffRole]:[background:var(--card)]
                [&.tw-admin-staffRole]:border-accent`
                              : " [&.tw-admin-staffRole]:text-muted-foreground [&.tw-admin-staffRole]:[background:transparent]"
                            }`}
                        >
                          {i.role === 'organizer' ? 'Organizer' : 'Volunteer'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`Cancel invite for ${i.email}`}
                          onClick={() =>
                            setPending({ kind: 'cancel', email: i.email })
                          }
                        >
                          Cancel invite
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {pending && (
          <ConfirmDialog
            title={
              pending.kind === 'remove'
                ? `Remove ${pending.name}?`
                : `Cancel the invite for ${pending.email}?`
            }
            body={
              <p>
                {pending.kind === 'remove'
                  ? 'They lose access immediately. Their past scans stay.'
                  : 'They won’t get access when they sign in.'}
              </p>
            }
            confirmLabel={pending.kind === 'remove' ? 'Remove' : 'Cancel invite'}
            danger
            onConfirm={() => void confirm(pending)}
            onCancel={() => setPending(null)}
          />
        )}
      </div>
    </>
  );
}
