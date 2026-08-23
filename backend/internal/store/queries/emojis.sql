-- name: GetEmojiByShortcode :one
select id, shortcode, storage_key, checksum, created_at
from emojis
where shortcode = $1;

-- name: GetEmojiByID :one
select id, shortcode, storage_key, checksum, created_at
from emojis
where id = $1;

-- name: InsertEmoji :one
insert into emojis (shortcode, storage_key, checksum)
values (sqlc.arg('shortcode'), sqlc.arg('storage_key'), sqlc.arg('checksum'))
returning id, shortcode, storage_key, checksum, created_at;

-- name: UpdateEmoji :one
update emojis
set storage_key = sqlc.arg('storage_key'),
    checksum = sqlc.arg('checksum')
where shortcode = sqlc.arg('shortcode')
returning id, shortcode, storage_key, checksum, created_at;

-- name: ListEmojis :many
select id, shortcode, storage_key, checksum, created_at
from emojis
order by shortcode asc;

-- name: InsertReaction :exec
insert into reactions (post_id, emoji_id, user_id)
values (sqlc.arg('post_id'), sqlc.arg('emoji_id'), sqlc.arg('user_id'))
on conflict (post_id, emoji_id, user_id) do nothing;

-- name: DeleteReaction :exec
delete from reactions
where post_id = sqlc.arg('post_id')
  and emoji_id = sqlc.arg('emoji_id')
  and user_id = sqlc.arg('user_id');

-- name: ListReactionRowsForPosts :many
select
    r.post_id,
    e.id as emoji_id,
    e.shortcode,
    e.storage_key,
    e.checksum,
    e.created_at as emoji_created_at,
    r.user_id,
    r.created_at as reacted_at
from reactions r
join emojis e on e.id = r.emoji_id
where r.post_id = any(sqlc.arg('post_ids')::uuid[])
order by r.post_id, r.created_at, e.id, r.user_id;
