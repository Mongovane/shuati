#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OCR textbook PDF pages with pypdfium2 + local tesseract.

Outputs one txt per page into tmp/ocr-pages/<book-id>/NNNN.txt.
Designed to resume: existing non-empty txt files are skipped unless --force.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
from pathlib import Path
import subprocess
import sys
import tempfile

# pypdfium2 was installed into /private/tmp/pdfdeps for this workspace.
PDFDEPS = Path('/private/tmp/pdfdeps')
if PDFDEPS.exists():
    sys.path.insert(0, str(PDFDEPS))

try:
    import pypdfium2 as pdfium
except Exception as e:
    raise SystemExit(f'缺少 pypdfium2：{e}\n可运行：python3 -m pip install --target /private/tmp/pdfdeps pypdfium2')

BOOKS = {
    'gaoshu-1': 'public/textbooks/高等数学 第八版 上册 (同济大学数学科学学院 编) .pdf',
    'gaoshu-2': 'public/textbooks/高等数学 第八版 下册 (同济大学数学科学学院 编) .pdf',
    'gaoshu-solutions-1': 'public/textbooks/高等数学习题全解指导 上册 同济（第八版） (同济大学数学科学学院).pdf',
    'gaoshu-solutions-2': 'public/textbooks/高等数学习题全解指导 下册 同济（第八版） (同济大学数学科学学院).pdf',
}

def page_count(pdf_path: Path) -> int:
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        return len(pdf)
    finally:
        pdf.close()

def render_page(pdf_path: Path, page_no: int, out_png: Path, dpi: int) -> None:
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        page = pdf[page_no - 1]
        try:
            bitmap = page.render(scale=dpi / 72, rotation=0)
            pil = bitmap.to_pil()
            # RGB is safer for tesseract than palette/alpha images.
            if pil.mode not in ('RGB', 'L'):
                pil = pil.convert('RGB')
            pil.save(out_png)
        finally:
            page.close()
    finally:
        pdf.close()

def ocr_one(args_tuple):
    pdf_path, out_dir, page_no, dpi, lang, force = args_tuple
    out_txt = (out_dir / f'{page_no:04d}.txt').resolve()
    if out_txt.exists() and out_txt.stat().st_size > 10 and not force:
        return page_no, 'skip', out_txt.stat().st_size, ''
    Path('tmp/ocr-render').mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ocr-page-', dir='tmp/ocr-render') as td:
        png = (Path(td) / f'{page_no:04d}.png').resolve()
        try:
            render_page(pdf_path, page_no, png, dpi)
            cmd = ['tesseract', str(png), 'stdout', '-l', lang, '--psm', '3']
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if proc.returncode != 0:
                return page_no, 'error', 0, proc.stderr[-500:].decode('utf-8', 'replace')
            text = proc.stdout.decode('utf-8', 'replace').replace('\r\n', '\n').strip() + '\n'
            out_txt.write_text(text, encoding='utf-8')
            return page_no, 'ocr', len(text), ''
        except Exception as e:
            return page_no, 'error', 0, repr(e)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--book', choices=sorted(BOOKS), required=True)
    ap.add_argument('--pdf', default='')
    ap.add_argument('--out-root', default='tmp/ocr-pages')
    ap.add_argument('--start', type=int, default=1)
    ap.add_argument('--end', type=int, default=0)
    ap.add_argument('--dpi', type=int, default=220)
    ap.add_argument('--lang', default='chi_sim+eng')
    ap.add_argument('--jobs', type=int, default=3)
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    pdf_path = Path(args.pdf or BOOKS[args.book])
    if not pdf_path.exists():
        raise SystemExit(f'PDF 不存在：{pdf_path}')
    n = page_count(pdf_path)
    start = max(1, args.start)
    end = min(n, args.end or n)
    out_dir = Path(args.out_root) / args.book
    out_dir.mkdir(parents=True, exist_ok=True)
    pages = list(range(start, end + 1))
    print(f'{args.book}: {pdf_path} pages={n}, OCR range={start}-{end}, jobs={args.jobs}, out={out_dir}', flush=True)

    done = skipped = errors = chars = 0
    with cf.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
        futs = [ex.submit(ocr_one, (pdf_path, out_dir, p, args.dpi, args.lang, args.force)) for p in pages]
        for fut in cf.as_completed(futs):
            page_no, status, size, err = fut.result()
            if status == 'skip':
                skipped += 1
            elif status == 'ocr':
                done += 1
                chars += size
            else:
                errors += 1
                print(f'ERROR page {page_no}: {err}', file=sys.stderr, flush=True)
            if (done + skipped + errors) % 10 == 0 or status == 'error':
                print(f'progress {done+skipped+errors}/{len(pages)} ocr={done} skip={skipped} errors={errors} chars={chars}', flush=True)
    print(f'finished ocr={done} skip={skipped} errors={errors} chars={chars}', flush=True)
    if errors:
        raise SystemExit(2)

if __name__ == '__main__':
    main()
