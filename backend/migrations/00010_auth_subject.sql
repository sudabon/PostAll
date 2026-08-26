-- +goose Up
alter table users rename column cognito_sub to auth_subject;

-- +goose StatementBegin
do $$
begin
    if exists (
        select 1
          from pg_constraint
         where conrelid = 'users'::regclass
           and conname = 'users_cognito_sub_key'
    ) then
        alter table users rename constraint users_cognito_sub_key to users_auth_subject_key;
    end if;
end $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $$
begin
    if exists (
        select 1
          from pg_constraint
         where conrelid = 'users'::regclass
           and conname = 'users_auth_subject_key'
    ) then
        alter table users rename constraint users_auth_subject_key to users_cognito_sub_key;
    end if;
end $$;
-- +goose StatementEnd

alter table users rename column auth_subject to cognito_sub;
