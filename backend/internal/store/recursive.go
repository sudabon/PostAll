package store

import (
	"context"

	"github.com/google/uuid"
)

func (q *Queries) IsAncestorOf(ctx context.Context, rootID, targetID uuid.UUID) (bool, error) {
	const query = `
with recursive tree (channel_id) as (
    select id from channels where id = $1
    union all
    select c.id from channels c
    inner join tree t on c.parent_id = t.channel_id
)
select exists(select 1 from tree where channel_id = $2)`
	var ok bool
	err := q.db.QueryRow(ctx, query, rootID, targetID).Scan(&ok)
	return ok, err
}

// CountLivePostsInTree は、チャネル削除を阻むポスト数を数える。論理削除された
// 親ポストの返信はタイムラインから辿れず、削除済みのスレッドの一部として扱うため
// 数えない。
func (q *Queries) CountLivePostsInTree(ctx context.Context, id uuid.UUID) (int64, error) {
	const query = `
with recursive tree (channel_id) as (
    select id from channels where id = $1
    union all
    select c.id from channels c
    inner join tree t on c.parent_id = t.channel_id
)
select count(*)::bigint
from posts p
inner join tree t on p.channel_id = t.channel_id
left join posts root on root.id = p.thread_root_id
where p.deleted_at is null
  and (p.thread_root_id is null or root.deleted_at is null)`
	var n int64
	err := q.db.QueryRow(ctx, query, id).Scan(&n)
	return n, err
}

func (q *Queries) ListChannelTree(ctx context.Context) ([]Channel, error) {
	const query = `
with recursive tree as (
    select id, parent_id, name, sort_key, created_at, updated_at
    from channels
    where parent_id is null
    union all
    select c.id, c.parent_id, c.name, c.sort_key, c.created_at, c.updated_at
    from channels c
    inner join tree t on c.parent_id = t.id
)
select id, parent_id, name, sort_key, created_at, updated_at
from tree
order by parent_id nulls first, sort_key, id`
	rows, err := q.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Channel
	for rows.Next() {
		var i Channel
		if err := rows.Scan(&i.ID, &i.ParentID, &i.Name, &i.SortKey, &i.CreatedAt, &i.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
