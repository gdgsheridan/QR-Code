// The attendee pages (§15): Atom, the rocket and smooth scrolling live here, never on staff pages, passes or badges.
export const isAttendeePage = (pathname: string) =>
  pathname === '/me' || pathname.startsWith('/me/') || ['/rsvp', '/login', '/set-password', '/auth/confirm'].includes(pathname);
