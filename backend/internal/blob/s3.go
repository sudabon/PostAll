package blob

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type S3 struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

func NewS3(ctx context.Context, region, bucket string) (*S3, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(cfg)
	return &S3{
		client:  client,
		presign: s3.NewPresignClient(client),
		bucket:  bucket,
	}, nil
}

func (s *S3) PresignPut(ctx context.Context, key, contentType string, size int64) (string, map[string]string, error) {
	out, err := s.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(size),
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		return "", nil, err
	}
	headers := map[string]string{}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	return out.URL, headers, nil
}

func (s *S3) PresignGet(ctx context.Context, key, filename string) (string, error) {
	disp := `attachment; filename="` + sanitizeDisposition(filename) + `"`
	out, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket:                     aws.String(s.bucket),
		Key:                        aws.String(key),
		ResponseContentDisposition: aws.String(disp),
	}, s3.WithPresignExpires(5*time.Minute))
	if err != nil {
		return "", err
	}
	return out.URL, nil
}

func (s *S3) Head(ctx context.Context, key string) (bool, int64, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var nsk *types.NotFound
		if errors.As(err, &nsk) {
			return false, 0, nil
		}
		var apiErr interface{ HTTPStatusCode() int }
		if errors.As(err, &apiErr) && apiErr.HTTPStatusCode() == http.StatusNotFound {
			return false, 0, nil
		}
		return false, 0, err
	}
	var size int64
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	return true, size, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	return err
}

func sanitizeDisposition(name string) string {
	out := make([]rune, 0, len(name))
	for _, r := range name {
		if r == '"' || r == '\\' || r == '\n' || r == '\r' {
			continue
		}
		out = append(out, r)
	}
	if len(out) == 0 {
		return "file"
	}
	return string(out)
}
