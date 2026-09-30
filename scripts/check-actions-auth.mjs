#!/usr/bin/env node
/**
 * Fails when a server action that changes admin data does not begin with `await assertAdmin()`.
 *
 * Every exported function in a "use server" file is a public HTTP endpoint, even if no page links
 * to it, so page-level protection is not enough. This check is part of `npm run check`.
 */
import fs from "node:fs";
import path from "node:path";

const dir = "src/app/actions";
const ADMIN_FILES = new Set(["admin.ts", "label.ts", "identity.ts"]);
// Public or self-authorising by design, reviewed by hand: sign-in, likes/views/shares, and the player claim.
const ALLOWED = new Set(["auth.ts", "klips.ts"]);
const SELF_CHECKED = new Set(["claimTrackedPlayer"]);

let failures = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
  if (!ADMIN_FILES.has(file) && !ALLOWED.has(file)) {
    console.error(`NEW server action file ${file}: review it, then add it to ADMIN_FILES or ALLOWED in this script.`);
    failures++;
    continue;
  }
  if (!ADMIN_FILES.has(file)) continue;
  const src = fs.readFileSync(path.join(dir, file), "utf8");
  const re = /export async function (\w+)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; i++; }
    const open = src.indexOf("{", i);
    const firstStatement = src.slice(open + 1).trimStart().split("\n")[0];
    if (SELF_CHECKED.has(name)) continue;
    if (!firstStatement.includes("assertAdmin()")) {
      console.error(`UNPROTECTED ACTION  ${file}: ${name}() must start with "await assertAdmin();"  (found: ${firstStatement.trim()})`);
      failures++;
    }
  }
}
if (failures) { console.error(`\n${failures} problem(s).`); process.exit(1); }
console.log("Action authorization check passed.");
