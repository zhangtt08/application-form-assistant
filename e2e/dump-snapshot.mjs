import fs from "node:fs";
const dir = fs.readdirSync("test-results").find((d) => d.includes(process.argv[2] ?? "Z9"));
if (!dir) { console.log("no results"); process.exit(0); }
const t = fs.readFileSync(`test-results/${dir}/error-context.md`, "utf8");
const i = t.indexOf("Page snapshot");
console.log(i >= 0 ? t.slice(i, i + 1800) : t.slice(0, 400));
