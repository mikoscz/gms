BINDIR  ?= $(HOME)/bin
BIN      = gms
TARGET   = dist/$(BIN)

.PHONY: all build install uninstall clean deps help

all: build

help:
	@echo "Targets:"
	@echo "  make build      Compile dist/$(BIN) (single self-contained binary)"
	@echo "  make install    Build and install to \$$BINDIR ($(BINDIR))"
	@echo "  make uninstall  Remove $(BINDIR)/$(BIN)"
	@echo "  make clean      Remove dist/"
	@echo ""
	@echo "Variables:"
	@echo "  BINDIR=$(BINDIR)   (override with 'make install BINDIR=/usr/local/bin')"

deps:
	@command -v bun >/dev/null 2>&1 || { echo "error: bun not found. Install from https://bun.sh"; exit 1; }
	@test -d node_modules || bun install

build: deps
	bun run build

install: build
	@if ! mkdir -p "$(BINDIR)" 2>/dev/null || ! test -w "$(BINDIR)"; then \
		echo "error: cannot write to $(BINDIR)."; \
		echo "       try:  make install BINDIR=/usr/local/bin   (then re-run with sudo)"; \
		exit 1; \
	fi
	install -m 0755 "$(TARGET)" "$(BINDIR)/$(BIN)"
	@echo "installed $(BINDIR)/$(BIN)"
	@case ":$$PATH:" in *":$(BINDIR):"*) ;; *) echo "note: $(BINDIR) is not on your PATH — add it to your shell rc"; esac

uninstall:
	rm -f "$(BINDIR)/$(BIN)"
	@echo "removed $(BINDIR)/$(BIN)"

clean:
	rm -rf dist
