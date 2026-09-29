import { describe, expect, it, beforeAll, vi } from "vitest";
import { scanPage } from "../src/content/scanner";
import { runScanPipeline } from "../src/pipeline/scanPipeline";
import { defaultProfile } from "../src/profile/defaultProfile";
import type { Profile } from "../src/types/profile";

/**
 * Scanner 测试（jsdom）：对齐验收 1（input/textarea/select/radio 识别与信号提取）
 * 与验收 12（未知控件安全跳过）。
 */

function inject(html: string): void {
  document.body.innerHTML = html;
}

// jsdom 无布局引擎：getBoundingClientRect 恒为 0。真实浏览器有布局，此处仅为测试补桩。
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 100,
    height: 24,
    top: 0,
    left: 0,
    bottom: 24,
    right: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

describe("scanner（验收 1）", () => {
  it("识别 input/textarea/select/radio 并提取 label/placeholder/name", () => {
    inject(`
      <form>
        <div><label for="name">姓名</label><input id="name" name="fullname" placeholder="请输入姓名"></div>
        <div><label>手机号码<input name="phone" type="tel"></label></div>
        <div><label for="intro">自我介绍</label><textarea id="intro"></textarea></div>
        <div><label for="degree">学历</label>
          <select id="degree"><option value="">请选择</option><option value="1">本科</option><option value="2">硕士</option></select>
        </div>
        <fieldset><legend>性别</legend>
          <label><input type="radio" name="gender" value="male">男</label>
          <label><input type="radio" name="gender" value="female">女</label>
        </fieldset>
      </form>
    `);

    const fields = scanPage();
    const kinds = fields.map((f) => f.kind);
    expect(kinds).toContain("text");
    expect(kinds).toContain("tel");
    expect(kinds).toContain("textarea");
    expect(kinds).toContain("select");
    expect(kinds).toContain("radio");

    const nameField = fields.find((f) => f.context.id === "name");
    expect(nameField?.context.labelText).toBe("姓名");
    expect(nameField?.context.placeholder).toBe("请输入姓名");

    const phoneField = fields.find((f) => f.context.name === "phone");
    expect(phoneField?.context.labelText).toBe("手机号码");

    const degreeField = fields.find((f) => f.kind === "select");
    expect(degreeField?.options).toEqual(["本科", "硕士"]);

    const genderField = fields.find((f) => f.kind === "radio");
    expect(genderField?.options).toEqual(["男", "女"]);
    // radio 组应收敛为一个字段
    expect(fields.filter((f) => f.kind === "radio")).toHaveLength(1);
  });

  it("过滤 password/file/submit/hidden/搜索框/验证码", () => {
    inject(`
      <form>
        <input type="password" name="pwd">
        <input type="file" name="resume">
        <input type="submit" value="提交">
        <input type="hidden" name="token">
        <input type="text" name="search" placeholder="搜索">
        <input type="text" name="captcha" placeholder="请输入验证码">
        <input type="text" name="ok" placeholder="正常字段">
      </form>
    `);
    const fields = scanPage();
    const names = fields.map((f) => f.context.name);
    expect(names).toEqual(["ok"]);
  });

  it("过滤 disabled / readonly / 不可见元素", () => {
    inject(`
      <form>
        <input type="text" name="a" disabled>
        <input type="text" name="b" readonly>
        <div style="display:none"><input type="text" name="c"></div>
        <input type="text" name="d">
      </form>
    `);
    const names = scanPage().map((f) => f.context.name);
    expect(names).toEqual(["d"]);
  });

  it("字段名是普通 div/span 时，也能从控件附近提取并匹配", () => {
    inject(`
      <form>
        <div class="form-row"><div class="caption">姓名：</div><div class="control"><input></div></div>
        <div class="form-row"><span>电子邮箱</span><div class="control"><input type="email"></div></div>
      </form>
    `);

    const fields = scanPage();
    expect(fields.map((f) => f.context.labelText)).toEqual(["姓名", "电子邮箱"]);

    const profile = structuredClone(defaultProfile);
    profile.basic.name = "张三";
    profile.basic.email = "test@example.com";
    const candidates = runScanPipeline(fields, profile);
    expect(candidates.map((c) => c.match.fieldId)).toEqual(["basic.name", "basic.email"]);
    expect(candidates.every((c) => c.status === "ready")).toBe(true);
  });
});

