-- +goose Up
-- 本変更より前に論理削除されたポストの本文を消す。以後の削除は SoftDeletePost が
-- 同じ UPDATE で本文を空にする。deleted_at と thread_root_id は残し、削除済みで
-- あることとスレッドの構造を保つ。
-- posts_record_change トリガーが対象行の数だけ *.updated イベントを記録するが、
-- クライアントは該当チャネルを再取得するだけで、削除済みの行は表示に出ない。
update posts
set body = ''
where deleted_at is not null
  and body <> '';

-- +goose Down
-- 何もしない。消した本文はどこにも残っていないため、戻すことができない。
select 1;
