"""Safely COPY complete learning archives into a fresh inbox batch, with hashes."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

def import_archives(archives, destination):
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError('destination_already_exists')
    pending = []
    total = 0
    for archive in archives:
        archive = Path(archive)
        with zipfile.ZipFile(archive) as z:
            if len(z.infolist()) > 10000:
                raise ValueError('too_many_entries')
            for i in z.infolist():
                name = PurePosixPath(i.filename.replace('\\', '/'))
                if name.is_absolute() or '..' in name.parts or any(':' in p for p in name.parts) or stat.S_ISLNK(i.external_attr >> 16):
                    raise ValueError('unsafe_archive_path')
                if i.is_dir():
                    continue
                total += i.file_size
                if i.file_size > 512 * 1024 * 1024 or total > 1024 * 1024 * 1024:
                    raise ValueError('archive_exceeds_limits')
                clean = [re.sub(r'[<>:"|?*\x00-\x1f]', '_', p).rstrip('. ') for p in name.parts]
                if any(not p or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)', p, re.I) for p in clean):
                    raise ValueError('unsafe_windows_name')
                target = destination / archive.stem / Path(*clean)
                if not target.resolve().is_relative_to(destination):
                    raise ValueError('unsafe_archive_path')
                pending.append((archive, i.filename, target))
    manifest = []
    for archive, original, target in pending:
        with zipfile.ZipFile(archive) as z:
            data = z.read(original)  # validates ZIP CRC
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as f:
            f.write(data)
        manifest.append({'archive': archive.name, 'entry': original, 'relativePath': str(target.relative_to(destination)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    return manifest

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    destination, manifest_path, *archives = sys.argv[1:]
    manifest = import_archives(archives, destination)
    Path(manifest_path).parent.mkdir(parents=True, exist_ok=True)
    Path(manifest_path).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(manifest), 'bytes': sum(x['bytes'] for x in manifest), 'uniqueHashes': len(set(x['sha256'] for x in manifest)), 'destination': destination}, ensure_ascii=False))
