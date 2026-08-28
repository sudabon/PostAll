package blob

import (
	"bytes"
	"context"
	"io"
	"sync"
)

type Memory struct {
	mu      sync.Mutex
	objects map[string][]byte
	LastKey string
}

func NewMemory() *Memory {
	return &Memory{objects: map[string][]byte{}}
}

func (m *Memory) PutObject(key string, data []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]byte, len(data))
	copy(cp, data)
	m.objects[key] = cp
}

func (m *Memory) PresignPut(_ context.Context, key, contentType string, _ int64) (string, map[string]string, error) {
	m.mu.Lock()
	m.LastKey = key
	m.mu.Unlock()
	headers := map[string]string{}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	return "memory://put/" + key, headers, nil
}

func (m *Memory) PresignGet(_ context.Context, key, _ string) (string, error) {
	return "memory://get/" + key, nil
}

func (m *Memory) Get(_ context.Context, key string) (io.ReadCloser, string, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.objects[key]
	if !ok {
		return nil, "", 0, ErrNotFound
	}
	cp := make([]byte, len(data))
	copy(cp, data)
	return io.NopCloser(bytes.NewReader(cp)), "", int64(len(cp)), nil
}

func (m *Memory) Head(_ context.Context, key string) (bool, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.objects[key]
	if !ok {
		return false, 0, nil
	}
	return true, int64(len(data)), nil
}

func (m *Memory) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.objects, key)
	return nil
}

func (m *Memory) Put(_ context.Context, key, _ string, body io.Reader, _ int64) error {
	data, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	m.PutObject(key, data)
	return nil
}

func (m *Memory) Has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.objects[key]
	return ok
}
