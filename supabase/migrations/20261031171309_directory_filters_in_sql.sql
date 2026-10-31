-- SPEC F16 step 4 (v0.11.25): the name search, the pace filter and leaving out the viewer's own names-only
-- row happen here, before the limit (they ran in TypeScript after a 500-row cap, so above ~550 hackers a
-- search missed people). The page asks for as many rows as it shows plus one, to know whether there are more.
drop function public.hacker_directory(uuid, text, boolean);
create function public.hacker_directory(p_event_id uuid, p_email text, p_looking boolean default false,
  p_query text default '', p_pace text default null, p_limit int default 50)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(entry order by name, id), '[]'::jsonb) from (
    select pa.id, concat_ws(' ', pa.first_name, nullif(pa.last_name, '')) as name,
      jsonb_build_object('id', pa.id, 'name', concat_ws(' ', pa.first_name, nullif(pa.last_name, '')))
      || case when pa.directory_opt_in then jsonb_build_object(
        'bio', pa.bio, 'pace', pa.pace, 'teamName', t.name,
        'looking', pa.looking_for_team and pa.team_id is null,
        'linkedinUrl', pa.linkedin_url, 'discord', pa.discord_username, 'websiteUrl', pa.website_url
      ) else '{}'::jsonb end as entry
    from participants pa
    left join teams t on t.id = pa.team_id and t.event_id = pa.event_id
    where pa.event_id = p_event_id and pa.status = 'accepted' and pa.deleted_at is null
      and (pa.directory_opt_in or (p_looking and pa.looking_for_team and pa.team_id is null))
      and (not p_looking or (pa.looking_for_team and pa.team_id is null))
      -- The viewer's own full card shows, marked (you); their own names-only Looking row doesn't (F15 step 7).
      and (pa.directory_opt_in or pa.email <> lower(btrim(p_email)))
      -- p_query is already toSearchText()-normalized by the app (I-12), like search_text.
      and (coalesce(p_query, '') = '' or pa.search_text like '%' || p_query || '%')
      and (p_pace is null or (pa.directory_opt_in and pa.pace = p_pace))
      and exists (
        select 1 from participants viewer join events e on e.id = viewer.event_id
        where viewer.event_id = p_event_id and viewer.email = lower(btrim(p_email))
          and viewer.status = 'accepted' and viewer.deleted_at is null
          and e.ends_at > now() - interval '30 days'
      )
    order by name, pa.id
    limit least(greatest(coalesce(p_limit, 50), 1), 1001)
  ) people
$$;
revoke all on function public.hacker_directory(uuid, text, boolean, text, text, int) from public, anon, authenticated;
grant execute on function public.hacker_directory(uuid, text, boolean, text, text, int) to service_role;
