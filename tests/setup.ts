import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect XDG_CONFIG_HOME before any src module is imported, so paths.ts
// computes CONFIG_DIR/KEYS_DIR/REGISTRY_PATH against an isolated tmpdir.
// Every test run gets its own dir; nothing under the user's real ~/.config/gms
// is read or written.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "gms-test-xdg-"));
