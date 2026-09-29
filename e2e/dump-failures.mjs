import fs from "node:fs";
for (const d of fs.readdirSync("test-results")) {
  const f = `test-results/${d}/error-context.md`;
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, "utf8");
  const start = t.indexOf("# Error details");
  if (start === -1) continue;
  console.log("===", d.slice(0, 40));
  console.log(t.slice(start, start + 500).split("\n").slice(2, 8).join("\n"));
}
