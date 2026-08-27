-- name: GetUserByAuthSubject :one
select id, auth_subject, created_at, updated_at
from users
where auth_subject = $1;

-- name: InsertUserByAuthSubject :one
insert into users (auth_subject)
values ($1)
returning id, auth_subject, created_at, updated_at;

-- name: GetUserByID :one
select id, auth_subject, created_at, updated_at
from users
where id = $1;

-- name: ListChannels :many
select id, parent_id, name, sort_key, created_at, updated_at
from channels
order by parent_id nulls first, sort_key, id;

-- name: GetChannel :one
select id, parent_id, name, sort_key, created_at, updated_at
from channels
where id = $1;

-- name: ListSiblings :many
select id, parent_id, name, sort_key, created_at, updated_at
from channels
where parent_id is not distinct from sqlc.narg('parent_id')::uuid
order by sort_key, id;

-- name: InsertChannel :one
insert into channels (parent_id, name, sort_key)
values (sqlc.narg('parent_id')::uuid, sqlc.arg('name'), sqlc.arg('sort_key'))
returning id, parent_id, name, sort_key, created_at, updated_at;

-- name: RenameChannel :one
update channels
set name = sqlc.arg('name'), updated_at = now()
where id = sqlc.arg('id')
returning id, parent_id, name, sort_key, created_at, updated_at;

-- name: UpdateChannelLocation :one
update channels
set parent_id = sqlc.narg('parent_id')::uuid,
    sort_key = sqlc.arg('sort_key'),
    updated_at = now()
where id = sqlc.arg('id')
returning id, parent_id, name, sort_key, created_at, updated_at;

-- name: DeleteChannel :exec
delete from channels
where id = $1;

