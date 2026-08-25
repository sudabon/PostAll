package httpapi

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const eventBrokerRetryInterval = time.Second

type eventBroker struct {
	pool   *pgxpool.Pool
	ctx    context.Context
	cancel context.CancelFunc
	ready  chan struct{}
	done   chan struct{}

	startOnce sync.Once
	mu        sync.Mutex
	startErr  error
	listeners map[chan struct{}]struct{}
}

func newEventBroker(pool *pgxpool.Pool) *eventBroker {
	ctx, cancel := context.WithCancel(context.Background())
	return &eventBroker{
		pool:      pool,
		ctx:       ctx,
		cancel:    cancel,
		ready:     make(chan struct{}),
		done:      make(chan struct{}),
		listeners: map[chan struct{}]struct{}{},
	}
}

func (b *eventBroker) Subscribe(ctx context.Context) (<-chan struct{}, func(), error) {
	b.startOnce.Do(func() { go b.run() })
	select {
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	case <-b.ready:
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	if b.startErr != nil {
		return nil, nil, b.startErr
	}
	listener := make(chan struct{}, 1)
	b.listeners[listener] = struct{}{}
	unsubscribe := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if _, ok := b.listeners[listener]; ok {
			delete(b.listeners, listener)
			close(listener)
		}
	}
	return listener, unsubscribe, nil
}

func (b *eventBroker) Close() {
	b.cancel()
	b.startOnce.Do(func() {
		b.mu.Lock()
		b.startErr = context.Canceled
		close(b.ready)
		close(b.done)
		b.mu.Unlock()
	})
	<-b.done
}

func (b *eventBroker) run() {
	defer func() {
		b.mu.Lock()
		for listener := range b.listeners {
			delete(b.listeners, listener)
			close(listener)
		}
		b.mu.Unlock()
		close(b.done)
	}()

	initial := true
	for {
		connection, err := b.pool.Acquire(b.ctx)
		if err != nil {
			if initial {
				b.finishStart(err)
				return
			}
			if !b.waitToRetry() {
				return
			}
			continue
		}
		if _, err = connection.Exec(b.ctx, "listen postall_events"); err != nil {
			connection.Release()
			if initial {
				b.finishStart(err)
				return
			}
			if !b.waitToRetry() {
				return
			}
			continue
		}
		if initial {
			b.finishStart(nil)
			initial = false
		}

		for b.ctx.Err() == nil {
			if _, err = connection.Conn().WaitForNotification(b.ctx); err != nil {
				break
			}
			b.broadcast()
		}
		connection.Release()
		if b.ctx.Err() != nil {
			return
		}
		if !b.waitToRetry() {
			return
		}
	}
}

func (b *eventBroker) waitToRetry() bool {
	timer := time.NewTimer(eventBrokerRetryInterval)
	defer timer.Stop()
	select {
	case <-b.ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (b *eventBroker) finishStart(err error) {
	b.mu.Lock()
	b.startErr = err
	close(b.ready)
	b.mu.Unlock()
}

func (b *eventBroker) broadcast() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for listener := range b.listeners {
		select {
		case listener <- struct{}{}:
		default:
		}
	}
}
