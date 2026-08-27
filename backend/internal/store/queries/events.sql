-- name: ListChangeEventsAfter :many
select id, event_type, channel_id, post_id, thread_root_id, created_at
from change_events
where id > sqlc.arg('after_id')::bigint
order by id asc
limit sqlc.arg('row_limit');

-- name: LatestChangeEventID :one
select coalesce(max(id), 0)::bigint
from change_events;

-- name: ChangeEventBounds :one
select
    coalesce(max(id), 0)::bigint as latest_id,
    coalesce((
        select pruned_through
        from change_event_retention
        where singleton
    ), 0)::bigint as pruned_through
from change_events;

-- name: PruneChangeEventsBefore :one
with latest as (
    select coalesce(max(id), 0)::bigint as id
    from change_events
), deleted as (
    delete from change_events
    using latest
    where change_events.created_at < sqlc.arg('cutoff')::timestamptz
      and change_events.id < latest.id
    returning change_events.id
), deleted_max as (
    select coalesce(max(id), 0)::bigint as id
    from deleted
), retention as (
    insert into change_event_retention (singleton, pruned_through)
    select true, id from deleted_max
    on conflict (singleton) do update
    set pruned_through = greatest(
        change_event_retention.pruned_through,
        excluded.pruned_through
    )
    returning pruned_through
)
select count(*)::bigint
from deleted
cross join retention;
