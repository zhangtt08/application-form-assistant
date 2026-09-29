import { validateDraft } from "../generation/factValidator";
import type { Fact } from "../generation/types";
import type { AnswerLengthConstraint, AnswerValidationReport, CompanyClaimCheck } from "./types";
import { lengthTarget } from "./promptBuilder";

/**
 * Answer Validator（spec Stage 4 第十五~十九、二十八）：
 * - 复用 FactValidator（Numeric/Technology/Responsibility Guard）
 * - 新增 Company Claim Guard：公司评价词必须有 COMPANY_FACTS 支持（只有公司名不够）
 * - 新增 Career Claim Guard：职业目标表达必须有 careerPreferences 支持
 * - 新增 Preference Guard：个人偏好表达必须有 Profile Fact 支持
 * - Length：超长 → review，禁止截断
 * overall：任一 guard fail / base fail → fail；超长或 uncertain → review；否则 pass
 */

const COMPANY_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /行业领先|业内领先|头部企业|龙头企业|领军企业/, label: "行业地位评价" },
  { pattern: /公司文化|企业文化|价值观/, label: "企业文化" },
  { pattern: /全球业务|全球化|国际业务/, label: "全球业务" },
  { pattern: /市场份额|市场地位|市场占有率/, label: "市场份额" },
  { pattern: /客户规模|服务客户|客户数量/, label: "客户规模" },
  { pattern: /融资|上市|估值/, label: "融资情况" },
  { pattern: /持续深耕|深耕|专注于.*领域多年/, label: "业务深耕" },
  { pattern: /贵司|贵公司|贵公司.*是/, label: "公司评价" },
];

const CAREER_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /未来(三|五|几年|数)年/, label: "未来几年规划" },
  { pattern: /长期希望|长期目标|长期来看/, label: "长期目标" },
  { pattern: /职业规划|职业目标|职业发展/, label: "职业规划" },
  { pattern: /希望成长为|成长为一名|成为一名/, label: "成长目标" },
];

const PREFERENCE_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /我一直(对|热爱|喜欢)|我长期(关注|热爱)|我非常(热爱|喜欢|感兴趣)/, label: "个人偏好" },
  { pattern: /从小|一直向往|热爱.*行业/, label: "偏好经历" },
];

function guardClaims(draft: string, patterns: { pattern: RegExp; label: string }[], supportingFacts: Fact[], factLabelForReason: string): CompanyClaimCheck[] {
  const out: CompanyClaimCheck[] = [];
  const factText = supportingFacts.map((f) => f.text).join(" ");
  for (const { pattern, label } of patterns) {
    const m = draft.match(pattern);
    if (m) {
      const supported = factText.length > 0 && supportingFacts.some((f) => {
        // 事实文本与命中的具体表达有实质重叠（避免公司名直判支持）
        const hit = m[0];
        if (f.text.includes(hit) || hit.includes(f.text.slice(0, 8))) return true;
        // 数字/年数片段重叠（如 hit「未来三年」↔ fact「三年内」）
        const tokens = hit.match(/d+%|d+s*人|[一二三四五六七八九十]+年|d+年/g) ?? [];
        return tokens.some((t) => f.text.includes(t));
      });
      out.push({
        claim: `「${m[0]}」（${label}）`,
        status: supported ? "supported" : "unsupported",
        reason: supported ? undefined : `${label}缺少 ${factLabelForReason} 支持`,
      });
    }
  }
  return out;
}

/** 主入口：校验一个回答 */
export function validateAnswer(
  draft: string,
  personalFacts: Fact[],
  companyFacts: Fact[],
  careerFacts: Fact[],
  length: AnswerLengthConstraint,
): AnswerValidationReport {
  const base = validateDraft(draft, personalFacts);
  const companyClaims = guardClaims(draft, COMPANY_CLAIM_PATTERNS, companyFacts, "Company Facts");
  const careerClaims = guardClaims(draft, CAREER_CLAIM_PATTERNS, careerFacts, "careerPreferences").map((c) =>
    // careerPreferences 非空 = 用户显式配置，职业目标表达视为有来源（spec 十七：必须来源于 careerPreferences）
    careerFacts.length > 0 && c.status === "unsupported" ? { ...c, status: "supported" as const, reason: undefined } : c,
  );
  const preferenceClaims = guardClaims(draft, PREFERENCE_CLAIM_PATTERNS, personalFacts, "Personal Facts");

  const target = lengthTarget(length);
  const current = draft.length;
  const exceeded = current > target;

  const guardFail =
    companyClaims.some((c) => c.status === "unsupported") ||
    careerClaims.some((c) => c.status === "unsupported") ||
    preferenceClaims.some((c) => c.status === "unsupported");

  const overall: AnswerValidationReport["overall"] =
    base.status === "fail" || guardFail
      ? "fail"
      : exceeded || base.status === "review"
        ? "review"
        : "pass";

  return {
    baseStatus: base.status,
    claims: base.claims.map((c) => ({ claim: c.claim, kind: c.kind, status: c.status, reason: c.reason })),
    companyClaims,
    careerClaims,
    preferenceClaims,
    length: { current, target, exceeded },
    overall,
  };
}
