/**
 * Privacy scan —— commit 前扫一遍仓库里的个人标识与凭据。
 *
 * 分级：
 *   ERROR  明确 banned 的个人标识 / 看起来就是真凭据的东西  → 退出码 1，不该进仓库
 *   WARN   手机号 / 邮箱 / 身份证形状 / github handle       → 只提示，不失败
 *          （通用 regex 在测试仓库里必然误报，让人逐条看即可，不要拿它当门禁）
 *
 * 两条硬约束：
 *   1) 命中值一律脱敏打印，绝不把疑似 secret 原文再抄进终端或日志；
 *   2) banned 字面量在本文件里按片段拼接——否则扫描器自己就成了唯一含脏值的文件。
 *
 * 用法：npm run privacy:scan  [-- --strict-warn]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 统一合成身份（docs/TEST_DATA_POLICY.md）——命中这些不告警 */
const ALLOWED = new Set([
  "15300001122",
  "15300002222",
  "test.resume@example.com",
  "second.resume@example.com",
  "test_resume_01",
  "test_resume_02",
  "100000001",
  "100000002",
  "https://example.com/portfolio",
  "https://example.org/profile",
  // 2026-09-29 新增的 GitHub 栏：本会话自己写的合成账号（syn-* 前缀），与上面同一类
  "https://github.com/syn-test",
  "https://github.com/syn-zhangsan",
]);

/** RFC 2606 / 保留域：测试邮箱一律走这些，其余按疑似真实处理 */
const RESERVED_EMAIL_DOMAINS = ["example.com", "example.org", "example.net", "test.com", "email.com", "b.com", "example.invalid"];

/**
 * 已人工复核并登记的遗留占位号段（2026-09-26 Privacy Scrub）。
 * 全 0 / 顺序尾号 / 校验位不合法，不可能是真实标识；登记后不再逐行报 WARN，
 * 只在汇总里计数——否则每次写文档都要多一条需要解释的噪声。
 * 新增一个未登记的号段仍然会报 WARN，这正是我们要的效果。
 */
const KNOWN_PLACEHOLDER = new Set([
  "13800001234",
  "13800000000",
  "13800138000",
  "110101199001011234",
  "330106200305011234",
  "330106199001011234",
  // delivery pilot 的合成号段：139 全 0/顺序尾号，不可能是真实标识（2026-09-29 人工复核登记）
  "13900007788",
  // Pilot 脚本的「值形状」：每个字母位都被替换成字面量 a，只保留分隔符，
  // 因此它恒不可能是地址，但形状里残留的 @ 会命中 email 规则（2026-09-27 人工复核登记）。
  "aaaa.aaaaaa@aaaaaaa.aaa",
]);

/** banned 个人标识：按片段拼接，避免自包含 */
const BANNED = [
  { id: "personal-handle", value: ["zhang", "tt", "08"].join("") },
  { id: "personal-qq", value: ["9946", "056", "56"].join("") },
];

const SECRET_PATTERNS = [
  { id: "openai-style-key", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { id: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: "inline-credential", re: /\b(?:api[_-]?key|apikey|access[_-]?token|secret|password)\s*[:=]\s*["'][^"']{16,}["']/gi },
];

const WARN_PATTERNS = [
  { id: "cn-mobile", re: /\b1[3-9]\d{9}\b/g },
  { id: "cn-id-card", re: /\b[1-9]\d{5}(?:19|20)\d{2}[01]\d[0-3]\d{4}[\dXx]\b/g },
  { id: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: "github-handle", re: /\bgithub\.com\/[A-Za-z0-9_.-]+/g },
];

/** 不扫的路径：依赖、构建产物、锁文件（resolved URL / integrity hash 会疯狂误报） */
const SKIP = /(^|\/)(node_modules|dist|coverage|\.vite|test-results|playwright-report|e2e-report|smoke\/shots|_transfer-backup|real-validation-results\/private)\//;
const SKIP_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);
const SKIP_BINARY = /\.(gif|ico|map|woff2?|ttf|pdf|zip)$/i;

function walkDir(rel, out) {
  const abs = path.join(ROOT, rel);
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP.test(child + "/")) continue;
      if (e.name === ".git") continue;
      walkDir(child, out);
    } else if (e.isFile()) {
      if (SKIP.test(child) || SKIP_FILES.has(child) || SKIP_BINARY.test(child)) continue;
      out.push(child);
    }
  }
}

/** 有 git 用 git ls-files；没有 git（仓库还没建 / 跨机拷贝后）退回遍历工作树，门禁不能因此失效 */
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .split("\0")
      .filter(Boolean);
  } catch {
    const out = [];
    walkDir("", out);
    process.stdout.write("[privacy:scan] 未检测到 git 仓库，改为遍历工作树\n");
    return out;
  }
}

