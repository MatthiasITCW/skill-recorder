// Registers the resolution hooks (hooks.mjs) for the eval harness. Pass to Node
// with `--import ./evals/register.mjs` so the hooks are active before the harness
// entry (and all the app TypeScript it imports) is loaded.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
