"""Local-only document extraction. No credentials or network."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
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
    elif p.suffix.lower() == '.pdf':
        from pypdf import PdfReader
        text = '\n'.join(page.extract_text() or '' for page in PdfReader(p).pages)
    else:
        raise ValueError('unsupported_document')
    print(json.dumps({'text': text}, ensure_ascii=True))
except Exception:
    print(json.dumps({'error': 'document_extraction_failed'}))
    sys.exit(1)
