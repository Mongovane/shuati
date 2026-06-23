#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf_to_json.py — 把真题 / 题库 PDF 批量转成「专插本刷题系统」可导入的 JSON。

为什么省钱：在本地用便宜模型批量跑一次，生成 JSON 后你可以人工检查/修正，
再到网站「录题 → 直接导入 JSON」粘贴导入，导入本身完全不花 AI 费用。

依赖：
  pip install requests pdfplumber
  # 仅当 PDF 是扫描件（图片型）才需要 OCR，且要先装系统包：
  #   Ubuntu:  sudo apt install tesseract-ocr tesseract-ocr-chi-sim poppler-utils
  #   macOS :  brew install tesseract tesseract-lang poppler
  pip install pytesseract pdf2image Pillow

配置（密钥用环境变量，别写进命令行历史）：
  export AI_BASE_URL="https://你的中转站域名/v1"
  export AI_API_KEY="你的中转站密钥"
  export AI_MODEL="gpt-4o-mini"            # 可选，默认 gpt-4o-mini，便宜够用

基本用法：
  python pdf_to_json.py 真题2023.pdf -o out.json --subject computer --source "2023真题"

扫描件（图片型 PDF）：
  python pdf_to_json.py 扫描卷.pdf -o out.json --subject politics --ocr

直接推送到已部署的网站（省去手动复制导入）：
  export APP_TOKEN="你在 Cloudflare 设的访问口令"
  python pdf_to_json.py 真题.pdf --push https://你的项目.pages.dev --subject english
"""

import argparse
import json
import os
import re
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("缺少依赖：pip install requests")

SUBJECTS = {"politics", "english", "math", "chinese", "computer"}
VALID_TYPES = {"single_choice", "multiple_choice", "true_false",
               "fill_blank", "short_answer", "code"}

# 与网站 functions/api/process.js 完全一致的提示词，保证 JSON 结构对得上
SYSTEM_PROMPT = """你是专业的考试题库结构化助手，服务于「广东普通专升本（专插本）」备考。
任务：把用户提供的、可能格式混乱的题目原文，转换为严格符合下述结构的题目数组。

输出要求（务必遵守）：
1. 只输出一个 JSON 对象，形如 {"questions":[ ... ]}，不要任何解释文字或 Markdown 代码块标记。
2. 每道题对象字段：
   - subject: "politics"(政治) | "english"(英语) | "math"(高数) | "chinese"(大学语文) | "computer"(计算机基础与程序设计)。用户已指定科目时优先用指定值。
   - chapter: 章节/知识点（如「数据结构-线性表」「C语言-指针」「政治-马原-唯物史观」「英语-阅读理解」；不确定可留空字符串）。
   - type: "single_choice"(单选) | "multiple_choice"(多选) | "true_false"(判断) | "fill_blank"(填空) | "short_answer"(简答/论述/材料分析) | "code"(程序设计/手写代码)。
   - difficulty: 1~5 的整数，凭经验估计，默认 3。
   - source: 来源（如「2023真题」），不确定留空字符串。
   - passage: 阅读理解/完形填空的公共材料文本；无公共材料则空字符串。同一篇阅读的多个小题请拆成多道题，每道都重复带相同 passage。
   - stem: 题干（必填）。数学公式用 LaTeX，行内用 $...$、独立用 $$...$$；代码用 Markdown 围栏 ```c ... ``` 包裹。
   - options: 选择题选项数组，元素 {"key":"A","text":"..."}；非选择题为 []。
   - answer: 答案数组。single_choice/multiple_choice 用选项 key，如 ["B"] 或 ["A","C"]；true_false 用 ["T"](正确)/["F"](错误)；fill_blank 用各空标准答案字符串数组（按顺序）；short_answer/code 把参考答案文本放进数组首元素。
   - analysis: 解析；原文无解析则你补写一段简明解析，代码题给出关键思路。
   - tags: 关键词标签字符串数组。
