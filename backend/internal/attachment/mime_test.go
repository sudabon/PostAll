package attachment

import "testing"

func TestAllowedMIME(t *testing.T) {
	if !Allowed("image/png") || !Allowed("application/pdf") {
		t.Fatal("expected allowed types")
	}
	if Allowed("application/x-msdownload") || Allowed("") {
		t.Fatal("expected rejection")
	}
}
