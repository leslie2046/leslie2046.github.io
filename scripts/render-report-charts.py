"""Regenerate report SVGs: pip install matplotlib; python scripts/render-report-charts.py.

Uses the published SSD summary (preserving its rounding) and GPU CSV. Set
REPORT_CHART_FONT to a CJK font path on systems without Microsoft YaHei.
PNG previews go to ignored output/report-charts; no Python needed for site builds.
"""

import csv
import os
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.ticker import MaxNLocator

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/images/reports"
PREVIEWS = ROOT / "output/report-charts"
ASSETS.mkdir(parents=True, exist_ok=True)
PREVIEWS.mkdir(parents=True, exist_ok=True)
font_path = Path(os.environ.get("REPORT_CHART_FONT", "C:/Windows/Fonts/msyh.ttc"))
if font_path.exists():
    font_manager.fontManager.addfont(str(font_path))
    plt.rcParams["font.family"] = font_manager.FontProperties(fname=font_path).get_name()
else:
    raise SystemExit("Set REPORT_CHART_FONT to an installed CJK font file.")

BG, TEXT, GRID = "#faf9f5", "#232923", "#deded5"
GRAY, GREEN, BLUE = "#777c7b", "#3c735c", "#547694"
plt.rcParams.update({
    "font.size": 13, "text.color": TEXT, "axes.labelcolor": TEXT,
    "xtick.color": TEXT, "ytick.color": TEXT, "axes.edgecolor": GRID,
    "figure.facecolor": BG, "axes.facecolor": BG, "axes.unicode_minus": False,
    "svg.hashsalt": "leslie-report-charts", "savefig.facecolor": BG,
})


def base(title, subtitle, height=5.8):
    fig, ax = plt.subplots(figsize=(8.6, height))
    fig.text(.06, .96, title, fontsize=20, weight="bold", va="top")
    fig.text(.06, .90, subtitle, fontsize=12, color=GRAY, va="top")
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.tick_params(length=0, pad=9)
    ax.set_axisbelow(True)
    return fig, ax


def save(fig, name, description):
    fig.savefig(ASSETS / f"{name}.svg", metadata={"Date": None, "Title": description})
    fig.savefig(PREVIEWS / f"{name}.png", dpi=160)
    plt.close(fig)
    print(name)


def summary_rows(header):
    content = (ROOT / "src/content/posts/ssd-migration-performance.md").read_text(encoding="utf-8")
    table = content.split(header, 1)[1].split("\n\n", 1)[0]
    rows = []
    for line in table.splitlines():
        if not line.startswith("|") or "---" in line:
            continue
        cells = [re.sub(r"<[^>]+>", "", cell).strip() for cell in line.strip("|").split("|")]
        before, after = [float(cell.replace(" ms", "")) for cell in cells[1:3]]
        reduction = float(cells[-1].strip("%"))
        assert before > 0 and after > 0
        assert abs((before - after) / before * 100 - reduction) < .01
        rows.append((cells[0], before, after, reduction))
    return rows


def bars(rows, title, name, height):
    fig, ax = base(title, "迁移前后各 10 次调用 · 汇总耗时（ms）· 越低越好", height)
    positions = list(range(len(rows)))
    ax.barh([p - .18 for p in positions], [r[1] for r in rows], height=.30, color=GRAY, label="迁移前 · HDD")
    ax.barh([p + .18 for p in positions], [r[2] for r in rows], height=.30, color=GREEN, label="迁移后 · SSD")
    labels = {"workflow_started": "工作流启动", "TTFT": "首字响应 TTFT", "total": "请求总耗时"}
    ax.set_yticks(positions, [labels.get(r[0], r[0]) for r in rows])
    ax.invert_yaxis()
    for pos, (_, before, after, reduction) in enumerate(rows):
        ax.annotate(f"{before:,.2f}", (before, pos - .18), xytext=(6, 0), textcoords="offset points", va="center", fontsize=11, color=GRAY)
        ax.annotate(f"{after:,.2f}  (−{reduction:.2f}%)", (after, pos + .18), xytext=(6, 0), textcoords="offset points", va="center", fontsize=11, color=GREEN)
    ax.set_xlim(0, max(r[1] for r in rows) * 1.38)
    ax.set_xlabel("耗时（ms）")
    ax.xaxis.set_major_locator(MaxNLocator(4, prune="upper"))
    ax.grid(axis="x", color=GRID, linewidth=.7)
    ax.legend(loc="lower left", bbox_to_anchor=(0, 1.01), ncol=2, frameon=False, fontsize=12)
    fig.subplots_adjust(left=.25, right=.98, bottom=.13, top=.79)
    save(fig, name, title)


