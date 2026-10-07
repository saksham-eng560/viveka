// Copy Leo's figure (single source: buddy/web/leo.svg) into this package's public/ dir.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../buddy/web/leo.svg");
const dest = resolve(here, "../public/leo.svg");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