describe("scanPipeline（验收 5 + 状态机）", () => {
  const profile: Profile = structuredClone(defaultProfile);
  profile.basic.name = "张三";
  profile.content.selfEvaluation.medium = "踏实肯干";

  it("已匹配内容直接 ready；承诺类 → manual；radio/checkbox 不再是 unsupported", () => {
    inject(`
      <form>
        <div><label for="nm">姓名</label><input id="nm" name="nm"></div>
        <div><label for="se">自我评价</label><textarea id="se"></textarea></div>
        <div><label for="pa">政治面貌</label><input id="pa" name="pa"></div>
        <fieldset><legend>性别</legend>
          <label><input type="radio" name="g" value="m">男</label>
          <label><input type="radio" name="g" value="f">女</label>
        </fieldset>
        <div><label for="unknown">其他信息</label><input id="unknown" name="other"></div>
        <div><label for="empty">联系电话</label><input id="empty" name="phone2"></div>
      </form>
    `);

    const raw = scanPage();
    const candidates = runScanPipeline(raw, profile);
    const byRef = (label: string) =>
      candidates.find((c) => c.raw.context.labelText === label);

    const name = byRef("姓名");
    expect(name?.status).toBe("ready");
    expect(name?.match.fieldId).toBe("basic.name");
    expect(name?.value?.value).toBe("张三");
    expect(name?.risk).toBe("SAFE");

    const se = byRef("自我评价");
    expect(se?.status).toBe("ready");
    expect(se?.risk).toBe("REVIEW");
    expect(se?.value?.value).toBe("踏实肯干");

    const pa = byRef("政治面貌");
    expect(pa?.match.fieldId).toBe("basic.politicalStatus");
    expect(pa?.status).toBe("empty"); // 识别成功，但资料库里还没有这一项
    expect(pa?.risk).toBe("SAFE");
    expect(pa?.value).toBeUndefined();

    const withPolitical = structuredClone(profile);
    withPolitical.basic.politicalStatus = "共青团员";
    const filled = runScanPipeline(raw, withPolitical).find((c) => c.raw.context.labelText === "政治面貌");
    expect(filled?.status).toBe("ready");
    expect(filled?.value?.value).toBe("共青团员");

    const radio = candidates.find((c) => c.raw.kind === "radio");
    expect(radio?.status).toBe("empty");

    const other = byRef("其他信息");
    expect(other?.status).toBe("unknown");
    expect(other?.value).toBeUndefined();

    const empty = byRef("联系电话");
    expect(empty?.match.fieldId).toBe("basic.phone");
    expect(empty?.status).toBe("empty"); // 识别成功但 Profile 无值（Stage 2：与 unknown 区分）
  });

  it("扫描结果不修改页面（验收 4：扫描前后 input value 不变）", () => {
    inject(`
      <form>
        <div><label for="nm">姓名</label><input id="nm" name="nm" value="原始值"></div>
      </form>
    `);
    const before = (document.getElementById("nm") as HTMLInputElement).value;
    const raw = scanPage();
    runScanPipeline(raw, profile);
    const after = (document.getElementById("nm") as HTMLInputElement).value;
    expect(after).toBe(before);
    expect(after).toBe("原始值");
  });
});

describe("radio / checkbox 组识别（组标题而不是选项文本）", () => {
  const prof: Profile = structuredClone(defaultProfile);
  prof.basic.gender = "男";
  prof.basic.politicalStatus = "共青团员";
  prof.skills.languages = ["英语CET-6"];

  it("「性别」写在组外面、选项是男/女时，字段名取组标题并匹配 basic.gender", () => {
    inject(`
      <div class="row">
        <span class="label">性别</span>
        <label><input type="radio" name="g" value="m">男</label>
        <label><input type="radio" name="g" value="f">女</label>
      </div>
    `);
    const cand = runScanPipeline(scanPage(), prof).find((c) => c.raw.kind === "radio");
    expect(cand?.raw.context.labelText).toBe("性别");
    expect(cand?.match.fieldId).toBe("basic.gender");
    expect(cand?.status).toBe("ready");
    expect(cand?.value?.value).toBe("男");
  });

  it("fieldset legend 作为组标题（语言能力 → skills.languages）", () => {
    inject(`
      <fieldset><legend>外语能力</legend>
        <label><input type="checkbox" name="lang" value="cet4">英语CET-4</label>
        <label><input type="checkbox" name="lang" value="cet6">英语CET-6</label>
      </fieldset>
    `);
    const cand = runScanPipeline(scanPage(), prof).find((c) => c.raw.kind === "checkbox");
    expect(cand?.raw.context.labelText).toBe("外语能力");
    expect(cand?.match.fieldId).toBe("skills.languages");
    expect(cand?.status).toBe("ready");
  });

  it("知情同意勾选 → manual，永不进入填写计划", () => {
    inject(`
      <div><label><input type="checkbox" name="agree">我已阅读并同意招聘服务协议</label></div>
    `);
    const cand = runScanPipeline(scanPage(), prof).find((c) => c.raw.kind === "checkbox");
    expect(cand?.risk).toBe("MANUAL_ONLY");
    expect(cand?.status).toBe("manual");
  });

  it("政治面貌 / 身份证号按资料库取值（不再一律人工）", () => {
    inject(`
      <div><label for="pa">政治面貌</label><input id="pa" name="pa"></div>
    `);
    const cand = runScanPipeline(scanPage(), prof).find((c) => c.raw.context.labelText === "政治面貌");
    expect(cand?.match.fieldId).toBe("basic.politicalStatus");
    expect(cand?.status).toBe("ready");
    expect(cand?.value?.value).toBe("共青团员");
  });
});