retrieval = summary_rows("| 场景与指标 | HDD | SSD | 耗时降幅 |")
agent = summary_rows("| Agent 平均指标 | HDD | SSD | 减少时间 | 耗时降幅 |")
assert len(retrieval) == 7 and len(agent) == 3
bars(retrieval, "SSD 迁移：检索耗时对比", "ssd-retrieval", 8)
bars(agent, "SSD 迁移：Agent 平均耗时对比", "ssd-agent", 5.5)

with (ROOT / "public/downloads/p40-l20-serving-results.csv").open(encoding="utf-8", newline="") as handle:
    gpu = list(csv.DictReader(handle))
assert len(gpu) == 30
deployments = [
    ("p40_xinference", "P40 + Xinference", GRAY, "s", "--"),
    ("l20_xinference", "L20 + Xinference", BLUE, "^", "-"),
    ("l20_vllm", "L20 + vLLM", GREEN, "o", "-"),
]


def curve(service, metric):
    is_qps = metric == "qps"
    label = "吞吐" if is_qps else "P95 延迟"
    title = f"{service.title()}：并发与{label}"
    subtitle = "每档 100 次请求 · 单轮测试 · " + ("吞吐越高越好" if is_qps else "延迟越低越好 · 仅展示 L20 完整数据")
    fig, ax = base(title, subtitle, 6)
    for deployment, name, color, marker, style in deployments:
        if not is_qps and deployment == "p40_xinference":
            continue
        rows = sorted([r for r in gpu if r["service"] == service and r["deployment"] == deployment], key=lambda r: int(r["concurrency"]))
        xs = [int(r["concurrency"]) for r in rows]
        ys = [float(r[metric]) for r in rows]
        assert xs == [1, 5, 10, 20, 30] and all(int(r["requests"]) == 100 for r in rows)
        ax.plot(xs, ys, label=name, color=color, marker=marker, linestyle=style, linewidth=2.4, markersize=7)
        ax.annotate(f"{ys[-1]:,.2f}", (xs[-1], ys[-1]), xytext=(9, 0), textcoords="offset points", va="center", color=color, fontsize=12)
        if service == "reranker" and (is_qps and deployment == "l20_vllm" or not is_qps and deployment == "l20_xinference"):
            ax.annotate(f"{ys[3]:,.2f}", (xs[3], ys[3]), xytext=(0, 13), textcoords="offset points", ha="center", color=color, fontsize=12)
    ax.set_xticks([1, 5, 10, 20, 30])
    ax.set_xlim(0, 36)
    ax.set_ylim(bottom=0, top=ax.get_ylim()[1] * 1.10)
    ax.set_xlabel("并发请求数")
    ax.set_ylabel("吞吐（QPS）" if is_qps else "P95 延迟（ms）")
    ax.yaxis.set_major_locator(MaxNLocator(5))
    ax.grid(color=GRID, linewidth=.7)
    ax.legend(loc="lower left", bbox_to_anchor=(0, 1.01), ncol=2, frameon=False, fontsize=12)
    fig.subplots_adjust(left=.13, right=.97, bottom=.15, top=.73)
    save(fig, f"gpu-{service}-{'qps' if is_qps else 'p95'}", title)


for service in ("embedding", "reranker"):
    for metric in ("qps", "p95_ms"):
        curve(service, metric)
