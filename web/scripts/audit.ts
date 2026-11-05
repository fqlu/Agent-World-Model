// Audit a local workspace folder without the app database:
//   npm run audit -- "/path/to/workspace" [profile]
import path from "node:path";
import { LocalFsConnector } from "../src/lib/connectors/localfs";
import { IgnoringConnector } from "../src/lib/ignore";
import { runAudit } from "../src/lib/linter";
(async () => {
  const c = new IgnoringConnector(new LocalFsConnector(path.resolve(process.argv[2])));
  const r = await runAudit(c, process.argv[3] ?? "vivanti-master-workspace");
  console.log(JSON.stringify(r.stats));
  for (const f of r.findings) console.log(`${f.severity} ${f.rule} ${f.path} | ${f.message}`);
})();
