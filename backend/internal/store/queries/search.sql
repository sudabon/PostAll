-- name: SearchPostsLatest :many
select
    p.id as post_id,
    coalesce(p.thread_root_id, p.id)::uuid as timeline_post_id,
    p.channel_id,
    c.name as channel_name,
    p.thread_root_id,
    p.body,
    p.created_at
from posts p
join channels c on c.id = p.channel_id
where p.deleted_at is null
  and p.body ilike sqlc.arg('search_query')
  and (sqlc.narg('channel_id')::uuid is null or p.channel_id = sqlc.narg('channel_id')::uuid)
  and (sqlc.narg('created_from')::timestamptz is null or p.created_at >= sqlc.narg('created_from')::timestamptz)
  and (sqlc.narg('created_to')::timestamptz is null or p.created_at <= sqlc.narg('created_to')::timestamptz)
order by p.created_at desc, p.id desc
limit sqlc.arg('row_limit');

-- name: SearchPostsBefore :many
select
    p.id as post_id,
    coalesce(p.thread_root_id, p.id)::uuid as timeline_post_id,
    p.channel_id,
    c.name as channel_name,
    p.thread_root_id,
    p.body,
    p.created_at
from posts p
join channels c on c.id = p.channel_id
where p.deleted_at is null
  and p.body ilike sqlc.arg('search_query')
  and (sqlc.narg('channel_id')::uuid is null or p.channel_id = sqlc.narg('channel_id')::uuid)
  and (sqlc.narg('created_from')::timestamptz is null or p.created_at >= sqlc.narg('created_from')::timestamptz)
  and (sqlc.narg('created_to')::timestamptz is null or p.created_at <= sqlc.narg('created_to')::timestamptz)
  and (
    p.created_at < sqlc.arg('before_created_at')::timestamptz
    or (
      p.created_at = sqlc.arg('before_created_at')::timestamptz
      and p.id < sqlc.arg('before_id')::uuid
    )
  )
order by p.created_at desc, p.id desc
limit sqlc.arg('row_limit');
