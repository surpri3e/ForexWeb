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

# App feel: text is not selectable/copyable (except inside inputs), no long-press menu,
# no pinch zoom, no pull-glow. Only in the app copy; the website keeps its normal behaviour.
APP_CSS = ('<style id="sfxAppFeel">*{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}'
           'input,textarea,[contenteditable="true"]{-webkit-user-select:text;user-select:text}'
           'img{-webkit-user-drag:none}html,body{overscroll-behavior:none}</style>'
           '<script>document.addEventListener("contextmenu",function(e){var t=e.target&&e.target.tagName;'
           'if(t!=="INPUT"&&t!=="TEXTAREA")e.preventDefault()});</script>')
if src.count('</head>') != 1:
    sys.exit('</head> not found exactly once')
src = src.replace('</head>', APP_CSS + '</head>')
src = re.sub(r'(<meta name="viewport" content=")[^"]*(")', r'\1width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,interactive-widget=resizes-visual\2', src, count=1)

open(os.path.join(www, 'index.html'), 'w', encoding='utf-8').write(src)
shutil.copytree(os.path.join(root, 'icons'), os.path.join(www, 'icons'))
print('www ready:', os.path.getsize(os.path.join(www, 'index.html')), 'bytes')
