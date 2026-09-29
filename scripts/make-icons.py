"""生成扩展图标（public/icons/icon-{16,32,48,128}.png）。

为什么需要它：manifest 里没有 icons 时，浏览器工具栏只显示一个通用占位图形，
装好了也不太像「一个正经扩展」。这里用一个脚本画确定性矢量风格图形，
比放一张来路不明的 PNG 更可维护（改色改形重跑一次就行）。

用法：python scripts/make-icons.py
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "icons"
ACCENT = (47, 91, 215, 255)  # 与 base.css --accent 一致
ACCENT_TOP = (74, 116, 232, 255)
INK = (255, 255, 255, 255)


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    r = max(2, size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return m


def icon(size: int) -> Image.Image:
    s = float(size)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base = Image.new("RGBA", (size, size), ACCENT)
    d = ImageDraw.Draw(base)
    # 上半略亮：给一点厚度，避免 128px 时像一块死色
    for y in range(int(s * 0.5)):
        t = y / max(1, s * 0.5)
        col = tuple(int(ACCENT_TOP[i] + (ACCENT[i] - ACCENT_TOP[i]) * t) for i in range(4))  # type: ignore[assignment]
        d.line([(0, y), (s - 1, y)], fill=col)  # type: ignore[arg-type]
    img.paste(base, (0, 0), rounded_mask(size, 0.22))

    d = ImageDraw.Draw(img)
    w = max(1, round(s * 0.075))
    x0 = round(s * 0.24)
    # 三行「表单字段」，逐行变短
    for i, frac in enumerate((0.52, 0.40, 0.28)):
        y = round(s * (0.30 + i * 0.17))
        d.line([(x0, y), (round(s * (x0 / s + frac)), y)], fill=INK, width=w)
    # 右下角勾：表达「已核对后填写」
    gx, gy = round(s * 0.60), round(s * 0.74)
    d.line([(gx, gy), (gx + round(s * 0.09), gy + round(s * 0.09))], fill=INK, width=w)
    d.line(
        [(gx + round(s * 0.09), gy + round(s * 0.09)), (gx + round(s * 0.24), gy - round(s * 0.16))],
        fill=INK,
        width=w,
    )
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        img = icon(size)
        # 小尺寸下把描边对齐像素，否则 16px 会糊成一团
        img.save(OUT / f"icon-{size}.png")
        print(f"wrote {OUT / f'icon-{size}.png'}")


if __name__ == "__main__":
    main()
