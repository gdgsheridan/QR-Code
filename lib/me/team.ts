import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail } from '@/lib/domain/normalize';
import { generateJoinCode, normalizeJoinCode, parseTeamName } from '@/lib/domain/team';
import type { MyEvent } from './profile';

type Db = SupabaseClient<Database>;
type Account = { id: string; email?: string | null };

// SPEC F15 (v0.7): what the team_* SQL functions answer; INVALID_NAME is caught here before any call.
const TEAM_CODES = ['CREATED', 'JOINED', 'LEFT', 'SAVED', 'IN_A_TEAM', 'NAME_TAKEN', 'BAD_CODE', 'TEAM_FULL', 'CLOSED', 'NOT_RELEASED', 'NOT_FOUND', 'INVITED', 'ALREADY_INVITED', 'NOT_LOOKING', 'SELF', 'DECLINED', 'BAD_TRACK', 'REMOVED', 'RATE_LIMITED'] as const;
export type TeamCode = (typeof TEAM_CODES)[number] | 'INVALID_NAME';

// The functions act only on the row whose email is the account's, so a forged participant id changes nothing.
function own(user: Account, participantId: string) {
  if (!user.email || !z.uuid().safeParse(participantId).success) return null;
  return { p_participant_id: participantId, p_email: normalizeEmail(user.email), p_user_id: user.id };
}

function code(fn: string, r: { data: unknown; error: { code: string } | null }): TeamCode {
  if (r.error) throw new Error(`${fn} failed (${r.error.code})`);
  return z.enum(TEAM_CODES).parse(r.data);
}

export async function createTeam(db: Db, user: Account, participantId: string, name: string): Promise<TeamCode> {
  const teamName = parseTeamName(name);
  if (!teamName) return 'INVALID_NAME';
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  return code('team_create', await db.rpc('team_create', { ...me, p_name: teamName, p_code: generateJoinCode() }));
}

export async function joinTeam(db: Db, user: Account, participantId: string, how: { code: string } | { teamId: string }): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  if ('teamId' in how) {
    if (!z.uuid().safeParse(how.teamId).success) return 'BAD_CODE';
    return code('team_join', await db.rpc('team_join', { ...me, p_team_id: how.teamId }));
  }
  const joinCode = normalizeJoinCode(how.code);
  if (!joinCode) return 'BAD_CODE';
  return code('team_join', await db.rpc('team_join', { ...me, p_code: joinCode }));
}

export async function leaveTeam(db: Db, user: Account, participantId: string): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  return code('team_leave', await db.rpc('team_leave', me));
}

// v0.11.44 (F15): any member takes another off the team while forming is open; the team gets a new join code.
export async function removeTeammate(db: Db, user: Account, participantId: string, memberId: string): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me || !z.uuid().safeParse(memberId).success) return 'NOT_FOUND';
  return code('team_remove', await db.rpc('team_remove', { ...me, p_member_id: memberId, p_code: generateJoinCode() }));
}

// v0.11.50 (owner's request): a team's tracks are a list, any number of them; none clears it.
export async function setTeamTracks(db: Db, user: Account, participantId: string, trackIds: string[]): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  if (!trackIds.every((id) => z.uuid().safeParse(id).success)) return 'BAD_TRACK';
  return code('team_set_tracks', await db.rpc('team_set_tracks', { ...me, p_track_ids: [...new Set(trackIds)] }));
}

export async function inviteTeammate(db: Db, user: Account, participantId: string, inviteeId: string): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me || !z.uuid().safeParse(inviteeId).success) return 'NOT_FOUND';
  return code('team_invite', await db.rpc('team_invite', { ...me, p_invitee_id: inviteeId }));
}

export async function declineInvite(db: Db, user: Account, participantId: string, teamId: string): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me || !z.uuid().safeParse(teamId).success) return 'NOT_FOUND';
  const { data, error } = await db.from('participants').select('id').eq('id', participantId).eq('email', me.p_email)
    .eq('status', 'accepted').is('deleted_at', null).maybeSingle();
  if (error) throw new Error(`invite owner lookup failed (${error.code})`);
  if (!data) return 'NOT_FOUND';
  const result = await db.from('team_invites').delete().eq('participant_id', data.id).eq('team_id', teamId);
  if (result.error) throw new Error(`invite decline failed (${result.error.code})`);
  return 'DECLINED';
}

export async function setLooking(db: Db, user: Account, participantId: string, on: boolean): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  const { data, error } = await db.from('participants').update({ looking_for_team: on, ...(on && { team_status: 'looking' }) }).eq('id', participantId)
    .eq('email', me.p_email).eq('status', 'accepted').is('deleted_at', null).is('team_id', null).select('id, team_status').maybeSingle();
  if (error) throw new Error(`directory preference failed (${error.code})`);
  if (!data) return 'NOT_FOUND';
  // v0.11.25: the profile's team answer follows the switch, so the two never disagree.
  // v0.11.47: only while still teamless and not Looking, so an On tapped meanwhile (or a join) isn't undone.
  if (!on && data.team_status === 'looking') {
    const { error: statusError } = await db.from('participants').update({ team_status: 'solo' }).eq('id', participantId).eq('team_status', 'looking')
      .eq('looking_for_team', false).is('team_id', null);
    if (statusError) throw new Error(`team status update failed (${statusError.code})`);
  }
  return 'SAVED';
}

