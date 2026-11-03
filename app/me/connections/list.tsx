import Link from 'next/link';
import type { MyConnections } from '@/lib/me/connections';

// SPEC F17: a hacker's mutual connections, newest first: the name opens their badge page, and their LinkedIn
// shows only while they share it. Rendered as text (React escaping); links open off-site without a referrer.
export function ConnectionList(props: { people: MyConnections['recent'] }) {
  return (
    <ul className="m-0 p-0 list-none grid [&_li_+_li]:[border-top-width:1px] [&_li_+_li]:[border-top-style:solid] [&_li_+_li]:[border-top-color:var(--line)]">
      {props.people.map((c) => {
        const name = `${c.firstName} ${c.lastName}`.trim();
        return (
          <li key={`${c.badgeUid ?? name}-${c.connectedAt}`} className="flex flex-wrap items-center justify-between gap-[4px_12px] min-h-[48px] py-[4px]">
            {c.badgeUid ? (
              <Link className="font-semibold text-fg min-h-[44px] inline-flex items-center" href={`/profile/${c.badgeUid}`}>
                {name}
              </Link>
            ) : (
              <span className="font-semibold">{name}</span>
            )}
            {c.linkedinUrl && (
              <a className="text-accent text-[14px] min-h-[44px] inline-flex items-center" href={c.linkedinUrl} rel="noopener noreferrer" aria-label={`LinkedIn: ${name}`}>
                LinkedIn
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
