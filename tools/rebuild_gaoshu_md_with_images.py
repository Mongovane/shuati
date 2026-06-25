#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild Gaoshu markdown with original page images + collapsible OCR text.

OCR is kept only for search; page images are the authoritative visual source for formulas/layout.
"""
from pathlib import Path
import json

BOOKS = {
  'gaoshu-1': {
    'title':'高等数学（上册）',
    'source_pdf':'../textbooks/高等数学 第八版 上册 (同济大学数学科学学院 编) .pdf',
    'ocr_dir':Path('tmp/ocr-pages/gaoshu-1'),
    'img_dir':Path('public/textbooks-pages/gaoshu-1'),
    'text_file':Path('public/textbooks-text/gaoshu-1.md'),
    'notes_dir':Path('public/textbooks-notes/gaoshu-1'),
    'chapters':[('1','函数与极限',18,87),('2','导数与微分',88,138),('3','微分中值定理与导数的应用',139,196),('4','不定积分',197,235),('5','定积分',236,283),('6','定积分的应用',284,305),('7','微分方程',306,370)],
  },
  'gaoshu-2': {
    'title':'高等数学（下册）',
    'source_pdf':'../textbooks/高等数学 第八版 下册 (同济大学数学科学学院 编) .pdf',
    'ocr_dir':Path('tmp/ocr-pages/gaoshu-2'),
    'img_dir':Path('public/textbooks-pages/gaoshu-2'),
    'text_file':Path('public/textbooks-text/gaoshu-2.md'),
    'notes_dir':Path('public/textbooks-notes/gaoshu-2'),
    'chapters':[('8','向量代数与空间解析几何',8,58),('9','多元函数微分法及其应用',59,136),('10','重积分',137,186),('11','曲线积分与曲面积分',187,246),('12','无穷级数',247,320),('A','习题答案与提示',321,354)],
  },
  'gaoshu-solutions-1': {
    'title':'高数习题全解（上册）',
    'source_pdf':'../textbooks/高等数学习题全解指导 上册 同济（第八版） (同济大学数学科学学院).pdf',
    'ocr_dir':Path('tmp/ocr-pages/gaoshu-solutions-1'),
    'img_dir':Path('public/textbooks-pages/gaoshu-solutions-1'),
    'text_file':Path('public/textbooks-text/gaoshu-solutions-1.md'),
    'notes_dir':Path('public/textbooks-notes/gaoshu-solutions-1'),
    'chapters':[('1','函数与极限习题全解',14,59),('2','导数与微分习题全解',60,101),('3','微分中值定理与导数的应用习题全解',102,152),('4','不定积分习题全解',153,209),('5','定积分习题全解',210,231),('6','定积分的应用习题全解',232,265),('7','微分方程习题全解',266,342),('E','考研数学试题选解与附录',343,393)],
  },
  'gaoshu-solutions-2': {
    'title':'高数习题全解（下册）',
    'source_pdf':'../textbooks/高等数学习题全解指导 下册 同济（第八版） (同济大学数学科学学院).pdf',
    'ocr_dir':Path('tmp/ocr-pages/gaoshu-solutions-2'),
    'img_dir':Path('public/textbooks-pages/gaoshu-solutions-2'),
    'text_file':Path('public/textbooks-text/gaoshu-solutions-2.md'),
    'notes_dir':Path('public/textbooks-notes/gaoshu-solutions-2'),
    'chapters':[('8','向量代数与空间解析几何习题全解',8,43),('9','多元函数微分法及其应用习题全解',44,103),('10','重积分习题全解',104,170),('11','曲线积分与曲面积分习题全解',171,224),('12','无穷级数习题全解',225,274),('E','考研数学试题选解与附录',275,328)],
  },
}

def read_page(book, n):
    p=book['ocr_dir']/f'{n:04d}.txt'
    return p.read_text(encoding='utf-8', errors='replace').strip() if p.exists() else ''

def page_img_rel_from_text(book_id, n):
    return f'../textbooks-pages/{book_id}/{n:04d}.jpg'

def page_img_rel_from_note(book_id, n):
    return f'../../textbooks-pages/{book_id}/{n:04d}.jpg'

def chapter_file(ch):
    if str(ch).isdigit(): return f'chapter-{int(ch):02d}.md'
    return 'appendix-answers.md' if ch == 'A' else 'exam-selected.md'

def label(ch,title):
    return f'第 {ch} 章 {title}' if str(ch).isdigit() else title

def page_block(book_id, n, text, rel_func):
    img=rel_func(book_id,n)
    safe=text if text else '（本页 OCR 无文本或识别为空）'
    return f'''## 第 {n} 页\n\n![第 {n} 页原图]({img})\n\n<details>\n<summary>OCR 文字（仅用于检索，公式/版式以图片为准）</summary>\n\n```text\n{safe}\n```\n\n</details>\n'''

def build(book_id):
    b=BOOKS[book_id]
    pages=sorted(int(p.stem) for p in b['ocr_dir'].glob('*.txt'))
    img_pages=sorted(int(p.stem) for p in b['img_dir'].glob('*.jpg'))
    total_chars=sum(len(read_page(b,n)) for n in pages)
    # full text md with image pages
    out=[f"# {b['title']}","",f"- 原始 PDF：`{b['source_pdf']}`",f"- 页数：{max(pages) if pages else 0}",f"- 页面图片：{len(img_pages)}",f"- OCR 文字页：{len(pages)}",f"- OCR 字符数：{total_chars}","","> 重要：扫描版 OCR 无法可靠还原数学公式、符号和版式。本文件以每页原图为准，OCR 文字折叠保留，仅用于搜索/复制草稿。",""]
    for ch,title,start,end in b['chapters']:
        out.append(f"- [{label(ch,title)}](../textbooks-notes/{book_id}/{chapter_file(ch)})")
    out.append('')
    for n in pages:
        out.append(page_block(book_id,n,read_page(b,n),page_img_rel_from_text))
    b['text_file'].write_text('\n'.join(out), encoding='utf-8')

    # notes md
    b['notes_dir'].mkdir(parents=True, exist_ok=True)
    metas=[]
    for ch,title,start,end in b['chapters']:
        chars=sum(len(read_page(b,n)) for n in range(start,end+1))
        fname=chapter_file(ch)
        md=[f"# {label(ch,title)}","",f"- 来源：{b['title']}",f"- PDF 页码范围：{start}-{end}",f"- 页面图片范围：`public/textbooks-pages/{book_id}/{start:04d}.jpg` - `{end:04d}.jpg`",f"- OCR 字符数：{chars}","","> 重要：本章以页面原图为准；OCR 文字只用于检索，不再尝试用纯文本还原公式/排版。",""]
        md += ["## 页面目录",""]
        md += [f"- [第 {n} 页](#第-{n}-页)" for n in range(start,end+1)]
        md.append('')
        for n in range(start,end+1):
            md.append(page_block(book_id,n,read_page(b,n),page_img_rel_from_note))
        (b['notes_dir']/fname).write_text('\n'.join(md), encoding='utf-8')
        metas.append({'chapter':ch,'title':title,'file':f'textbooks-notes/{book_id}/{fname}','page':start,'endPage':end,'chars':chars,'images':end-start+1,'sections':[]})
    readme=[f"# {b['title']} 章节整理","","> 已改为“页面原图 + 折叠 OCR 文本”。原图用于阅读与公式校对，OCR 只用于检索。",""]
    for c in metas:
        readme.append(f"- [{label(c['chapter'],c['title'])}]({chapter_file(c['chapter'])})：PDF 页 {c['page']}-{c['endPage']}，图片 {c['images']} 页")
    b['notes_dir'].joinpath('README.md').write_text('\n'.join(readme)+"\n", encoding='utf-8')
    return {'id':book_id,'title':b['title'],'chapters':metas,'source':str(b['text_file']).replace('public/','')}

if __name__ == '__main__':
    metas=[build(x) for x in BOOKS]
    # merge catalog
    cat_path=Path('public/textbooks-notes/catalog.json')
    old=json.loads(cat_path.read_text(encoding='utf-8')) if cat_path.exists() else []
    by={x['id']:x for x in old}
    for m in metas: by[m['id']]=m
    order=['gaoshu-1','gaoshu-2','gaoshu-solutions-1','gaoshu-solutions-2','c-programming','data-structure','maogai-true-pdf']
    ordered=[by[i] for i in order if i in by]+[x for i,x in by.items() if i not in order]
    cat_path.write_text(json.dumps(ordered, ensure_ascii=False, indent=2)+"\n", encoding='utf-8')
    # global readme
    lines=['# 教材章节整理索引','', '> 高数教材与习题全解已改成“页面原图 + 折叠 OCR 文本”。OCR 仅用于检索，公式和格式以页面图片为准。','']
    for book in ordered:
        lines += [f"## {book['title']}", '']
        for c in book.get('chapters',[]):
            ch=str(c.get('chapter',''))
            lines.append(f"- [{label(ch,c['title']) if ch.isdigit() else c['title']}]({c['file']})")
        lines.append('')
    Path('public/textbooks-notes/README.md').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps(metas, ensure_ascii=False, indent=2))
