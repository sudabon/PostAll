-- name: InsertPost :one
insert into posts (channel_id, thread_root_id, author_id, body)
values (sqlc.arg('channel_id'), sqlc.narg('thread_root_id'), sqlc.arg('author_id'), sqlc.arg('body'))
returning id, channel_id, thread_root_id, author_id, body, created_at, updated_at, edited_at, deleted_at;

-- name: GetPost :one
select id, channel_id, thread_root_id, author_id, body, created_at, updated_at, edited_at, deleted_at
from posts
where id = $1;

-- name: UpdatePostBody :one
update posts
set body = sqlc.arg('body'),
    edited_at = now(),
    updated_at = now()
where id = sqlc.arg('id')
  and deleted_at is null
returning id, channel_id, thread_root_id, author_id, body, created_at, updated_at, edited_at, deleted_at;

-- name: SoftDeletePost :one
update posts
set deleted_at = now(),
    updated_at = now()
where id = sqlc.arg('id')
  and deleted_at is null
returning id, channel_id, thread_root_id, author_id, body, created_at, updated_at, edited_at, deleted_at;

-- name: ListTimelineLatest :many
select
    p.id,
    p.channel_id,
    p.thread_root_id,
    p.author_id,
    p.body,
    p.created_at,
    p.updated_at,
    p.edited_at,
    p.deleted_at,
    coalesce(s.reply_count, 0)::bigint as reply_count,
    s.last_reply_at
from posts p
left join (
    select thread_root_id,
           count(*)::bigint as reply_count,
           max(created_at) as last_reply_at
    from posts
    where deleted_at is null
      and thread_root_id is not null
    group by thread_root_id
) s on s.thread_root_id = p.id
where p.channel_id = sqlc.arg('channel_id')
  and p.thread_root_id is null
  and p.deleted_at is null
order by p.created_at desc, p.id desc
limit sqlc.arg('row_limit');

-- name: ListTimelineBefore :many
select
    p.id,
    p.channel_id,
    p.thread_root_id,
    p.author_id,
    p.body,
    p.created_at,
    p.updated_at,
    p.edited_at,
    p.deleted_at,
    coalesce(s.reply_count, 0)::bigint as reply_count,
    s.last_reply_at
from posts p
left join (
    select thread_root_id,
           count(*)::bigint as reply_count,
           max(created_at) as last_reply_at
    from posts
    where deleted_at is null
      and thread_root_id is not null
    group by thread_root_id
) s on s.thread_root_id = p.id
where p.channel_id = sqlc.arg('channel_id')
  and p.thread_root_id is null
  and p.deleted_at is null
  and (
    p.created_at < sqlc.arg('before_created_at')::timestamptz
    or (
      p.created_at = sqlc.arg('before_created_at')::timestamptz
      and p.id < sqlc.arg('before_id')::uuid
    )
  )
order by p.created_at desc, p.id desc
limit sqlc.arg('row_limit');

-- name: ListTimelineAround :many
select
    p.id,
    p.channel_id,
    p.thread_root_id,
    p.author_id,
    p.body,
    p.created_at,
    p.updated_at,
    p.edited_at,
    p.deleted_at,
    coalesce(s.reply_count, 0)::bigint as reply_count,
    s.last_reply_at
from posts target
join posts p on p.channel_id = target.channel_id
left join (
    select thread_root_id,
           count(*)::bigint as reply_count,
           max(created_at) as last_reply_at
    from posts
    where deleted_at is null
      and thread_root_id is not null
    group by thread_root_id
) s on s.thread_root_id = p.id
where target.id = sqlc.arg('around_id')::uuid
  and target.channel_id = sqlc.arg('channel_id')::uuid
  and target.thread_root_id is null
  and target.deleted_at is null
  and p.thread_root_id is null
  and p.deleted_at is null
  and (
    p.created_at < target.created_at
    or (p.created_at = target.created_at and p.id <= target.id)
  )
order by p.created_at desc, p.id desc
limit sqlc.arg('row_limit');

-- name: ListThreadReplies :many
select
    p.id,
    p.channel_id,
    p.thread_root_id,
    p.author_id,
    p.body,
    p.created_at,
    p.updated_at,
    p.edited_at,
    p.deleted_at,
    0::bigint as reply_count,
    null::timestamptz as last_reply_at
from posts p
where p.thread_root_id = sqlc.arg('thread_root_id')::uuid
  and p.deleted_at is null
order by p.created_at asc, p.id asc;

-- name: CountReplies :one
select count(*)::bigint
from posts
where thread_root_id = sqlc.arg('thread_root_id')::uuid
  and deleted_at is null;

-- name: LastReplyAt :one
select created_at
from posts
where thread_root_id = sqlc.arg('thread_root_id')::uuid
  and deleted_at is null
order by created_at desc, id desc
limit 1;