3. 保持原意，不臆造题目；把混在一起的答案、解析正确归位到对应题目；非题目内容（目录、页码、广告等）忽略。"""


def extract_text(path, ocr=False, dpi=200):
    """从 PDF 提取文本；ocr=True 时对扫描件做 OCR。"""
    if ocr:
        try:
            from pdf2image import convert_from_path
            import pytesseract
        except ImportError:
            sys.exit("OCR 需要：pip install pytesseract pdf2image Pillow，并安装系统的 tesseract 与 poppler")
        print("  正在渲染 PDF 页面用于 OCR…", file=sys.stderr)
        pages = convert_from_path(path, dpi=dpi)
        out = []
        for i, img in enumerate(pages):
            out.append(pytesseract.image_to_string(img, lang="chi_sim+eng"))
            print(f"  OCR 第 {i + 1}/{len(pages)} 页", file=sys.stderr)
        return "\n".join(out)

    try:
        import pdfplumber
    except ImportError:
        sys.exit("缺少依赖：pip install pdfplumber")
    out = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            out.append(page.extract_text() or "")
    text = "\n".join(out)
    if len(text.strip()) < 50:
        print("⚠️  几乎没提取到文字，这很可能是扫描件（图片型 PDF）。请加 --ocr 重试。", file=sys.stderr)
    return text


def chunk_text(text, size=6000, overlap=200):
    """按字符数切块，尽量在换行处断开，避免把一道题切两半。"""
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    chunks, i, n = [], 0, len(text)
    while i < n:
        end = min(i + size, n)
        if end < n:
            br = text.rfind("\n", max(i, end - overlap), end)
            if br > i:
                end = br
        piece = text[i:end].strip()
        if piece:
            chunks.append(piece)
        i = end
    return chunks


def parse_questions(content):
    """从模型返回里稳健地解析出题目数组。"""
    t = content.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        obj = json.loads(t)
    except Exception:
        m = re.search(r"[\[{].*[\]}]", t, re.S)
        if not m:
            return []
        try:
            obj = json.loads(m.group(0))
        except Exception:
            return []
    arr = obj if isinstance(obj, list) else (obj.get("questions") or obj.get("data") or obj.get("items") or [])
    return [q for q in arr if isinstance(q, dict) and q.get("stem")]


def normalize(q, subject, chapter, source):
    t = q.get("type") if q.get("type") in VALID_TYPES else "single_choice"
    subj = q.get("subject") if q.get("subject") in SUBJECTS else subject
    ans = q.get("answer")
    if not isinstance(ans, list):
        ans = [ans] if ans is not None else []
    diff = q.get("difficulty")
    if not isinstance(diff, int) or diff < 1 or diff > 5:
        diff = 3
    return {
        "id": (str(q.get("id")).strip() if q.get("id") else ""),
        "subject": subj,
        "chapter": (q.get("chapter") or chapter or "").strip(),
        "type": t,
        "difficulty": diff,
        "source": (q.get("source") or source or "").strip(),
        "passage": (q.get("passage") or "").strip(),
        "stem": str(q.get("stem", "")),
        "options": q.get("options") if isinstance(q.get("options"), list) else [],
        "answer": ans,
        "analysis": (q.get("analysis") or "").strip(),
        "tags": q.get("tags") if isinstance(q.get("tags"), list) else [],
    }


def call_llm(base, key, model, chunk, subject, chapter, source, retries=3):
    url = base.rstrip("/") + "/chat/completions"
    hint = f'本批默认科目 subject="{subject}"。'
    if chapter:
        hint += f' 默认章节「{chapter}」。'
    if source:
        hint += f' 默认来源「{source}」。'
    user = hint + '\n\n请把下面的原文结构化为 JSON：\n\n"""\n' + chunk + '\n"""'
    payload = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    for attempt in range(retries):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=180)
            if r.status_code != 200:
                print(f"    API {r.status_code}: {r.text[:200]}", file=sys.stderr)
                time.sleep(2)
                continue
            content = r.json()["choices"][0]["message"]["content"]
            return parse_questions(content)
        except Exception as e:
            print(f"    调用失败({attempt + 1}/{retries})：{e}", file=sys.stderr)
            time.sleep(2)
    return []


def push_to_site(base_url, questions, subject, batch=40):
    """把题目分批推送到已部署网站的 /api/process。"""
    token = os.environ.get("APP_TOKEN")
    if not token:
        sys.exit("使用 --push 需要先 export APP_TOKEN=你的访问口令")
    url = base_url.rstrip("/") + "/api/process"
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    total = 0
    for i in range(0, len(questions), batch):
        part = questions[i:i + batch]
        r = requests.post(url, headers=headers, json={"subject": subject, "questions": part}, timeout=120)
        if r.status_code != 200:
            print(f"  推送失败 {r.status_code}: {r.text[:200]}", file=sys.stderr)
            continue
        n = r.json().get("inserted", 0)
        total += n
        print(f"  已推送 {i + len(part)}/{len(questions)}（本批入库 {n}）")
    print(f"✓ 推送完成，服务端共入库约 {total} 题")


def main():
    ap = argparse.ArgumentParser(description="把真题 PDF 批量转成刷题系统可导入的 JSON")
    ap.add_argument("pdf", help="输入的 PDF 文件路径")
    ap.add_argument("-o", "--out", default="questions.json", help="输出 JSON 文件（默认 questions.json）")
    ap.add_argument("--subject", required=True, choices=sorted(SUBJECTS), help="默认科目")
    ap.add_argument("--chapter", default="", help="默认章节（可选）")
    ap.add_argument("--source", default="", help="默认来源，如 2023真题（可选）")
    ap.add_argument("--ocr", action="store_true", help="对扫描件做 OCR（需系统 tesseract+poppler）")
    ap.add_argument("--chunk", type=int, default=6000, help="每块字符数（默认 6000）")
    ap.add_argument("--model", default=os.environ.get("AI_MODEL", "gpt-4o-mini"), help="模型名（默认 gpt-4o-mini）")
    ap.add_argument("--push", metavar="BASE_URL", default="", help="直接推送到网站，如 https://xxx.pages.dev")
    args = ap.parse_args()

    base = os.environ.get("AI_BASE_URL")
    key = os.environ.get("AI_API_KEY")
    if not base or not key:
        sys.exit("请先设置环境变量 AI_BASE_URL 与 AI_API_KEY")
    if not os.path.isfile(args.pdf):
        sys.exit(f"找不到文件：{args.pdf}")

    print(f"读取 PDF：{args.pdf}")
    text = extract_text(args.pdf, ocr=args.ocr)
    chunks = chunk_text(text, size=args.chunk)
    if not chunks:
        sys.exit("没有可处理的文本。若是扫描件请加 --ocr。")
    print(f"切分为 {len(chunks)} 块，使用模型 {args.model} 开始解析…\n")

    all_q, seen = [], set()
    for idx, ch in enumerate(chunks):
        print(f"[{idx + 1}/{len(chunks)}] 解析中…", flush=True)
        for q in call_llm(base, key, args.model, ch, args.subject, args.chapter, args.source):
            nq = normalize(q, args.subject, args.chapter, args.source)
            dedup_key = re.sub(r"\s+", "", nq["stem"])[:60]
            if not dedup_key or dedup_key in seen:
                continue
            seen.add(dedup_key)
            all_q.append(nq)
        print(f"    累计 {len(all_q)} 题", flush=True)

    print(f"\n共解析出 {len(all_q)} 道题。")
    if not all_q:
        sys.exit("没有解析到题目，建议换更强的模型或检查 PDF 内容。")

    if args.push:
        push_to_site(args.push, all_q, args.subject)
    else:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(all_q, f, ensure_ascii=False, indent=2)
        print(f"✓ 已写入 {args.out}")
        print("  下一步：到网站「录题 → 直接导入 JSON」粘贴它的内容，导入不花 AI 钱。")
        print("  建议先快速过一遍 JSON，核对答案与题型是否正确。")


if __name__ == "__main__":
    main()
