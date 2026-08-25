-- +goose Up
alter table attachments
    add column deletion_pending_at timestamptz,
    add column deletion_attempts integer not null default 0,
    add column deletion_error text;

alter table attachments drop constraint attachments_post_id_fkey;
alter table attachments
    add constraint attachments_post_id_fkey
    foreign key (post_id) references posts(id) on delete set null;

create index attachments_deletion_pending
    on attachments (deletion_pending_at, id)
    where deletion_pending_at is not null;

-- +goose StatementBegin
create function mark_post_attachments_for_deletion()
returns trigger
language plpgsql
as $$
begin
    update attachments
    set post_id = null,
        deletion_pending_at = coalesce(deletion_pending_at, now()),
        deletion_error = null
    where post_id = old.id;
    return old;
end;
$$;
-- +goose StatementEnd

create trigger posts_mark_attachments_for_deletion
before delete on posts
for each row execute function mark_post_attachments_for_deletion();

-- +goose Down
drop trigger if exists posts_mark_attachments_for_deletion on posts;
drop function if exists mark_post_attachments_for_deletion();
drop index if exists attachments_deletion_pending;

alter table attachments drop constraint attachments_post_id_fkey;
alter table attachments
    add constraint attachments_post_id_fkey
    foreign key (post_id) references posts(id);

alter table attachments
    drop column deletion_error,
    drop column deletion_attempts,
    drop column deletion_pending_at;
