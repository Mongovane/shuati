#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render scanned textbook PDF pages to web-friendly images for Markdown preview."""
from __future__ import annotations
import argparse, sys
from pathlib import Path

PDFDEPS = Path('/private/tmp/pdfdeps')
if PDFDEPS.exists():
    sys.path.insert(0, str(PDFDEPS))
try:
    import pypdfium2 as pdfium
except Exception as e:
    raise SystemExit(f'缺少 pypdfium2：{e}')

BOOKS = {
    'gaoshu-1': 'public/textbooks/高等数学 第八版 上册 (同济大学数学科学学院 编) .pdf',
    'gaoshu-2': 'public/textbooks/高等数学 第八版 下册 (同济大学数学科学学院 编) .pdf',
    'gaoshu-solutions-1': 'public/textbooks/高等数学习题全解指导 上册 同济（第八版） (同济大学数学科学学院).pdf',
    'gaoshu-solutions-2': 'public/textbooks/高等数学习题全解指导 下册 同济（第八版） (同济大学数学科学学院).pdf',
    'c-programming': 'public/textbooks/C程序设计（第五版） (谭浩强) (OCR扫描版).pdf',
    'data-structure': 'public/textbooks/数据结构（C语言版）（第2版） (严蔚敏 李冬梅 吴伟民)  .pdf',
    'maogai-true-pdf': 'public/textbooks/毛泽东思想和中国特色社会主义理论体系概论（2023年版）（True PDF）.pdf',
    'maogai-ocr-scan': 'public/textbooks/毛泽东思想和中国特色社会主义理论体系概论（2023年版）（OCR 扫描版）.pdf',
}

def render_book(book_id: str, dpi: int, quality: int, force: bool, start: int, end: int):
    pdf_path = Path(BOOKS[book_id])
    out_dir = Path('public/textbooks-pages') / book_id
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(str(pdf_path))
    n = len(pdf)
    s = max(1, start or 1)
    e = min(n, end or n)
    print(f'{book_id}: pages={n}, render={s}-{e}, dpi={dpi}, quality={quality}, out={out_dir}', flush=True)
    done = skipped = 0
    try:
        for page_no in range(s, e + 1):
            out = out_dir / f'{page_no:04d}.jpg'
            if out.exists() and out.stat().st_size > 1000 and not force:
                skipped += 1
            else:
                page = pdf[page_no - 1]
                try:
                    bitmap = page.render(scale=dpi / 72, rotation=0)
                    img = bitmap.to_pil().convert('RGB')
                    img.save(out, 'JPEG', quality=quality, optimize=True)
                finally:
                    page.close()
                done += 1
            if (done + skipped) % 25 == 0:
                print(f'progress {done+skipped}/{e-s+1} rendered={done} skipped={skipped}', flush=True)
    finally:
        pdf.close()
    print(f'finished rendered={done} skipped={skipped}', flush=True)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--book', choices=sorted(BOOKS), required=True)
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--quality', type=int, default=72)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--end', type=int, default=0)
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    render_book(args.book, args.dpi, args.quality, args.force, args.start, args.end)