/** 命中值脱敏：只保留足够定位的前缀，绝不回显完整 secret */
function mask(text) {
  if (text.includes("@")) {
    const [local = "", domain = ""] = text.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (/^1[3-9]\d{9}$/.test(text)) return `${text.slice(0, 3)}****${text.slice(-4)}`;
  if (/^\d{17}[\dXx]$/.test(text)) return `${text.slice(0, 4)}**********`;
  if (/^sk-/i.test(text)) return `${text.slice(0, 5)}***`;
  if (/^github\.com\//i.test(text)) return `github.com/${text.slice("github.com/".length, 4 + "github.com/".length)}***`;
  return text.length <= 6 ? text : `${text.slice(0, 4)}***`;
}

function isReservedEmail(text) {
  const domain = text.split("@")[1] ?? "";
  return RESERVED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Pilot 截图规则（结构性检查，不看内容值）。
 * 真实 Pilot 表单截图是个人信息最容易漏进仓库的地方，而位图没法用 regex 扫，
 * 所以改成「被跟踪的位图 = 需要人眼确认一次」，确认后登记在这里。
 * 目录整体豁免是不行的——那正是漏掉 filled-form 截图的那种失败。
 */
const ALLOWED_TRACKED_IMAGES = new Set([
  // 只含公开职位页 + 侧边栏（字段名/风险徽章/长度），画面里没有任何填写值
  "real-validation-results/sessions/yaoji-real-write-1-preview.png",
  // 2026-10-02 从仓库根归档进 sessions/，逐张人眼复核：
  // 公开 JD 页（Geek-T「机器人产品助理实习生」岗位职责/任职要求），无填写值、无登录态
  "real-validation-results/sessions/2026-09-24-moka-jd-page-public.png",
  // 姚记 zhaopin 投递弹窗空态（只有「点击上传简历文件」占位），未填任何值
  "real-validation-results/sessions/2026-09-25-yaoji-apply-dialog-public.png",
]);
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const PILOT_IMAGE_RE = /^real-validation-results\/.*\.(png|jpe?g|webp)$/;

function isReviewedImage(file) {
  return ALLOWED_TRACKED_IMAGES.has(file) || /(?:sanitized|demo)/i.test(path.basename(file));
}

const findings = [];
let knownHits = 0;

for (const file of trackedFiles()) {
  if (SKIP.test(file) || SKIP_FILES.has(file) || SKIP_BINARY.test(file)) continue;

  // 位图不做文本扫描，但 Pilot 目录下的被跟踪图片要过一遍人眼规则
  if (IMAGE_RE.test(file)) {
    if (PILOT_IMAGE_RE.test(file) && !isReviewedImage(file)) {
      findings.push({ level: "WARN", id: "pilot-screenshot-review", at: `${file}:0`, shown: "含填写值的截图请移入 private/，或登记进 ALLOWED_TRACKED_IMAGES" });
    }
    continue;
  }

  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue; // 已删除但未 staged
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);

  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;

    for (const b of BANNED) {
      if (line.includes(b.value)) findings.push({ level: "ERROR", id: `banned:${b.id}`, at, shown: b.value.slice(0, 3) + "***" });
    }
    for (const p of SECRET_PATTERNS) {
      for (const m of line.matchAll(p.re)) {
        if (ALLOWED.has(m[0])) continue;
        findings.push({ level: "ERROR", id: `secret:${p.id}`, at, shown: mask(m[0]) });
      }
    }
    for (const p of WARN_PATTERNS) {
      for (const m of line.matchAll(p.re)) {
        const v = m[0];
        if (ALLOWED.has(v) || ALLOWED.has(`https://${v}`)) continue;
        if (KNOWN_PLACEHOLDER.has(v)) {
          knownHits += 1;
          continue;
        }
        if (p.id === "email" && isReservedEmail(v)) continue;
        findings.push({ level: "WARN", id: p.id, at, shown: mask(v) });
      }
    }
  });
}

const errors = findings.filter((f) => f.level === "ERROR");
const warns = findings.filter((f) => f.level === "WARN");

const strictWarn = process.argv.includes("--strict-warn");

console.log(`privacy-scan: ${errors.length} ERROR / ${warns.length} WARN / ${knownHits} 已登记占位号段`);
// WARN 同样逐条列出（不判失败）——只给个数字等于让人再去 grep 一遍
for (const f of findings) {
  console.log(`  ${f.level}  ${f.id}  ${f.at}  ${f.shown}`);
}
if (!strictWarn && warns.length) {
  console.log("  （WARN 不判失败：逐条人工确认，确认过的登记进本文件的白名单）");
}

process.exit(errors.length > 0 || (strictWarn && warns.length > 0) ? 1 : 0);
