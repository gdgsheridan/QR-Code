// The badge page's link rows (v0.12.4), shared with a judge's card.
// "https://www.linkedin.com/in/ada-l/" → "in/ada-l" (accents decoded back for reading). LinkedIn's internal member ids
// ("in/ACoAAAT…") and other long handles read as noise, so they show as "LinkedIn profile".
export const linkedinLabel = (href: string) => {
  const path = new URL(href).pathname.replace(/\/$/, '').replace(/^\//, '');
  let label = path;
  try {
    label = decodeURIComponent(path);
  } catch {
    // keep the encoded form
  }
  return /^in\/ACo[A-Za-z0-9_-]{10,}$/.test(label) || label.length > 33 ? 'LinkedIn profile' : label;
};

export const ROW = 'flex flex-wrap items-center gap-[4px_12px] min-h-[60px] py-[8px] [border-top:1px_solid_var(--line)]';
// On a phone the icon alone names the row (the word stays for screen readers), leaving the value room.
export const LABEL = 'shrink-0 inline-flex items-center gap-[10px] sm:w-[112px] text-muted-foreground text-[12px] tracking-[0.08em] uppercase';
export const LABEL_TEXT = 'sr-only sm:not-sr-only';
export const ICON = 'w-[20px] h-[20px] shrink-0 text-accent';
export const VALUE = 'flex-1 min-w-[8ch] [overflow-wrap:anywhere] font-semibold';
export const ACTION = 'min-w-[88px]';
