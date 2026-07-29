import { prepareCompliance } from "./compliance.mjs";

const licensesOnly = process.argv.includes("--licenses-only");
const result = await prepareCompliance({ includeSources: !licensesOnly });

console.log(
  `Prepared ${result.packageCount} package licenses and ${result.sourceCount} source materials in ` +
    result.outputDir,
);
