"""Local-only document extraction. No credentials or network."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
import posixpath
import re
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
p = Path(sys.argv[1])
try:
    if p.suffix.lower() == '.docx':
        with zipfile.ZipFile(p) as z:
            if z.getinfo('word/document.xml').file_size > 20_000_000:
                raise ValueError('document_too_large')
            root = ET.fromstring(z.read('word/document.xml'))
            text = '\n'.join(''.join(e.itertext()) for e in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
    elif p.suffix.lower() == '.pptx':
        destination = Path(sys.argv[2])
        destination.mkdir(parents=True, exist_ok=True)
        parts = []
        with zipfile.ZipFile(p) as z:
            slides = sorted([s for s in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', s)], key=lambda s: int(re.search(r'slide(\d+)', s)[1]))
            for slide in slides:
                if z.getinfo(slide).file_size > 10_000_000:
                    raise ValueError('slide_too_large')
                text = ' '.join(e.text or '' for e in ET.fromstring(z.read(slide)).iter('{http://schemas.openxmlformats.org/drawingml/2006/main}t'))
                rel = posixpath.join(posixpath.dirname(slide), '_rels', posixpath.basename(slide) + '.rels')
                images = []
                if rel in z.namelist():
                    for e in ET.fromstring(z.read(rel)):
                        if not e.get('Type', '').endswith('/image') or e.get('TargetMode') == 'External':
                            continue
                        target = posixpath.normpath(posixpath.join(posixpath.dirname(slide), e.get('Target', '')))
                        if not target.startswith('ppt/media/') or Path(target).suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
                            continue
                        if z.getinfo(target).file_size > 30_000_000:
                            raise ValueError('slide_image_too_large')
                        output = destination / Path(target).name
                        if not output.exists():
                            output.write_bytes(z.read(target))
                        images.append(str(output))
                # Every image is included, at most four per AI request.
                for start in range(0, max(1, len(images)), 4):
                    parts.append({'text': f'{Path(slide).stem}: {text}', 'images': images[start:start+4]})
        print(json.dumps({'parts': parts}, ensure_ascii=True))
        sys.exit(0)
    elif p.suffix.lower() == '.pdf':
        from pypdf import PdfReader
        text = '\n'.join(page.extract_text() or '' for page in PdfReader(p).pages)
    else:
        raise ValueError('unsupported_document')
    print(json.dumps({'text': text}, ensure_ascii=True))
except Exception:
    print(json.dumps({'error': 'document_extraction_failed'}))
    sys.exit(1)
