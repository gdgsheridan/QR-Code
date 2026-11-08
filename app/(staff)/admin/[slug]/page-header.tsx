import type { ReactNode } from 'react';

// Every admin tab's title row (owner's request: one look on every tab): the title and a one-line description on the
// left, the tab's own actions on the right, the layout's rule underneath; stacked on a phone. Inside a grid page the
// grid's gap already spaces it, so the bottom margin shrinks to match the other tabs. The actions keep their width,
// so the description wraps instead of the buttons stacking at in-between sizes.
export function PageHeader({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-[28px] flex items-end justify-between gap-[20px] border-b border-[var(--line)] pb-[18px] [.grid>&]:mb-[4px]
      max-[600.001px]:mb-[22px] max-[600.001px]:flex-col max-[600.001px]:items-stretch max-[600.001px]:pb-[14px] max-[600.001px]:[.grid>&]:mb-0">
      <div className="min-w-0">
        <h1 className="m-0! border-0! p-0!">{title}</h1>
        <p className="m-[8px_0px_0px] max-w-[680px] text-muted-foreground text-[14px] leading-[1.5]">{description}</p>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-[8px] max-[600.001px]:[&>*]:flex-1">{children}</div>}
    </div>
  );
}
