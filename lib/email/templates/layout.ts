import { escapeHtml } from '@/lib/domain/html';
// SPEC §12: the website's look (app/globals.css, from sheridandatathon.com) in email-safe HTML: a navy page, a dark
// card, Fira Code and terminal-green buttons. Fira Code is loaded where mail apps allow web fonts (Apple Mail, iOS);
// elsewhere a system monospace stands in. Tables with bgcolor so Outlook keeps the colours, and inline styles only.
// Translucent site tokens (--edge, the button rings) are pre-mixed over the card, since many mail apps drop rgba.
// Every argument is HTML the caller has already escaped.
const FONT = "'Fira Code',ui-monospace,Menlo,Consolas,'Courier New',monospace";
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap';
const C = {
  page: '#05081a', hero: '#091642', card: '#0a1029', raised: '#0c1330', line: '#232d47',
  fg: '#e8f2ff', muted: '#8fa0c4', link: '#b8dcff',
  accent: '#34d399', accentInk: '#03120c', accentEdge: '#23856c', accentRing: '#19544f',
};

export const HEADLINE = `font-size:20px;line-height:1.35;font-weight:700;color:${C.fg}`;
export const MUTED = `color:${C.muted}`;

export const p = (html: string, style = '') => `<p style="margin:0 0 16px;${style}">${html}</p>`;

export const link = (href: string, text: string) => `<a href="${href}" style="color:${C.link};text-decoration:underline">${text}</a>`;

export const list = (items: string[]) =>
  `<ul style="margin:0 0 16px;padding-left:20px;color:${C.fg}">${items.map((i) => `<li style="margin:0 0 6px">${i}</li>`).join('')}</ul>`;

// Buttons and the QR sit centred: align="center" for older mail apps, margin auto for the rest.
const centred = (top: string) => ` align="center" style="border-spacing:0;margin:${top} auto 20px`;

/** A square, wide call-to-action button like the site's: solid terminal green, or green-outlined, framed by a thin
 *  outer ring (a padded table cell, since mail apps ignore outline and box-shadow). */
export function button(href: string, text: string, kind: 'primary' | 'secondary' = 'primary'): string {
  const [bg, fg, border] = kind === 'primary' ? [C.accent, C.accentInk, C.accent] : [C.card, C.accent, C.accentEdge];
  return `<table role="none" border="0"${centred('8px')}"><tr><td style="padding:3px;border:1.5px solid ${C.accentRing};border-radius:9px"><table role="none" border="0" style="border-spacing:0"><tr><td bgcolor="${bg}" style="padding:0;background:${bg};border:2px solid ${border};border-radius:6px"><a href="${href}" style="display:inline-block;min-width:220px;padding:16px 32px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;text-align:center;color:${fg};text-decoration:none">${text}</a></td></tr></table></td></tr></table>`;
}

/** When/Where rows in a raised box with a green edge, like the site's cards. */
export const details = (rows: [string, string][]) =>
  `<table role="none" width="100%" border="0" style="border-spacing:0;margin:0 0 20px"><tr><td bgcolor="${C.raised}" style="background:${C.raised};border:1px solid ${C.line};border-left:4px solid ${C.accent};border-radius:6px;padding:12px 16px">${rows
    .map(([k, v], i) => `<p style="margin:${i ? '6px' : '0'} 0 0"><span style="font-weight:700;color:${C.link}">${k}:</span> ${v}</p>`)
    .join('')}</td></tr></table>`;

/** The QR on an opaque white card: a dark background around the code would stop it scanning (§6.2). */
export const qr = (img: string) =>
  `<table role="none" border="0"${centred('0')}"><tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${C.line};border-radius:6px;padding:12px">${img}</td></tr></table>`;

/** The navy hero: the SD badge, SHERIDAN DATATHON and what this email is, on the site's ground colour.
 *  The logo is served by the app (public/email-logo.png), not attached: mail apps that block images show its alt text. */
const hero = (origin: string, title: string) =>
  `<tr><td bgcolor="${C.hero}" style="background:${C.hero};border:1px solid ${C.line};border-bottom:0;border-radius:6px 6px 0 0;padding:24px 24px 22px"><table role="none" width="100%" border="0" style="border-spacing:0"><tr><td width="56" style="padding:0;width:56px;vertical-align:middle"><img src="${escapeHtml(origin)}/email-logo.png" width="56" height="56" alt="Sheridan Datathon" style="display:block;width:56px;height:56px;border:0"></td><td style="padding:0 0 0 14px;vertical-align:middle"><p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.12em;color:${C.accent}">SHERIDAN DATATHON</p><p style="margin:2px 0 0;font-size:22px;line-height:1.25;font-weight:700;color:${C.fg}">${title}</p></td></tr></table></td></tr>`;

/** Atom, the datathon's astronaut, signs every email (the plain-text part too), waving beside his name.
 *  Served by the app (public/email-atom.png) like the logo. */
export const SIGN_OFF_TEXT = 'Waving from orbit,\nAtom and the Sheridan Datathon team';
const signOff = (origin: string) =>
  `<table role="none" border="0" style="border-spacing:0;margin:24px 0 0;width:100%;border-top:1px solid ${C.line}"><tr><td width="56" style="padding:14px 0 0;width:56px;vertical-align:middle"><img src="${escapeHtml(origin)}/email-atom.png" width="56" height="64" alt="Atom the astronaut waving hello" style="display:block;width:56px;height:64px;border:0"></td><td style="padding:14px 0 0 12px;vertical-align:middle;color:${C.muted}">Waving from orbit,<br>Atom and the Sheridan Datathon team</td></tr></table>`;

/** A whole email: the navy hero, one dark card holding the body and Atom's sign-off, and optional small print under it.
 *  The colour scheme is declared dark so mail apps don't invert it. */
export function emailPage(origin: string, title: string, body: string, footer = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><style>@import url('${FONT_CSS}');</style></head>
<body style="margin:0;padding:0;background:${C.page}" bgcolor="${C.page}">
<table role="none" width="100%" border="0" bgcolor="${C.page}" style="border-spacing:0;background:${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="none" width="100%" border="0" style="border-spacing:0;max-width:560px;font-family:${FONT};font-size:14px;line-height:1.65;color:${C.fg}">
${hero(origin, title)}
<tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 6px 6px;padding:28px 24px">
${body}
${signOff(origin)}
</td></tr>
${footer ? `<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${C.muted}">${footer}</td></tr>\n` : ''}</table>
</td></tr></table>
</body></html>`;
}
