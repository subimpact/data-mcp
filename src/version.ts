/** Package version, read from package.json (works from src/ and dist/). */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const VERSION: string = (() => {
  try {
    return (require("../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export const USER_AGENT = `subimpact-data-mcp/${VERSION}`;
