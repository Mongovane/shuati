#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild non-Gaoshu textbook markdown with page images plus folded searchable text.

This avoids pretending imperfect OCR/text extraction is faithful layout. The rendered
page image is the readable source; extracted/OCR text is kept in a fenced block only
for search and rough copying.
"""
from pathlib import Path
import json, re

BOOKS = {
  'c-programming': {
    'title':'C 程序设计',
    'source_pdf':'../textbooks/C程序设计（第五版） (谭浩强) (OCR扫描版).pdf',
    'old_text':Path('public/textbooks-text/c-programming.md'),
    'img_dir':Path('public/textbooks-pages/c-programming'),
    'text_file':Path('public/textbooks-text/c-programming.md'),
    'notes_dir':Path('public/textbooks-notes/c-programming'),
    # PDF page numbers. Front matter/TOC is before chapter 1.
    'front':('F','前言与目录',1,23),
    'chapters':[
      ('1','程序设计和 C 语言',24,37),
      ('2','算法——程序的灵魂',38,59),
      ('3','最简单的 C 程序设计——顺序程序设计',60,105),
      ('4','选择结构程序设计',106,132),
      ('5','循环结构程序设计',133,161),
      ('6','利用数组处理批量数据',162,189),
      ('7','用函数实现模块化程序设计',190,239),
      ('8','善于利用指针',240,315),
      ('9','用户自己建立数据类型',316,355),
      ('10','对文件的输入输出',356,395),
    ],
  },
  'data-structure': {
    'title':'数据结构',
    'source_pdf':'../textbooks/数据结构（C语言版）（第2版） (严蔚敏 李冬梅 吴伟民)  .pdf',
    'old_text':Path('public/textbooks-text/data-structure.md'),
    'img_dir':Path('public/textbooks-pages/data-structure'),
    'text_file':Path('public/textbooks-text/data-structure.md'),
    'notes_dir':Path('public/textbooks-notes/data-structure'),
    'front':('F','前言与目录',1,9),
    'chapters':[
      ('1','绪论',10,26),
      ('2','线性表',27,60),
      ('3','栈和队列',61,92),
      ('4','串、数组和广义表',93,114),
      ('5','树和二叉树',115,151),
      ('6','图',152,193),
      ('7','查找',194,235),
      ('8','排序',236,274),
    ],
  },
  'maogai-true-pdf': {
    'title':'毛概（True PDF）',
    'source_pdf':'../textbooks/毛泽东思想和中国特色社会主义理论体系概论（2023年版）（True PDF）.pdf',
    'old_text':Path('public/textbooks-text/maogai-true-pdf.md'),
    'img_dir':Path('public/textbooks-pages/maogai-true-pdf'),
    'text_file':Path('public/textbooks-text/maogai-true-pdf.md'),
    'notes_dir':Path('public/textbooks-notes/maogai-true-pdf'),
    'front':('F','封面、版权与目录',1,11),
    'chapters':[
      ('0','导论：马克思主义中国化时代化的历史进程与理论成果',12,23),
      ('1','毛泽东思想及其历史地位',24,47),
      ('2','新民主主义革命理论',48,75),
      ('3','社会主义改造理论',76,101),
      ('4','社会主义建设道路初步探索的理论成果',102,126),
      ('5','中国特色社会主义理论体系的形成发展',127,158),
      ('6','邓小平理论',159,199),
      ('7','“三个代表”重要思想',200,236),
      ('8','科学发展观',237,278),
    ],
  },
  'maogai-ocr-scan': {
    'title':'毛概（OCR 扫描版）',
    'source_pdf':'../textbooks/毛泽东思想和中国特色社会主义理论体系概论（2023年版）（OCR 扫描版）.pdf',
    'old_text':Path('public/textbooks-text/maogai-ocr-scan.md'),
    'img_dir':Path('public/textbooks-pages/maogai-ocr-scan'),
    'text_file':Path('public/textbooks-text/maogai-ocr-scan.md'),
    'notes_dir':Path('public/textbooks-notes/maogai-ocr-scan'),
    'front':('F','封面、版权与目录',1,11),
    'chapters':[
      ('0','导论：马克思主义中国化时代化的历史进程与理论成果',12,25),
      ('1','毛泽东思想及其历史地位',26,49),
      ('2','新民主主义革命理论',50,77),
      ('3','社会主义改造理论',78,103),
      ('4','社会主义建设道路初步探索的理论成果',104,128),
      ('5','中国特色社会主义理论体系的形成发展',129,160),
      ('6','邓小平理论',161,201),
      ('7','“三个代表”重要思想',202,238),
      ('8','科学发展观',239,280),
    ],
  },
}

page_head_re = re.compile(r'^## 第\s*(\d+)\s*页\s*$', re.M)

def parse_pages(md_path: Path):
    text = md_path.read_text(encoding='utf-8', errors='replace')
    matches=list(page_head_re.finditer(text))
    pages={}
    for i,m in enumerate(matches):
        n=int(m.group(1))
        start=m.end()
        end=matches[i+1].start() if i+1<len(matches) else len(text)
        pages[n]=text[start:end].strip()
    return pages

def filename(ch):
    if ch == 'F': return 'front-matter.md'
    if str(ch).isdigit(): return f'chapter-{int(ch):02d}.md'
    return f'section-{ch}.md'

def label(ch,title):
    if ch == 'F': return title
    if str(ch).isdigit() and ch != '0': return f'第 {ch} 章 {title}'
    return title

def img_rel_from_text(book_id,n): return f'../textbooks-pages/{book_id}/{n:04d}.jpg'
def img_rel_from_note(book_id,n): return f'../../textbooks-pages/{book_id}/{n:04d}.jpg'

def block(book_id,n,txt,rel_func):
    txt = txt.strip() or '（本页无可提取文字；请以页面原图为准。）'
    # avoid accidentally closing fences/details from extracted text
    txt = txt.replace('```','｀｀｀').replace('</details>','&lt;/details&gt;')
    return f'''## 第 {n} 页\n\n![第 {n} 页原图]({rel_func(book_id,n)})\n\n<details>\n<summary>检索文本（仅辅助搜索/复制，阅读与题目格式以图片为准）</summary>\n\n```text\n{txt}\n```\n\n</details>\n'''

def build(book_id):
    b=BOOKS[book_id]
    pages=parse_pages(b['old_text'])
    img_pages=sorted(int(p.stem) for p in b['img_dir'].glob('*.jpg'))
    all_sections=[b['front']]+b['chapters']
    total_chars=sum(len(v) for v in pages.values())

    full=[f"# {b['title']}","",f"- 原始 PDF：`{b['source_pdf']}`",f"- PDF 页数：{len(img_pages)}",f"- 页面图片：{len(img_pages)}",f"- 检索文本页：{len(pages)}",f"- 检索文本字符数：{total_chars}","","> 重要：本书已改成“页面原图 + 折叠检索文本”。题目、代码、公式、表格和版式请看页面原图；折叠文本只用于搜索和复制草稿，避免 OCR/抽取文字造成逻辑错乱。",""]
    full += ["## 章节入口",""]
    for ch,title,start,end in all_sections:
        full.append(f"- [{label(ch,title)}](../textbooks-notes/{book_id}/{filename(ch)})：PDF 页 {start}-{end}")
    full.append('')
    for n in img_pages:
        full.append(block(book_id,n,pages.get(n,''),img_rel_from_text))
    b['text_file'].write_text('\n'.join(full), encoding='utf-8')

    b['notes_dir'].mkdir(parents=True, exist_ok=True)
    metas=[]
    for ch,title,start,end in all_sections:
        nums=[n for n in range(start,end+1) if n in img_pages]
        chars=sum(len(pages.get(n,'')) for n in nums)
        md=[f"# {label(ch,title)}","",f"- 来源：{b['title']}",f"- PDF 页码范围：{start}-{end}",f"- 页面图片范围：`public/textbooks-pages/{book_id}/{start:04d}.jpg` - `{end:04d}.jpg`",f"- 检索文本字符数：{chars}","","> 阅读顺序按 PDF 原页排列；题目、代码缩进、图表和公式以页面原图为准。检索文本已折叠，避免误识别文字破坏题目逻辑。",""]
        md += ["## 页面目录",""] + [f"- [第 {n} 页](#第-{n}-页)" for n in nums] + [""]
        for n in nums:
            md.append(block(book_id,n,pages.get(n,''),img_rel_from_note))
        (b['notes_dir']/filename(ch)).write_text('\n'.join(md), encoding='utf-8')
        if ch != 'F':
            metas.append({'chapter':ch,'title':title,'file':f'textbooks-notes/{book_id}/{filename(ch)}','page':start,'endPage':end,'chars':chars,'images':len(nums),'sections':[]})
    readme=[f"# {b['title']} 章节整理","","> 已统一为“页面原图 + 折叠检索文本”。请按原图阅读题目/代码/公式，文本只用于检索。",""]
    readme.append(f"- [前言与目录]({filename('F')})：PDF 页 {b['front'][2]}-{b['front'][3]}")
    for c in metas:
        readme.append(f"- [{label(c['chapter'],c['title'])}]({filename(c['chapter'])})：PDF 页 {c['page']}-{c['endPage']}，图片 {c['images']} 页")
    b['notes_dir'].joinpath('README.md').write_text('\n'.join(readme)+"\n", encoding='utf-8')
    return {'id':book_id,'title':b['title'],'chapters':metas,'source':str(b['text_file']).replace('public/','')}

if __name__=='__main__':
    metas=[build(i) for i in BOOKS]
    cat_path=Path('public/textbooks-notes/catalog.json')
    old=json.loads(cat_path.read_text(encoding='utf-8')) if cat_path.exists() else []
    by={x['id']:x for x in old}
    for m in metas: by[m['id']]=m
    order=['gaoshu-1','gaoshu-2','gaoshu-solutions-1','gaoshu-solutions-2','c-programming','data-structure','maogai-true-pdf','maogai-ocr-scan']
    ordered=[by[i] for i in order if i in by]+[x for i,x in by.items() if i not in order]
    cat_path.write_text(json.dumps(ordered,ensure_ascii=False,indent=2)+"\n", encoding='utf-8')
    lines=['# 教材章节整理索引','', '> 所有教材已统一为“页面原图 + 折叠检索文本”。题目、代码、公式、表格和版式以页面图片为准，检索文本仅用于搜索/复制草稿。','']
    for book in ordered:
        lines += [f"## {book['title']}", '']
        for c in book.get('chapters',[]):
            lines.append(f"- [{label(str(c.get('chapter','')),c['title'])}]({c['file']})")
        lines.append('')
    Path('public/textbooks-notes/README.md').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps(metas,ensure_ascii=False,indent=2))
