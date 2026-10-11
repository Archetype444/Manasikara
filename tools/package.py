"""Build the local Manasikara update with the selected sound defaults."""
import argparse
import json
from pathlib import Path
import re
import zipfile

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
for role in ['chime','meditation','finish']:
    parser.add_argument('--'+role, required=True, choices=['bowl','brass','resonance']+(['mudita'] if role=='meditation' else []))
args=parser.parse_args()
settings={role+'Sound':getattr(args,role) for role in ['chime','meditation','finish']}
timer=(ROOT/'src'/'timer.js').read_text(encoding='utf-8')
for key,value in settings.items():
    timer,count=re.subn(rf"{key}:'[^']+'", f"{key}:'{value}'",timer)
    if count!=1:
        raise RuntimeError(f'Expected one default for {key}')
(ROOT/'src'/'timer.js').write_text(timer,encoding='utf-8')
metadata=json.loads((ROOT/'src'/'plugin.json').read_text(encoding='utf-8'))
for item in metadata['SettingDefinitions']:
    key=item['Value'].get('Key')
    if key in settings:
        item['Value']['DefaultValue']=settings[key]
(ROOT/'src'/'plugin.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
destination=ROOT/'deliverables'/f'Manasikara-v{metadata["Version"]}.wox'
destination.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted((ROOT/'src').rglob('*')):
        if p.is_file():
            z.write(p,p.relative_to(ROOT/'src'))
with zipfile.ZipFile(destination) as z:
    assert z.testzip() is None
    assert {'plugin.json','index.js','time.js','timer.js','audio.js','commands.js','prompts.js'}.issubset(z.namelist())
    assert len([p for p in z.namelist() if p.endswith('.wav')])==52
    assert 'sounds/mudita/meditation.wav' in z.namelist()
print(destination)
