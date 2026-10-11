"""Set the verified repository URL used in package metadata."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
args = parser.parse_args()
url = urlparse(args.url)
parts = url.path.strip('/').split('/')
if url.scheme != 'https' or url.netloc != 'github.com' or len(parts) != 2 or not all(parts) or url.query or url.fragment:
    parser.error('Use the canonical HTTPS GitHub repository URL.')
root = Path(__file__).resolve().parents[1]
file = root / 'src' / 'plugin.json'
metadata = json.loads(file.read_text(encoding='utf-8'))
metadata['Website'] = 'https://github.com/' + '/'.join(parts)
file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
