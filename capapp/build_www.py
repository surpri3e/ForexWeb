#!/usr/bin/env python3
"""Copies the site (index.html + icons) into capapp/www for the Android app.
The site itself is not changed; only the copy inside the app is adjusted."""
import os, re, shutil, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
www = os.path.join(root, 'capapp', 'www')
shutil.rmtree(www, ignore_errors=True)
os.makedirs(www)

src = open(os.path.join(root, 'index.html'), encoding='utf-8').read()

# The page already talks to the server through window.SFX_API; make sure it is set.
if 'window.SFX_API' not in src:
    sys.exit('index.html has no window.SFX_API; the app could not reach the server')

# No service worker inside the app (files are local), and no web manifest link.
old = "location.protocol==='https:' && !/Telegram/i"
if old not in src:
    sys.exit('service worker line not found in index.html')
src = src.replace(old, "location.protocol==='https:' && location.hostname!=='localhost' && !/Telegram/i")
src = src.replace('<link rel="manifest" href="/manifest.webmanifest">', '')

open(os.path.join(www, 'index.html'), 'w', encoding='utf-8').write(src)
shutil.copytree(os.path.join(root, 'icons'), os.path.join(www, 'icons'))
print('www ready:', os.path.getsize(os.path.join(www, 'index.html')), 'bytes')
