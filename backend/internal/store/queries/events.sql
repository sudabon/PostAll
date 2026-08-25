-- name: ListChangeEventsAfter :many
select id, event_type, channel_id, post_id, thread_root_id, created_at
from change_events
where id > sqlc.arg('after_id')::bigint
order by id asc
limit sqlc.arg('row_limit');

-- name: LatestChangeEventID :one
select coalesce(max(id), 0)::bigint
from change_events;
