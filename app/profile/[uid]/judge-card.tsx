import { Button } from '@/components/ui/button';
import { LinkedInIcon } from '@/app/me/icons';
import { ACTION, ICON, LABEL, LABEL_TEXT, linkedinLabel, ROW, VALUE } from './rows';

// SPEC §11 Judges (v0.12.4): what a judge's badge, and their own page (/judge/<id>), show: "Judge", name, title, LinkedIn.
export function JudgeCard({ judge }: { judge: { name: string; title: string | null; linkedinUrl: string | null } }) {
  return (
    <>
      <header className="grid gap-[4px]">
        <p className="m-0 text-accent text-[12px] tracking-[0.12em] uppercase font-semibold">Judge</p>
        <h1 className="m-0 text-[28px] font-semibold leading-[1.2] [overflow-wrap:anywhere]">{judge.name}</h1>
        {judge.title && <p className="copy m-0 text-muted-foreground">{judge.title}</p>}
      </header>
      {judge.linkedinUrl && (
        <ul className="m-0 p-0 list-none grid">
          <li className={ROW}>
            <span className={LABEL}><LinkedInIcon className={ICON} /><span className={LABEL_TEXT}>LinkedIn</span></span>
            <span className={VALUE}>{linkedinLabel(judge.linkedinUrl)}</span>
            <Button variant="outline" size="sm" className={ACTION} asChild>
              <a href={judge.linkedinUrl} rel="noopener noreferrer" aria-label={`Open ${judge.name}’s LinkedIn profile`}>Open ↗</a>
            </Button>
          </li>
        </ul>
      )}
    </>
  );
}
