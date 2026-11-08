// Client: rendered only inside the Leaderboard client component.
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEffect, useState } from 'react';
import type { HackerConnection } from '@/lib/admin/connection-admin';
import { adminUrl, errorText, useApi } from '../api';
import { ConfirmDialog } from '../dialog';

type Person = { id: string; name: string };
const STATE: Record<HackerConnection['state'], string> = { mutual: '● Connected', sent: '◌ One-way: waiting on them', received: '↩ One-way: they tapped' };

// F17 (v0.12.4, owner's request and decision): look a hacker up and remove a connection (both taps), e.g. a test or a
// joke pair. Below the board, so Full screen never shows it.
export function ManageConnections({ slug, onChange }: { slug: string; onChange: () => void }) {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Person[]>([]);
  const [person, setPerson] = useState<Person | null>(null);
  const [connections, setConnections] = useState<HackerConnection[] | null>(null);
  const [pending, setPending] = useState<HackerConnection | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Name search over accepted hackers, 300 ms after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || person?.name === q) return;
    const t = setTimeout(async () => {
      const r = await api<{ participants: Array<{ id: string; firstName: string; lastName: string }> }>(adminUrl(slug, `/participants?status=accepted&q=${encodeURIComponent(q)}`));
      if (r.ok) setMatches(r.data.participants.slice(0, 8).map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() })));
    }, 300);
    return () => clearTimeout(t);
  }, [api, slug, query, person]);

  async function open(p: Person) {
    setPerson(p);
    setQuery(p.name);
    setMatches([]);
    setMessage(null);
    const r = await api<{ connections: HackerConnection[] }>(adminUrl(slug, `/connections?participantId=${p.id}`));
    if (r.ok) setConnections(r.data.connections);
    else setMessage(`✕ ${errorText(r)}`);
  }

  async function remove(c: HackerConnection) {
    setPending(null);
    if (!person) return;
    const r = await api<{ removed: number }>(adminUrl(slug, '/connections'), { method: 'DELETE', body: { a: person.id, b: c.id } });
    if (!r.ok && r.status !== 404) return setMessage(`✕ ${errorText(r)}`);
    onChange();
    await open(person); // reloads their list (and clears any old notice), then says what happened
    setMessage(`✓ Removed ${person.name} ↔ ${c.name}.`);
  }

  return (
    <section aria-labelledby="manage-connections" className="grid gap-[14px] p-[20px] rounded-card [background:var(--card)] [border:1px_solid_var(--line)] max-[600.001px]:p-[16px]">
      <div>
        <h2 id="manage-connections" className="m-0 text-[1.08rem] tracking-[-0.02em]">Manage connections</h2>
        <p className="copy m-[6px_0px_0px] text-muted-foreground text-[0.88rem]">Find a hacker to see who they’re connected with, and remove a connection (both lose the point).</p>
      </div>
      <Label className="grid gap-2 text-sm text-muted-foreground">
        Hacker
        <Input className="min-h-[44px]" placeholder="Type a name" value={query} onChange={(e) => { setQuery(e.target.value); setPerson(null); setConnections(null); }} />
      </Label>
      {matches.length > 0 && !person && (
        <ul className="m-0 p-0 list-none grid gap-[6px]" aria-label="Matching hackers">
          {matches.map((m) => (
            <li key={m.id}><Button type="button" variant="outline" size="sm" onClick={() => void open(m)}>{m.name}</Button></li>
          ))}
        </ul>
      )}
      {message && <p role="status" className="m-0 text-[13px]">{message}</p>}
      {person && connections && (
        connections.length === 0 ? <p className="m-0 text-muted-foreground">{person.name} has no connections.</p> : (
          <ul className="m-0 p-0 list-none grid" aria-label={`${person.name}’s connections`}>
            {connections.map((c) => (
              <li key={c.id} aria-label={c.name} className="flex flex-wrap items-center gap-[6px_12px] min-h-[52px] py-[6px] [border-top:1px_solid_var(--line)]">
                <span className="flex-1 min-w-[10ch] font-semibold [overflow-wrap:anywhere]">{c.name}</span>
                <span className={`text-[12px] ${c.state === 'mutual' ? 'text-accent' : 'text-muted-foreground'}`}>{STATE[c.state]}</span>
                <Button type="button" variant="outline" size="sm" aria-label={`Remove ${person.name} and ${c.name}’s connection`} onClick={() => setPending(c)}>Remove</Button>
              </li>
            ))}
          </ul>
        )
      )}
      {pending && person && (
        <ConfirmDialog
          title="Remove this connection?"
          body={<p className="copy">{person.name} and {pending.name} stop being connected{pending.state === 'mutual' ? ', and both lose the point' : ''}. If they tap each other’s badges again, it comes back.</p>}
          confirmLabel="Remove connection"
          danger
          onConfirm={() => void remove(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}
