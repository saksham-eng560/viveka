// Copy Sheru's figure (single source: buddy/web/sheru.svg) into this package's public/ dir.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../buddy/web/sheru.svg");
const dest = resolve(here, "../public/sheru.svg");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
