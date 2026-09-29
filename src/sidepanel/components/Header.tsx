export function Header({ subtitle }: { subtitle?: string }) {
  return (
    <header className="header">
      <div className="header-title">网申助手</div>
      <div className="header-sub">{subtitle ?? "识别 → 匹配资料 → 填写"}</div>
    </header>
  );
}
