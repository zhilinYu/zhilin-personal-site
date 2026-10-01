"""Package the user's private Markdown source without copying it into Git."""
import argparse
import zipfile
from pathlib import Path

PRODUCTS = {
    "quant-risk": "量化风控",
    "trend-leader": "趋势龙头",
    "hot-money": "游资弹性",
    "countertrend": "逆势抗跌",
    "limit-up-pullback": "涨停回吐",
}


def package(source, destination):
    destination.mkdir(parents=True, exist_ok=True)
    files = {}
    for sku, name in PRODUCTS.items():
        matches = [p for p in source.glob("*.md") if name in p.name]
        if len(matches) != 1 or not matches[0].stat().st_size:
            raise ValueError("Expected one nonempty source for " + name)
        files[sku] = (name, matches[0].read_bytes())
    for sku in [*PRODUCTS, "research-bundle"]:
        selected = files if sku == "research-bundle" else {sku: files[sku]}
        with zipfile.ZipFile(destination / (sku + ".zip"), "w", zipfile.ZIP_DEFLATED) as archive:
            for name, content in selected.values():
                archive.writestr(name + ".md", content)
                archive.writestr(name + ".txt", content)
            archive.writestr(
                "使用说明.txt",
                "本商品为 AI 选股研究流程提示词，不包含行情、股票名单或个股推荐。\n"
                "请自行提供可靠数据，不保证收益。Markdown 和 TXT 内容相同。\n"
                "售后联系：yuzhilinvip@163.com\n",
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    package(args.source, args.destination)
