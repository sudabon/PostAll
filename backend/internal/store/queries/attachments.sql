-- name: InsertAttachment :one
insert into attachments (
    id, uploader_id, file_name, content_type, size_bytes, storage_key, checksum
) values (
    sqlc.arg('id'),
    sqlc.arg('uploader_id'),
    sqlc.arg('file_name'),
    sqlc.arg('content_type'),
    sqlc.arg('size_bytes'),
    sqlc.arg('storage_key'),
    sqlc.arg('checksum')
)
returning *;

-- name: GetAttachment :one
select * from attachments
where id = $1;

-- name: CompleteAttachment :one
update attachments
set completed_at = now()
where id = sqlc.arg('id')
  and uploader_id = sqlc.arg('uploader_id')
  and completed_at is null
returning *;

-- name: BindAttachment :execrows
update attachments
set post_id = sqlc.arg('post_id')
where id = sqlc.arg('id')
  and uploader_id = sqlc.arg('uploader_id')
  and completed_at is not null
  and post_id is null;

-- name: UnbindByPostID :exec
update attachments
set post_id = null
where post_id = $1;

-- name: ListAttachmentsByPostID :many
select * from attachments
where post_id = $1
  and completed_at is not null
order by created_at asc, id asc;

-- name: ListReapableAttachments :many
select a.*
from attachments a
left join posts p on p.id = a.post_id
where (a.post_id is null and a.created_at < sqlc.arg('older_than'))
   or (p.deleted_at is not null);

-- name: CountStorageKeyRefs :one
select count(*)::bigint
from attachments
where storage_key = $1;

-- name: DeleteAttachmentRow :exec
delete from attachments
where id = $1;
