'use client';

import { SectionLabel } from '@/components/section-label';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

import { useCallback, useState } from 'react';
import { adminUrl, errorText, useApi, useLoad, type ApiResult } from '../api';
import { ConfirmDialog } from '../dialog';

interface Track {
  id: string;
  name: string;
}
interface Team {
  id: string;
  name: string;
  code: string;
  trackId: string | null;
  members: Array<{ id: string; displayName: string; status: string }>;
}
interface Data {
  teamsOpen: boolean;
  tracksReleased: boolean;
  tracks: Track[];
  teams: Team[];
  unassigned: Array<{ id: string; displayName: string; looking: boolean }>;
}
type Deleting = { kind: 'teams' | 'tracks'; id: string; name: string };

const code = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
const text = (f: FormData, k: string) => String(f.get(k) ?? '');

// SPEC §11 Teams (v0.7): organizers see and fix every team at any time; hackers form them while forming is open.
export function Teams({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);

  const load = useCallback(async () => {
    const r = await api<Data>(adminUrl(slug, '/teams'));
    if (r.ok) setData(r.data);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug]);

  useLoad(load);

  async function done(r: ApiResult<unknown>, ok: string) {
    setMessage(r.ok ? `✓ ${ok}` : `✕ ${errorText(r)}`);
    await load();
    return r.ok;
  }
  const call = (path: string, method: string, body?: unknown) => api(adminUrl(slug, path), { method, body });

  // The switch flips at once; the reload after the PATCH shows what the server kept.
  async function setFlag(flag: 'teamsOpen' | 'tracksReleased', on: boolean, ok: string) {
    setData((d) => d && { ...d, [flag]: on });
    await done(await call('/event', 'PATCH', { [flag]: on }), ok);
  }

  async function remove(d: Deleting) {
    setDeleting(null);
    await done(await call(`/${d.kind}/${d.id}`, 'DELETE'), `Deleted ${d.name}.`);
  }

  if (!data) return message ? <Alert asChild role="status"><p role="status">{message}</p></Alert> : <p>Loading…</p>;
  const looking = data.unassigned.filter((u) => u.looking).length;

  return (
    <>
      <header className="flex items-start justify-between gap-[24px] mb-[28px] pb-[24px] [border-bottom-width:1px]

          [border-bottom-style:solid] [border-bottom-color:var(--line)] max-[700.001px]:gap-[12px]

          max-[700.001px]:flex-col [&_h1]:m-[0px_0px_8px] [&_h1]:text-[clamp(30px,_3vw,_40px)]

          [&_h1]:font-extrabold [&_h1]:tracking-[-0.045em] [&_.tw-admin-muted]:max-w-[560px]

          [&_.tw-admin-muted]:m-0 [&_.tw-admin-muted]:leading-[1.6]">
        <div>
          <SectionLabel>EVENT MANAGEMENT</SectionLabel>
          <h1>Teams &amp; tracks</h1>
          <p className="copy tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Organize hackers, manage tracks, and monitor team formation.</p>
        </div>
        <div className="flex items-center gap-[8px] pt-[8px] max-[700.001px]:pt-0">
          <Badge className="tw-admin-badge inline-flex items-center justify-center w-[fit-content] p-[5px_9px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-md

          [background:var(--raised)] text-fg text-[11px] font-semibold leading-[1.35] whitespace-nowrap
          max-w-full
 [font-family:inherit]">{data.teamsOpen ? 'Formation open' : 'Formation closed'}</Badge>
        </div>
      </header>
      {message && (
        <Alert className={`flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]
                [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]
                [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]
                leading-[1.65] [overflow-wrap:anywhere]` + ' ' + (message.startsWith('✓') ? `[&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]` : `[&&]:[border-color:color-mix(in_srgb,_var(--warn,_#fbbf24)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#fbbf24_6%,_var(--card))]`)} asChild role="status"><p  data-tone={message.startsWith('✓') ? 'ok' : message.startsWith('✕') ? 'bad' : 'warn'} role="status">
          {message}
        </p></Alert>
      )}
      <div className="tw-admin-toolbar flex flex-wrap [align-items:end] gap-[14px] mb-[20px] p-[18px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card

          [background:var(--surface)]

          shadow-panel max-[700.001px]:items-stretch max-[700.001px]:gap-[12px] max-[700.001px]:p-[14px]

          [&_.tw-admin-input]:w-full [&_.tw-admin-input]:min-h-[44px] [&_.tw-admin-input]:text-[14px]

          [&_.tw-admin-input]:tracking-[normal] [&_.tw-admin-input]:normal-case

          [&_.tw-admin-input]:[font-family:inherit] [&_.tw-admin-input]:font-normal

          [&_.tw-admin-check]:min-h-[44px] [&_.tw-admin-check]:inline-flex [&_.tw-admin-check]:items-center

          [&_.tw-admin-check]:gap-[9px] [&_.tw-admin-check]:p-[0px_4px] [&_.tw-admin-check]:text-fg

          [&_.tw-admin-check]:text-[13px] [&_.tw-admin-check]:tracking-[normal] [&_.tw-admin-check]:normal-case

          max-[700.001px]:[&_.tw-admin-check]:[flex:1_1_100%] [&_>_button]:min-h-[44px] [&_>_button]:p-[0px_16px]

          [&_>_button]:whitespace-nowrap max-[700.001px]:[&_>_button]:[flex:1_1_auto]

          [&_.tw-admin-field]:[font-family:inherit] [&_.tw-admin-field]:text-[12px]

          [&_.tw-admin-field]:font-semibold [&_.tw-admin-field]:tracking-[0.02em] [&_.tw-admin-field]:normal-case

          max-[700.001px]:[&_.tw-admin-field]:[flex:1_1_100%] [&_select]:[font-family:inherit]

          [&_select]:text-[14px] [&_select]:font-normal [&_select]:tracking-[normal] [&_select]:normal-case">
        <Label className="tw-admin-check">
          <input
            type="checkbox"
            checked={data.teamsOpen}
            onChange={(e) => void setFlag('teamsOpen', e.target.checked, e.target.checked ? 'Team forming is open.' : 'Team forming is closed.')}
          />
          Team forming open
        </Label>
        <Label className="tw-admin-check">
          <input
            type="checkbox"
            checked={data.tracksReleased}
            onChange={(e) => void setFlag('tracksReleased', e.target.checked, e.target.checked ? 'Tracks released.' : 'Tracks hidden again.')}
          />
          Tracks released
        </Label>
      </div>
      <div className="grid [grid-template-columns:repeat(3,_minmax(0px,_1fr))] gap-[16px] m-[24px_0px_36px]

          max-[700.001px]:[grid-template-columns:repeat(2,_minmax(0px,_1fr))]

          max-[600.001px]:[grid-template-columns:1fr]">
        <div className="flex flex-col gap-[8px] min-w-0 p-[22px] [background:var(--card)] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-lg

          [transition:border-color_160ms,_transform_160ms]

          [&:hover]:[border-color:color-mix(in_srgb,_var(--accent)_45%,_var(--line))]

          [&:hover]:[transform:translateY(-2px)]">
          <span className="text-muted-foreground text-[13px] font-semibold">Total teams</span>
          <strong className="text-[34px] font-extrabold tracking-[-0.04em] leading-[1.1] tabular-nums">{data.teams.length}</strong>
          <span className="text-muted-foreground text-[12px] leading-[1.5]">Created for this event</span>
        </div>
        <div className="flex flex-col gap-[8px] min-w-0 p-[22px] [background:var(--card)] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-lg

          [transition:border-color_160ms,_transform_160ms]

          [&:hover]:[border-color:color-mix(in_srgb,_var(--accent)_45%,_var(--line))]

          [&:hover]:[transform:translateY(-2px)]">
          <span className="text-muted-foreground text-[13px] font-semibold">Unassigned hackers</span>
          <strong className="text-[34px] font-extrabold tracking-[-0.04em] leading-[1.1] tabular-nums">{data.unassigned.length}</strong>
          <span className="text-muted-foreground text-[12px] leading-[1.5]">Accepted participants without a team</span>
        </div>
        <div className="flex flex-col gap-[8px] min-w-0 p-[22px] [background:var(--card)] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-lg

          [transition:border-color_160ms,_transform_160ms]

          [&:hover]:[border-color:color-mix(in_srgb,_var(--accent)_45%,_var(--line))]

          [&:hover]:[transform:translateY(-2px)]">
          <span className="text-muted-foreground text-[13px] font-semibold">Looking for a team</span>
          <strong className="text-[34px] font-extrabold tracking-[-0.04em] leading-[1.1] tabular-nums">{looking}</strong>
          <span className="text-muted-foreground text-[12px] leading-[1.5]">May need help finding teammates</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-[20px] m-[36px_0px_20px] pb-[16px] [border-bottom-width:1px]

          [border-bottom-style:solid] [border-bottom-color:var(--line)] max-[600.001px]:items-start

          max-[600.001px]:gap-[12px] [&_h2]:m-[0px_0px_6px] [&_h2]:text-[24px] [&_h2]:font-extrabold

          [&_h2]:tracking-[-0.035em] max-[600.001px]:[&_h2]:text-[21px] [&_.tw-admin-eyebrow]:mb-[8px]

          [&_.tw-admin-muted]:m-0 [&_.tw-admin-muted]:text-[13px] [&_.tw-admin-muted]:leading-[1.5]

          [&_>_.tw-admin-badge]:whitespace-nowrap">
        <div>
          <SectionLabel>CONFIGURATION</SectionLabel>
          <h2>Tracks</h2>
          <p className="copy tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Manage the categories participants can choose for their teams.</p>
        </div>
        <Badge className="tw-admin-badge inline-flex items-center justify-center w-[fit-content] p-[5px_9px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-md

          [background:var(--raised)] text-fg text-[11px] font-semibold leading-[1.35] whitespace-nowrap
          max-w-full
 [font-family:inherit]">{data.tracks.length} tracks</Badge>
      </div>
      {data.tracks.length > 0 && (
        <div className="mt-[20px] overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-ticket [font:inherit] [&_table]:w-full

          [&_table]:[border-collapse:collapse] [&_table]:[font:inherit] [&_th]:p-[15px_18px]

          [&_th]:[background:color-mix(in_srgb,_var(--accent)_7%,_var(--card))] [&_th]:text-muted-foreground

          [&_th]:[font:inherit] [&_th]:tracking-[0.08em] [&_th]:text-left [&_th]:uppercase

          [&_th]:whitespace-nowrap [&_td]:p-[16px_18px] [&_td]:[border-top-width:1px]

          [&_td]:[border-top-style:solid] [&_td]:[border-top-color:var(--line)] [&_td]:[vertical-align:middle]

          [&_td]:[font:inherit] [&_tbody_tr]:[transition:background-color_150ms] [&_tbody_tr]:[font:inherit]

          [&_input]:[font:inherit] [&_select]:[font:inherit]

          [&_tbody_tr:hover]:[background:color-mix(in_srgb,_var(--accent)_4%,_var(--card))]">
          <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
            <TableBody>
              {data.tracks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <form
                      className="[font:inherit] flex items-center gap-[8px] w-full min-w-0 m-0 p-0 [border-width:medium]

          [border-style:none] [border-color:currentcolor] rounded-none [background:transparent] [box-shadow:none]

          [outline:none] max-[600.001px]:items-stretch [&_input]:min-w-0 max-[600.001px]:[&_input]:w-full

          [&_select]:min-w-0 max-[600.001px]:[&_button]:flex-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void call(`/tracks/${t.id}`, 'PATCH', { name: text(new FormData(e.currentTarget), 'name') }).then((r) => done(r, 'Track renamed.'));
                      }}
                    >
                      <Input name="name" aria-label={`Name of ${t.name}`} defaultValue={t.name} maxLength={100} required className="[font:inherit] min-h-[44px] p-[8px_10px] text-fg [border-width:1px] [border-style:solid]

          [border-color:transparent] rounded-md [background:transparent] [outline:none] [box-shadow:none]

          [&:focus]:[border-color:transparent] [&:focus]:[box-shadow:none]

          [&.tw-admin-trackNameEditing]:border-line [&.tw-admin-trackNameEditing]:[background:var(--card)]

          [&.tw-admin-trackNameEditing:focus]:border-accent

          [&.tw-admin-trackNameEditing:focus]:[box-shadow:0_0_0_3px_color-mix(in_srgb,_var(--accent)_12%,_transparent)]

          tw-admin-trackNameEditing" style={{ flex: 1 }} />
                      <Button type="submit" variant="outline">
                        Rename
                      </Button>
                      <Button type="button" variant="ghost" className="tw-admin-danger text-destructive hover:bg-destructive/10" aria-label={`Delete ${t.name}`} onClick={() => setDeleting({ kind: 'tracks', id: t.id, name: t.name })}>
                        Delete
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.tracks.length === 0 && (
        <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">No tracks yet.</p>
      )}

      {/* v0.11.32 (owner's request): add tracks one at a time from the page again (the box was removed in v0.11.1). */}
      <form
        className="flex items-end gap-[10px] w-full max-w-[none] box-border m-[20px_0px_40px] p-[16px]

          [background:var(--card)] [border-width:1px] [border-style:solid] [border-top-color:var(--line)]

          [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)]

          rounded-lg [box-shadow:rgba(0,_0,_0,_0.04)_0px_8px_24px] max-[600.001px]:p-[12px]

          [&_.tw-admin-field]:flex [&_.tw-admin-field]:flex-1 [&_.tw-admin-field]:flex-col

          [&_.tw-admin-field]:min-w-0 [&_.tw-admin-field]:gap-[8px] [&_.tw-admin-field]:text-[14px]

          [&_.tw-admin-field]:font-bold [&_.tw-admin-addTrackInput]:block [&_.tw-admin-addTrackInput]:w-full

          [&_.tw-admin-addTrackInput]:min-w-0 [&_.tw-admin-addTrackInput]:min-h-[40px]

          [&_.tw-admin-addTrackInput]:box-border [&_.tw-admin-addTrackInput]:p-[9px_12px]

          [&_.tw-admin-addTrackInput]:[border-width:1px] [&_.tw-admin-addTrackInput]:[border-style:solid]

          [&_.tw-admin-addTrackInput]:[border-top-color:var(--line)]

          [&_.tw-admin-addTrackInput]:[border-right-color:var(--line)]

          [&_.tw-admin-addTrackInput]:[border-bottom-color:var(--line)]

          [&_.tw-admin-addTrackInput]:[border-left-color:var(--line)] [&_.tw-admin-addTrackInput]:rounded-control

          [&_.tw-admin-addTrackInput]:[background:var(--card)] [&_.tw-admin-addTrackInput]:text-fg

          [&_.tw-admin-addTrackInput]:[font:inherit] [&_.tw-admin-addTrackInput]:[outline:none]

          [&_.tw-admin-addTrackInput]:[box-shadow:none] [&_.tw-admin-addTrackInput:focus]:border-accent

          [&_.tw-admin-addTrackInput:focus]:[box-shadow:0_0_0_3px_color-mix(in_srgb,_var(--accent)_12%,_transparent)]

          [&_>_div]:flex [&_>_div]:[flex:0_0_auto] [&_>_div]:items-center [&_>_div]:m-0 [&_button]:min-h-[44px]

          [&_button]:p-[0px_14px] [&_button]:rounded-control [&_button]:text-[14px] [&_button]:font-semibold

          [&_button]:whitespace-nowrap"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const name = text(new FormData(form), 'name').trim();
          // The API takes one per line; one name is one line. Clear and stay in the field for the next one.
          void call('/tracks', 'POST', { text: name }).then(async (r) => {
            if (await done(r, `Added ${name}.`)) {
              form.reset();
              form.querySelector('input')?.focus();
            }
          });
        }}
      >
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Add a track
          <Input name="name" required maxLength={100} placeholder="e.g. Best AI/ML Project" autoComplete="off" className="tw-admin-addTrackInput w-full min-h-[44px]" />
        </Label>
        <div>
          <Button type="submit">Add track</Button>
        </div>
      </form>

      <div className="flex items-center justify-between gap-[20px] m-[36px_0px_20px] pb-[16px] [border-bottom-width:1px]

          [border-bottom-style:solid] [border-bottom-color:var(--line)] max-[600.001px]:items-start

          max-[600.001px]:gap-[12px] [&_h2]:m-[0px_0px_6px] [&_h2]:text-[24px] [&_h2]:font-extrabold

          [&_h2]:tracking-[-0.035em] max-[600.001px]:[&_h2]:text-[21px] [&_.tw-admin-eyebrow]:mb-[8px]

          [&_.tw-admin-muted]:m-0 [&_.tw-admin-muted]:text-[13px] [&_.tw-admin-muted]:leading-[1.5]

          [&_>_.tw-admin-badge]:whitespace-nowrap">
        <div>
          <SectionLabel>TEAM MANAGEMENT</SectionLabel>
          <h2>All teams</h2>
          <p className="copy tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Create teams, assign tracks, and manage membership.</p>
        </div>
        <Badge className="tw-admin-badge inline-flex items-center justify-center w-[fit-content] p-[5px_9px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-md

          [background:var(--raised)] text-fg text-[11px] font-semibold leading-[1.35] whitespace-nowrap
          max-w-full
 [font-family:inherit]">{data.teams.length} teams</Badge>
      </div>
      <form
        className="tw-admin-toolbar flex flex-wrap [align-items:end] gap-[14px] mb-[20px] p-[18px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card

          [background:var(--surface)]

          shadow-panel max-[700.001px]:items-stretch max-[700.001px]:gap-[12px] max-[700.001px]:p-[14px]

          [&_.tw-admin-input]:w-full [&_.tw-admin-input]:min-h-[44px] [&_.tw-admin-input]:text-[14px]

          [&_.tw-admin-input]:tracking-[normal] [&_.tw-admin-input]:normal-case

          [&_.tw-admin-input]:[font-family:inherit] [&_.tw-admin-input]:font-normal

          [&_.tw-admin-check]:min-h-[44px] [&_.tw-admin-check]:inline-flex [&_.tw-admin-check]:items-center

          [&_.tw-admin-check]:gap-[9px] [&_.tw-admin-check]:p-[0px_4px] [&_.tw-admin-check]:text-fg

          [&_.tw-admin-check]:text-[13px] [&_.tw-admin-check]:tracking-[normal] [&_.tw-admin-check]:normal-case

          max-[700.001px]:[&_.tw-admin-check]:[flex:1_1_100%] [&_>_button]:min-h-[44px] [&_>_button]:p-[0px_16px]

          [&_>_button]:whitespace-nowrap max-[700.001px]:[&_>_button]:[flex:1_1_auto]

          [&_.tw-admin-field]:[font-family:inherit] [&_.tw-admin-field]:text-[12px]

          [&_.tw-admin-field]:font-semibold [&_.tw-admin-field]:tracking-[0.02em] [&_.tw-admin-field]:normal-case

          max-[700.001px]:[&_.tw-admin-field]:[flex:1_1_100%] [&_select]:[font-family:inherit]

          [&_select]:text-[14px] [&_select]:font-normal [&_select]:tracking-[normal] [&_select]:normal-case

          [&.tw-admin-toolbar]:grid

          [&.tw-admin-toolbar]:[grid-template-columns:minmax(0px,_1fr)_minmax(0px,_0.8fr)_auto]

          [&.tw-admin-toolbar]:[align-items:end] [&.tw-admin-toolbar]:gap-[18px]

          [&.tw-admin-toolbar]:m-[0px_0px_28px] [&.tw-admin-toolbar]:p-[24px]

          [&.tw-admin-toolbar]:[background:var(--card)] [&.tw-admin-toolbar]:[border-width:1px]

          [&.tw-admin-toolbar]:[border-style:solid] [&.tw-admin-toolbar]:[border-top-color:var(--line)]

          [&.tw-admin-toolbar]:[border-right-color:var(--line)]

          [&.tw-admin-toolbar]:[border-bottom-color:var(--line)]

          [&.tw-admin-toolbar]:[border-left-color:var(--line)] [&.tw-admin-toolbar]:rounded-lg

          [&.tw-admin-toolbar]:[box-shadow:var(--shadow-e1)]

          max-[700.001px]:[&.tw-admin-toolbar]:[grid-template-columns:1fr_1fr]

          max-[700.001px]:[&.tw-admin-toolbar]:p-[18px] max-[600.001px]:[&.tw-admin-toolbar]:items-stretch

          max-[600.001px]:[&.tw-admin-toolbar]:flex-col

          max-[480.001px]:[&.tw-admin-toolbar]:[grid-template-columns:1fr]

          max-[480.001px]:[&.tw-admin-toolbar]:gap-[14px] max-[480.001px]:[&.tw-admin-toolbar]:p-[16px]

          [&.tw-admin-toolbar_.tw-admin-field]:flex [&.tw-admin-toolbar_.tw-admin-field]:flex-col

          [&.tw-admin-toolbar_.tw-admin-field]:gap-[9px] [&.tw-admin-toolbar_.tw-admin-field]:min-w-0

          [&.tw-admin-toolbar_.tw-admin-field]:text-[13px] [&.tw-admin-toolbar_.tw-admin-field]:font-bold

          max-[600.001px]:[&.tw-admin-toolbar_.tw-admin-field]:w-full [&.tw-admin-toolbar_.tw-admin-input]:w-full

          [&.tw-admin-toolbar_.tw-admin-input]:min-w-0 [&.tw-admin-toolbar_.tw-admin-input]:min-h-[44px]

          [&.tw-admin-toolbar_.tw-admin-input]:box-border [&.tw-admin-toolbar_.tw-admin-input]:p-[10px_12px]

          [&.tw-admin-toolbar_.tw-admin-input]:[border-width:1px]

          [&.tw-admin-toolbar_.tw-admin-input]:[border-style:solid]

          [&.tw-admin-toolbar_.tw-admin-input]:[border-top-color:var(--line)]

          [&.tw-admin-toolbar_.tw-admin-input]:[border-right-color:var(--line)]

          [&.tw-admin-toolbar_.tw-admin-input]:[border-bottom-color:var(--line)]

          [&.tw-admin-toolbar_.tw-admin-input]:[border-left-color:var(--line)]

          [&.tw-admin-toolbar_.tw-admin-input]:rounded-md [&.tw-admin-toolbar_button]:min-h-[44px]

          [&.tw-admin-toolbar_button]:p-[0px_22px] [&.tw-admin-toolbar_button]:rounded-md

          [&.tw-admin-toolbar_button]:font-bold [&.tw-admin-toolbar_button]:whitespace-nowrap

          [&.tw-admin-toolbar_button]:[transition:transform_150ms,_filter_150ms]

          max-[700.001px]:[&.tw-admin-toolbar_button]:w-full

          [&.tw-admin-toolbar_button:hover]:[filter:brightness(1.06)]

          [&.tw-admin-toolbar_button:hover]:[transform:translateY(-1px)]

          max-[700.001px]:[&.tw-admin-toolbar_.tw-admin-field:first-child]:[grid-column:1_/_-1]

          max-[480.001px]:[&.tw-admin-toolbar_.tw-admin-field:first-child]:[grid-column:auto]"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          void call('/teams', 'POST', { name: text(f, 'name'), trackId: text(f, 'trackId') || null }).then(async (r) => {
            if (await done(r, 'Team created.')) form.reset();
          });
        }}
      >
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          New team
          <Input name="name" required maxLength={60} className="tw-admin-input w-full" />
        </Label>
        <TrackSelect tracks={data.tracks} name="trackId" label="Track" value={null} />
        <Button type="submit">Create team</Button>
      </form>
      {data.teams.map((t) => (
        <section key={t.id} aria-label={`Team ${t.name}`} className="tw-admin-tile

          [background:var(--surface)]

          [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card p-[20px] relative flex

          flex-col items-start min-w-0 min-h-[150px] overflow-hidden shadow-panel

          [transition:border-color_180ms_var(--ease),_transform_180ms_var(--ease)] max-[600.001px]:p-[16px_14px]

          max-[600.001px]:min-h-[132px]

          [&:hover]:[border-color:color-mix(in_srgb,_var(--accent)_40%,_var(--line))]

          [&:hover]:[transform:translateY(-2px)] [&.tw-admin-tile]:mt-[8px] [&.tw-admin-tile]:p-[0px_14px]

          [&.tw-admin-tile]:[background:var(--card)] [&.tw-admin-tile]:[border-width:1px]

          [&.tw-admin-tile]:[border-style:solid] [&.tw-admin-tile]:[border-top-color:var(--line)]

          [&.tw-admin-tile]:[border-right-color:var(--line)] [&.tw-admin-tile]:[border-bottom-color:var(--line)]

          [&.tw-admin-tile]:[border-left-color:var(--line)] [&.tw-admin-tile]:rounded-lg

          [&.tw-admin-tile]:[box-shadow:var(--shadow-e2)]

          [&.tw-admin-tile]:[transition:border-color_160ms] [&.tw-admin-tile]:block
          [&.tw-admin-tile]:min-h-[70px]
 [&.tw-admin-tile]:h-auto [&.tw-admin-tile]:overflow-visible

          [&.tw-admin-tile:hover]:[border-color:color-mix(in_srgb,_var(--accent)_35%,_var(--line))]

          [&.tw-admin-tile_.tw-admin-teamBody_>_form]:items-end [&.tw-admin-tile_.tw-admin-teamBody_>_ul]:list-none [&.tw-admin-tile_.tw-admin-teamBody_>_ul]:m-[20px_0px]

          [&.tw-admin-tile_.tw-admin-teamBody_>_ul]:p-0 [&.tw-admin-tile_.tw-admin-teamBody_>_ul]:[border-top-width:1px]

          [&.tw-admin-tile_.tw-admin-teamBody_>_ul]:[border-top-style:solid] [&.tw-admin-tile_.tw-admin-teamBody_>_ul]:[border-top-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-teamBody_>_ul_>_li]:p-[12px_0px] [&.tw-admin-tile_.tw-admin-teamBody_>_ul_>_li]:[border-bottom-width:1px]

          [&.tw-admin-tile_.tw-admin-teamBody_>_ul_>_li]:[border-bottom-style:solid]

          [&.tw-admin-tile_.tw-admin-teamBody_>_ul_>_li]:[border-bottom-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-field]:min-w-[180px] [&.tw-admin-tile_.tw-admin-muted]:text-[12px]

          [&.tw-admin-tile_button]:whitespace-nowrap [&.tw-admin-tile_.tw-admin-teamHeaderForm]:flex

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:flex-wrap

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:items-end

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:gap-[10px]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:m-[0px_0px_16px]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:p-[0px_0px_14px]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:[border-bottom-width:1px]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:[border-bottom-style:solid]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:[border-bottom-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:[background:transparent]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm]:[box-shadow:none]

          max-[600.001px]:[&.tw-admin-tile_.tw-admin-teamHeaderForm]:[flex-flow:column_wrap]

          max-[600.001px]:[&.tw-admin-tile_.tw-admin-teamHeaderForm]:items-stretch

          [&.tw-admin-tile_.tw-admin-teamHeaderForm_.tw-admin-field]:[flex:1_1_180px]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm_.tw-admin-field]:min-w-0

          [&.tw-admin-tile_.tw-admin-teamHeaderForm_.tw-admin-field]:gap-[6px]

          max-[600.001px]:[&.tw-admin-tile_.tw-admin-teamHeaderForm_.tw-admin-field]:w-full

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field]:flex [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field]:flex-col

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field]:gap-[6px]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field]:w-[min(100%,_360px)]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field]:m-0 [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:block

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:w-full

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:min-h-[44px]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:box-border

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:p-[10px_36px_10px_12px]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:[border-width:1px]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:[border-style:solid]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:[border-top-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:[border-right-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:[border-bottom-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:[border-left-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-teamBody_>_label.tw-admin-field_select]:rounded-md

          [&.tw-admin-tile_.tw-admin-memberList]:m-[12px_0px_0px] [&.tw-admin-tile_.tw-admin-addMemberForm]:flex

          [&.tw-admin-tile_.tw-admin-addMemberForm]:items-end [&.tw-admin-tile_.tw-admin-addMemberForm]:flex-wrap

          [&.tw-admin-tile_.tw-admin-addMemberForm]:gap-[10px]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:m-[12px_0px_0px]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:p-[12px]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:[background:color-mix(in_srgb,_var(--accent)_3%,_var(--card))]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:[border-width:1px]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:[border-style:solid]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:[border-top-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:[border-right-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:[border-bottom-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:[border-left-color:var(--line)]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:rounded-md

          [&.tw-admin-tile_.tw-admin-addMemberForm]:[box-shadow:none]

          [&.tw-admin-tile_.tw-admin-addMemberForm]:text-[13px]

          [&.tw-admin-tile_.tw-admin-addMemberForm_.tw-admin-field]:[flex:1_1_220px]

          [&.tw-admin-tile_.tw-admin-addMemberForm_.tw-admin-field]:min-w-0

          [&.tw-admin-tile_.tw-admin-addMemberForm_select]:w-full

          [&.tw-admin-tile_.tw-admin-addMemberForm_select]:min-h-[44px]

          [&.tw-admin-tile_.tw-admin-addMemberForm_select]:box-border

          [&.tw-admin-tile_.tw-admin-memberRow]:text-[13px]

          [&.tw-admin-tile_.tw-admin-addMemberForm_.tw-admin-input]:text-[13px]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm_.tw-admin-input]:min-h-[44px]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm_.tw-admin-input]:p-[8px_10px]

          [&.tw-admin-tile_.tw-admin-teamHeaderForm_.tw-admin-input]:box-border">
          <details className="group">
            <summary className="flex min-h-[44px] w-full cursor-pointer list-none items-center gap-[12px] rounded-md py-[12px]
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[16px] gap-y-[8px]">
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{t.name}</span>
                <span className="min-w-0 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
                  {data.tracks.find((track) => track.id === t.trackId)?.name ?? 'No track'}
                </span>
                <span className="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">{t.members.length} / 4</span>
                <span className="tw-admin-teamCode inline-flex items-center gap-[8px] p-[8px_12px]

              [background:color-mix(in_srgb,_var(--accent)_5%,_var(--card))] [border-width:1px] [border-style:solid]

              [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

              [border-left-color:var(--line)] rounded-control text-[10px]! font-extrabold tracking-[0.08em]

              whitespace-nowrap [&_strong]:text-fg [&_strong]:text-[13px] [&_strong]:tracking-[0.04em]

              [&_strong]:tabular-nums tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">
                  TEAM CODE <strong>{code(t.code)}</strong>
                </span>
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="size-4 shrink-0 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="tw-admin-teamBody pb-[14px]">
              <form
                className="tw-admin-teamHeaderForm flex items-end flex-wrap gap-[12px] pb-[18px] [border-bottom-width:1px]

              [border-bottom-style:solid] [border-bottom-color:var(--line)] max-[600.001px]:items-stretch

              max-[600.001px]:[flex-flow:column_wrap] [&_.tw-admin-field]:flex-1 [&_.tw-admin-field]:min-w-[180px]

              max-[600.001px]:[&_.tw-admin-field]:min-w-0 max-[600.001px]:[&_.tw-admin-field]:w-full

              [&_.tw-admin-muted]:[align-self:center] [&_.tw-admin-muted]:m-[0px_4px] [&_button]:whitespace-nowrap

              max-[600.001px]:[&_.tw-admin-teamCode]:[align-self:flex-start]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void call(`/teams/${t.id}`, 'PATCH', { name: text(new FormData(e.currentTarget), 'name') }).then((r) => done(r, 'Team renamed.'));
                }}
              >
                <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
                  Team name
                  <Input name="name" defaultValue={t.name} required maxLength={60} className="tw-admin-input w-full" />
                </Label>
                <Button type="submit" variant="outline">
                  Rename
                </Button>
                <Button type="button" variant="ghost" className="tw-admin-danger text-destructive hover:bg-destructive/10" onClick={() => setDeleting({ kind: 'teams', id: t.id, name: t.name })}>
                  Delete team
                </Button>
              </form>
              <TrackSelect
                // Keyed by its track: the select is uncontrolled, so a change made elsewhere redraws it.
                key={t.trackId ?? 'none'}
                tracks={data.tracks}
                label={`Track of ${t.name}`}
                value={t.trackId}
                onChange={(trackId) => void call(`/teams/${t.id}`, 'PATCH', { trackId }).then((r) => done(r, 'Track saved.'))}
              />
              <ul className="tw-admin-memberList flex flex-col gap-0 list-none m-[20px_0px] p-0 [border-top-width:1px]

              [border-top-style:solid] [border-top-color:var(--line)]">
                {t.members.map((m) => (
                  <li key={m.id} className="tw-admin-memberRow flex items-center flex-wrap gap-[12px] p-[14px_0px] [border-bottom-width:1px]

              [border-bottom-style:solid] [border-bottom-color:var(--line)] max-[600.001px]:gap-[8px]

              [&_>_:first-child]:mr-[auto] [&_>_:first-child]:font-semibold [&_.tw-admin-badge]:text-[11px]

              [&_button]:whitespace-nowrap">
                    <span>{m.displayName}</span>
                    {m.status !== 'accepted' && <Badge className="tw-admin-badge inline-flex items-center justify-center w-[fit-content] p-[5px_9px] [border-width:1px]

              [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

              [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-md

              [background:var(--raised)] text-fg text-[11px] font-semibold leading-[1.35] whitespace-nowrap
              max-w-full
     [font-family:inherit] tw-admin-badgeWarn

              [&.tw-admin-badgeWarn]:[border-color:color-mix(in_srgb,_var(--warn,_#fbbf24)_40%,_var(--line))]

              [&.tw-admin-badgeWarn]:[background:color-mix(in_srgb,_var(--warn,_#fbbf24)_10%,_var(--card))]

              [&.tw-admin-badgeWarn]:[color:var(--warn,_#fbbf24)]">{m.status}</Badge>}
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`Remove ${m.displayName} from ${t.name}`}
                      onClick={() => void call(`/participants/${m.id}`, 'PATCH', { teamId: null }).then((r) => done(r, `Removed ${m.displayName}.`))}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              {t.members.length < 4 && data.unassigned.length > 0 && (
                <form
                  className="tw-admin-addMemberForm flex items-end flex-wrap gap-[12px] mt-[20px] p-[16px]

              [background:color-mix(in_srgb,_var(--accent)_3%,_var(--card))] [border-width:1px] [border-style:solid]

              [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

              [border-left-color:var(--line)] rounded-card max-[600.001px]:items-stretch

              max-[600.001px]:[flex-flow:column_wrap] [&_.tw-admin-field]:flex-1 [&_.tw-admin-field]:min-w-[200px]

              max-[600.001px]:[&_.tw-admin-field]:min-w-0 max-[600.001px]:[&_.tw-admin-field]:w-full

              [&_button]:min-h-[44px] [&_button]:whitespace-nowrap max-[600.001px]:[&_button]:w-full"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const id = text(new FormData(e.currentTarget), 'participantId');
                    void call(`/participants/${id}`, 'PATCH', { teamId: t.id }).then((r) => done(r, 'Member added.'));
                  }}
                >
                  <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
                    Add to {t.name}
                    <NativeSelect name="participantId" required className="tw-admin-input w-full" defaultValue="">
                      <option value="" disabled>
                        Pick a hacker
                      </option>
                      {data.unassigned.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                          {u.looking ? ' (looking)' : ''}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Button type="submit" className="min-h-[44px] p-[0px_12px] text-[14px]">
                    Add
                  </Button>
                </form>
              )}
            </div>
          </details>
        </section>
      ))}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={<p>{deleting.kind === 'teams' ? 'Its members will be without a team.' : 'Teams that picked this track will have none.'}</p>}
          confirmLabel={deleting.kind === 'teams' ? 'Delete team' : 'Delete track'}
          danger
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function TrackSelect(props: { tracks: Track[]; label: string; value: string | null; name?: string; onChange?: (trackId: string | null) => void }) {
  return (
    <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
      {props.label}
      <NativeSelect name={props.name} className="tw-admin-input w-full" defaultValue={props.value ?? ''} onChange={(e) => props.onChange?.(e.target.value || null)}>
        <option value="">No track</option>
        {props.tracks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </NativeSelect>
    </Label>
  );
}
