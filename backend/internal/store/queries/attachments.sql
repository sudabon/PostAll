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
  and deletion_pending_at is null
returning *;

-- name: BindAttachment :execrows
update attachments
set post_id = sqlc.arg('post_id')
where id = sqlc.arg('id')
  and uploader_id = sqlc.arg('uploader_id')
  and completed_at is not null
  and post_id is null
  and deletion_pending_at is null;

-- name: UnbindByPostID :exec
update attachments
set post_id = null
where post_id = $1;

-- name: ListAttachmentsByPostID :many
select * from attachments
where post_id = $1
  and completed_at is not null
  and deletion_pending_at is null
order by created_at asc, id asc;

-- name: MarkReapableAttachmentsPending :exec
update attachments a
set post_id = null,
    deletion_pending_at = now(),
    deletion_error = null
where a.deletion_pending_at is null
  and (
    (a.post_id is null and a.created_at < sqlc.arg('older_than'))
    or exists (
      select 1 from posts p
      where p.id = a.post_id and p.deleted_at is not null
    )
  );

-- name: ListPendingAttachments :many
select * from attachments
where deletion_pending_at is not null
order by deletion_pending_at asc, id asc
limit sqlc.arg('row_limit');

-- name: RecordAttachmentDeletionFailure :exec
update attachments
set deletion_attempts = deletion_attempts + 1,
    deletion_error = left(sqlc.arg('deletion_error'), 2000)
where id = sqlc.arg('id')
  and deletion_pending_at is not null;

-- name: DeleteAttachmentRow :exec
delete from attachments
where id = $1
  and deletion_pending_at is not null;
