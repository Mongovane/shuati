#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from pathlib import Path
import json, re

BOOKS = {
  'gaoshu-1': {
    'title':'高等数学（上册）',
    'source_pdf':'../textbooks/高等数学 第八版 上册 (同济大学数学科学学院 编) .pdf',
    'ocr_dir':Path('tmp/ocr-pages/gaoshu-1'),
    'text_file':Path('public/textbooks-text/gaoshu-1.md'),
    'notes_dir':Path('public/textbooks-notes/gaoshu-1'),
    'chapters':[
      ('1','函数与极限',18,87),
      ('2','导数与微分',88,138),
      ('3','微分中值定理与导数的应用',139,196),
      ('4','不定积分',197,235),
      ('5','定积分',236,283),
      ('6','定积分的应用',284,305),
      ('7','微分方程',306,370),
    ],
  },

  'gaoshu-2': {
    'title':'高等数学（下册）',
    'source_pdf':'../textbooks/高等数学 第八版 下册 (同济大学数学科学学院 编) .pdf',
    'ocr_dir':Path('tmp/ocr-pages/gaoshu-2'),
    'text_file':Path('public/textbooks-text/gaoshu-2.md'),
    'notes_dir':Path('public/textbooks-notes/gaoshu-2'),
    'chapters':[
      ('8','向量代数与空间解析几何',8,58),
      ('9','多元函数微分法及其应用',59,136),
      ('10','重积分',137,186),
      ('11','曲线积分与曲面积分',187,246),
      ('12','无穷级数',247,320),
      ('A','习题答案与提示',321,354),
    ],
  },
}

section_pat = re.compile(r'^(第[一二三四五六七八九十]+节|总习题[一二三四五六七八九十0-9]+|习题\s*\d+-\d+)\s*[”"“，。:：、 ]*(.{0,40})')
noise = re.compile(r'[A-Za-z]{5,}|[.·。]{4,}|[=_\-]{4,}')

def read_page(ocr_dir, n):
    p=ocr_dir/f'{n:04d}.txt'
    return p.read_text(encoding='utf-8', errors='replace').strip() if p.exists() else ''

def clean_title(s):
    s=re.sub(r'[`*_#\[\]()]+','',s)
    s=re.sub(r'\s+',' ',s).strip(' ：:，,。.;；"“”')
    return s[:80]

def extract_sections(text):
    out=[]
    seen=set()
    for line in text.splitlines():
        l=line.strip()
        if not l or len(l)>80: continue
        m=section_pat.match(l)
        if not m: continue
        item=clean_title((m.group(1)+' '+m.group(2)).strip())
        if noise.search(item):
            item=clean_title(m.group(1))
        if item and item not in seen:
            seen.add(item); out.append(item)
        if len(out)>=40: break
    return out

def build(book_id):
    b=BOOKS[book_id]
    pages=sorted(int(p.stem) for p in b['ocr_dir'].glob('*.txt'))
    total_chars=sum(len(read_page(b['ocr_dir'],n)) for n in pages)
    # combined text
    lines=[f"# {b['title']}","",f"- 原始 PDF：`{b['source_pdf']}`",f"- 页数：{max(pages) if pages else 0}",f"- OCR 文字页：{len(pages)}",f"- OCR 字符数：{total_chars}","","> 本文件由本地 Tesseract OCR 自动提取生成，供个人学习检索和整理使用；扫描版识别难免有错别字与公式误识别。",""]
    for n in pages:
        lines += [f"## 第 {n} 页","",read_page(b['ocr_dir'],n),""]
    b['text_file'].write_text('\n'.join(lines), encoding='utf-8')

    # chapter notes
    b['notes_dir'].mkdir(parents=True, exist_ok=True)
    chapters_meta=[]
    for ch,title,start,end in b['chapters']:
        chunks=[]
        for n in range(start,end+1):
            t=read_page(b['ocr_dir'],n)
            if t:
                chunks.append(f"## 第 {n} 页\n\n{t}")
        text='\n\n'.join(chunks).strip()+"\n"
        sections=extract_sections(text)
        out=[f"# 第 {ch} 章 {title}","",f"- 来源：{b['title']}",f"- PDF 页码范围：{start}-{end}",f"- OCR 字符数：{len(text)}","","> OCR 自动识别文本，公式、符号和个别汉字可能需要人工校对。",""]
        if sections:
            out += ["## 本章小节索引",""] + [f"- {s}" for s in sections] + [""]
        out += ["## OCR 原文", "", text]
        fname=(f'chapter-{int(ch):02d}.md' if ch.isdigit() else 'appendix-answers.md')
        (b['notes_dir']/fname).write_text('\n'.join(out), encoding='utf-8')
        chapters_meta.append({'chapter':ch,'title':title,'file':f'textbooks-notes/{book_id}/{fname}','page':start,'endPage':end,'chars':len(text),'sections':sections})
    readme=[f"# {b['title']} 章节整理","","> 基于本地 Tesseract OCR 识别结果自动拆分。",""]
    for c in chapters_meta:
        
        link=(f"chapter-{int(c['chapter']):02d}.md" if str(c['chapter']).isdigit() else 'appendix-answers.md')
        label=(f"第 {c['chapter']} 章 {c['title']}" if str(c['chapter']).isdigit() else c['title'])
        readme.append(f"- [{label}]({link})：约 {c['chars']} 字，PDF 页 {c['page']}-{c['endPage']}")
    b['notes_dir'].joinpath('README.md').write_text('\n'.join(readme)+"\n", encoding='utf-8')
    return {'id':book_id,'title':b['title'],'chapters':chapters_meta,'source':str(b['text_file']).replace('public/','')}

if __name__=='__main__':
    metas=[build(x) for x in ['gaoshu-1','gaoshu-2']]
    print(json.dumps(metas,ensure_ascii=False,indent=2))