// v0.11.25: the Team page saves Looking and the tracks a hacker wants together. v0.11.47: the tracks first, so a
// refused save (a track deleted meanwhile, the event over) changes nothing.
export async function saveLooking(db: Db, user: Account, participantId: string, on: boolean, trackIds: string[]): Promise<TeamCode> {
  const tracks = await setTrackInterests(db, user, participantId, trackIds);
  return tracks === 'SAVED' ? setLooking(db, user, participantId, on) : tracks;
}

// v0.11.25 (F15): the tracks a hacker wants to do, any number, any time. Replaces their whole set.
export async function setTrackInterests(db: Db, user: Account, participantId: string, trackIds: string[]): Promise<TeamCode> {
  const me = own(user, participantId);
  if (!me) return 'NOT_FOUND';
  if (!trackIds.every((id) => z.uuid().safeParse(id).success)) return 'BAD_TRACK';
  return code('set_track_interests', await db.rpc('set_track_interests', { ...me, p_track_ids: [...new Set(trackIds)] }));
}

export interface MyTeam {
  invites: Array<{ teamId: string; teamName: string; from: string }>;
  tracks: Array<{ id: string; name: string }>;
  /** v0.11.25: the tracks this hacker wants to do. */
  myTrackIds: string[];
  team: { name: string; code: string; trackIds: string[]; members: Array<{ id: string; name: string }> } | null;
}

export interface TrackWithTeams {
  id: string | null;
  name: string;
  teams: Array<{ id: string; name: string; memberCount: number }>;
}

// `me` is authorized by myEvent(); unreleased tracks must never reach this tab.
export async function tracksWithTeams(db: Db, me: MyEvent): Promise<TrackWithTeams[] | null> {
  if (!me.event.tracksReleased) return null;
  const [tracks, teams] = await Promise.all([
    db.from('tracks').select('id, name').eq('event_id', me.eventId).order('name'),
    db.from('teams').select('id, name, team_tracks(track_id), participants(count)').eq('event_id', me.eventId)
      .eq('participants.event_id', me.eventId).is('participants.deleted_at', null).order('name'),
  ]);
  if (tracks.error) throw new Error(`tracks load failed (${tracks.error.code})`);
  if (teams.error) throw new Error(`track teams load failed (${teams.error.code})`);
  const groups: TrackWithTeams[] = tracks.data.map((t) => ({ ...t, teams: [] }));
  const unassigned: TrackWithTeams = { id: null, name: 'No track yet', teams: [] };
  const byTrack = new Map(groups.map((t) => [t.id, t]));
  for (const team of teams.data) {
    // v0.11.50: a team is on every track it picked.
    const groups = team.team_tracks.length === 0 ? [unassigned] : team.team_tracks.map((t) => byTrack.get(t.track_id));
    for (const group of groups) group?.teams.push({ id: team.id, name: team.name, memberCount: team.participants[0]?.count ?? 0 });
  }
  if (unassigned.teams.length > 0) groups.push(unassigned);
  return groups;
}

// /me/team: the event's tracks and the attendee's own team (teammates' names; ids only to mark the viewer). `me` comes from myEvent().
export async function myTeam(db: Db, me: MyEvent): Promise<MyTeam> {
  const [tracks, team, invites, mine] = await Promise.all([
    db.from('tracks').select('id, name').eq('event_id', me.eventId).order('created_at'),
    me.teamId
      ? db.from('teams').select('name, join_code, team_tracks(track_id), participants(id, first_name, last_name)').eq('id', me.teamId).eq('event_id', me.eventId).maybeSingle()
      : null,
    db.from('team_invites').select('team_id, teams!inner(name), participants!team_invites_invited_by_fkey(first_name)')
      .eq('participant_id', me.participantId).eq('event_id', me.eventId).order('created_at', { ascending: false }),
    db.from('participant_tracks').select('track_id').eq('participant_id', me.participantId),
  ]);
  if (mine.error) throw new Error(`track interests load failed (${mine.error.code})`);
  if (tracks.error) throw new Error(`tracks load failed (${tracks.error.code})`);
  if (team?.error) throw new Error(`team load failed (${team.error.code})`);
  if (invites.error) throw new Error(`invites load failed (${invites.error.code})`);
  // v0.11.47: their team only if they're still in it in this same read (removed since myEvent(): no team, no new code).
  const t = team?.data?.participants.some((p) => p.id === me.participantId) ? team.data : null;
  return {
    tracks: tracks.data,
    myTrackIds: mine.data.map((t) => t.track_id),
    invites: invites.data.map((i) => ({ teamId: i.team_id, teamName: i.teams.name, from: i.participants?.first_name ?? 'A teammate' })),
    team: t
      ? { name: t.name, code: t.join_code, trackIds: t.team_tracks.map((x) => x.track_id), members: t.participants.map((m) => ({ id: m.id, name: `${m.first_name} ${m.last_name}`.trim() })).toSorted((x, y) => x.name.localeCompare(y.name)) }
      : null,
  };
}
