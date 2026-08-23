package attachment

import "time"

const (
	MaxBytes       int64 = 25 << 20
	MaxPerPost           = 10
	IncompleteAge        = time.Hour
)
