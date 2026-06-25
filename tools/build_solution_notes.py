#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from pathlib import Path
import json, re

BOOKS = {
  'gaoshu-solutions-1': {
    'title':'高数习题全解（上册）',
    'source_pdf':'../textbooks/高等数学习题全解指导 上册 同济（第八版） (同济大学数学科学学院).pdf',
    'ocr_dir':Path('tmp/ocr-pages/gaoshu-solutions-1'),
    'text_file':Path('public/textbooks-text/gaoshu-solutions-1.md'),
    'notes_dir':Path('public/textbooks-notes/gaoshu-solutions-1'),
    # PDF 页码为扫描 PDF 页序；章节边界按 OCR 目录/页眉粗分。
    'chapters':[
      ('1','函数与极限习题全解',14,59),
      ('2','导数与微分习题全解',60,101),
      ('3','微分中值定理与导数的应用习题全解',102,152),
      ('4','不定积分习题全解',153,209),
      ('5','定积分习题全解',210,231),
      ('6','定积分的应用习题全解',232,265),
      ('7','微分方程习题全解',266,342),
      ('E','考研数学试题选解与附录',343,393),
    ],
  },
  'gaoshu-solutions-2': {
    'title':'高数习题全解（下册）',
    'source_pdf':'../textbooks/高等数学习题全解指导 下册 同济（第八版） (同济大学数学科学学院).pdf',
    'ocr_dir':Path('tmp/ocr-pages/gaoshu-solutions-2'),
    'text_file':Path('public/textbooks-text/gaoshu-solutions-2.md'),
    'notes_dir':Path('public/textbooks-notes/gaoshu-solutions-2'),
    'chapters':[
      ('8','向量代数与空间解析几何习题全解',8,43),
      ('9','多元函数微分法及其应用习题全解',44,103),
      ('10','重积分习题全解',104,170),
      ('11','曲线积分与曲面积分习题全解',171,224),
      ('12','无穷级数习题全解',225,274),
      ('E','考研数学试题选解与附录',275,328),
    ],
  }
}

section_pat = re.compile(r'^(习题\s*\d+\s*-\s*\d+|总习题[一二三四五六七八九十0-9]+|第[一二三四五六七八九十0-9]+章)\s*[”"“，。:：、 ]*(.{0,45})')
noise = re.compile(r'[A-Za-z]{8,}|[.·。]{4,}|[=_\-]{4,}')

def read_page(ocr_dir, n):
    p=ocr_dir/f'{n:04d}.txt'
    return p.read_text(encoding='utf-8', errors='replace').strip() if p.exists() else ''

def clean_title(s):
    s=re.sub(r'[`*_#\[\]()]+','',s)
    s=re.sub(r'\s+',' ',s).strip(' ：:，,。.;；"“”')
    return s[:90]

def extract_sections(text):
    out=[]; seen=set()
    for line in text.splitlines():
        l=line.strip()
        if not l or len(l)>100: continue
        m=section_pat.match(l)
        if not m: continue
        item=clean_title((m.group(1)+' '+m.group(2)).strip())
        if noise.search(item): item=clean_title(m.group(1))
        item=re.sub(r'\s*-\s*','-',item)
        if item and item not in seen:
            seen.add(item); out.append(item)
        if len(out)>=60: break
    return out

def chapter_filename(ch):
    return f'chapter-{int(ch):02d}.md' if str(ch).isdigit() else 'exam-selected.md'

def chapter_label(ch,title):
    return f'第 {ch} 章 {title}' if str(ch).isdigit() else title

def build(book_id):
    b=BOOKS[book_id]
    pages=sorted(int(p.stem) for p in b['ocr_dir'].glob('*.txt'))
    total_chars=sum(len(read_page(b['ocr_dir'],n)) for n in pages)
    lines=[f"# {b['title']}","",f"- 原始 PDF：`{b['source_pdf']}`",f"- 页数：{max(pages) if pages else 0}",f"- OCR 文字页：{len(pages)}",f"- OCR 字符数：{total_chars}","","> 本文件由本地 Tesseract OCR 自动提取生成，供个人学习检索和整理使用；扫描版识别难免有错别字与公式误识别。",""]
    for n in pages:
        lines += [f"## 第 {n} 页","",read_page(b['ocr_dir'],n),""]
    b['text_file'].write_text('\n'.join(lines), encoding='utf-8')

    b['notes_dir'].mkdir(parents=True, exist_ok=True)
    metas=[]
    for ch,title,start,end in b['chapters']:
        chunks=[]
        for n in range(start,end+1):
            t=read_page(b['ocr_dir'],n)
            if t: chunks.append(f"## 第 {n} 页\n\n{t}")
        text='\n\n'.join(chunks).strip()+"\n"
        sections=extract_sections(text)
        fname=chapter_filename(ch)
        out=[f"# {chapter_label(ch,title)}","",f"- 来源：{b['title']}",f"- PDF 页码范围：{start}-{end}",f"- OCR 字符数：{len(text)}","","> OCR 自动识别文本，公式、符号和个别汉字可能需要人工校对。",""]
        if sections:
            out += ["## 习题/小节索引",""] + [f"- {s}" for s in sections] + [""]
        out += ["## OCR 原文","",text]
        (b['notes_dir']/fname).write_text('\n'.join(out), encoding='utf-8')
        metas.append({'chapter':ch,'title':title,'file':f'textbooks-notes/{book_id}/{fname}','page':start,'endPage':end,'chars':len(text),'sections':sections})
    readme=[f"# {b['title']} 章节整理","","> 基于本地 Tesseract OCR 识别结果自动拆分。页码边界为 OCR 粗分，适合检索与后续人工校对。",""]
    for c in metas:
        readme.append(f"- [{chapter_label(c['chapter'],c['title'])}]({chapter_filename(c['chapter'])})：约 {c['chars']} 字，PDF 页 {c['page']}-{c['endPage']}")
    b['notes_dir'].joinpath('README.md').write_text('\n'.join(readme)+"\n", encoding='utf-8')
    return {'id':book_id,'title':b['title'],'chapters':metas,'source':str(b['text_file']).replace('public/','')}

if __name__=='__main__':
    metas=[build(x) for x in ['gaoshu-solutions-1','gaoshu-solutions-2']]
    print(json.dumps(metas,ensure_ascii=False,indent=2))
