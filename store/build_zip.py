"""Builds the file to upload to the Chrome Web Store.

Run:  cd /c/Users/chand/twitch-ad-swap && python store/build_zip.py

Only what the extension needs goes in: the manifest, the script and the icons.
Tests, notes and store artwork stay out.
"""
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

manifest = json.load(open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8'))
scripts = [js for cs in manifest['content_scripts'] for js in cs['js']]
files = ['manifest.json'] + scripts + sorted(set(manifest['icons'].values()))
if 'action' in manifest:                      # the toolbar popup and the script it loads
    files += [manifest['action']['default_popup'], 'popup.js']
if 'options_page' in manifest:                # the "My videos" page and its scripts
    files += [manifest['options_page'], 'options.js', 'library.js']
if 'background' in manifest:                  # the shortcut and the notification
    files += [manifest['background']['service_worker']]
for war in manifest.get('web_accessible_resources', []):   # pages shown on Twitch itself
    files += war['resources']
files = sorted(set(files), key=files.index)   # each file once, in the order first named

problems = []
if len(manifest['description']) > 132:
    problems.append('description is %d characters; the store allows 132' % len(manifest['description']))
for f in files:
    if not os.path.isfile(os.path.join(ROOT, f)):
        problems.append('missing file: ' + f)
script = open(os.path.join(ROOT, 'adswap.user.js'), encoding='utf-8').read()
if ("var VERSION = '%s'" % manifest['version']) not in script:
    problems.append('script VERSION does not match manifest version ' + manifest['version'])
if problems:
    raise SystemExit('NOT BUILT:\n  ' + '\n  '.join(problems))

out = os.path.join(HERE, 'ad-swap-for-twitch-%s.zip' % manifest['version'])
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(ROOT, f), f)
print('built', os.path.relpath(out, ROOT))
for info in zipfile.ZipFile(out).infolist():
    print('  %6d  %s' % (info.file_size, info.filename))
