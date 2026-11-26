#!/usr/bin/env python3
"""Run after `npx cap add android`: app icon, splash, status bar colors, version.
Usage: patch_android.py <version_code> <version_name>"""
import glob, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'capapp', 'android', 'app')
RES = os.path.join(APP, 'src', 'main', 'res')
ICON = os.path.join(ROOT, 'icons', 'icon-512.png')
MASK = os.path.join(ROOT, 'icons', 'maskable-512.png')
BG = '#0B0B0B'      # the logo background is near-black
BAR = '#EDE9E0'     # status/navigation bar (cream, like the site)
code, name = sys.argv[1], sys.argv[2]


def sh(*a):
    subprocess.run(a, check=True)


def warn(msg):
    print('WARN:', msg)


# 1) version
gradle = os.path.join(APP, 'build.gradle')
g = open(gradle, encoding='utf-8').read()
g2 = re.sub(r'versionCode\s+\d+', 'versionCode ' + code, g)
g2 = re.sub(r'versionName\s+"[^"]*"', 'versionName "' + name + '"', g2)
if g2 == g:
    sys.exit('versionCode/versionName not found in build.gradle')
open(gradle, 'w', encoding='utf-8').write(g2)

# 2) launcher icons (legacy square/round + adaptive foreground)
sizes = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}
for d, (legacy, fg) in sizes.items():
    folder = os.path.join(RES, 'mipmap-' + d)
    os.makedirs(folder, exist_ok=True)
    for n in ('ic_launcher.png', 'ic_launcher_round.png'):
        sh('convert', MASK, '-resize', f'{legacy}x{legacy}', os.path.join(folder, n))
    # the adaptive icon shows only the middle ~66%; keep the logo inside it
    inner = int(fg * 0.74)
    sh('convert', MASK, '-resize', f'{inner}x{inner}', '-background', 'none', '-gravity', 'center',
       '-extent', f'{fg}x{fg}', os.path.join(folder, 'sfx_icon_fg.png'))
any_dir = os.path.join(RES, 'mipmap-anydpi-v26')
os.makedirs(any_dir, exist_ok=True)
adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/sfx_icon_bg"/>\n'
            '    <foreground android:drawable="@mipmap/sfx_icon_fg"/>\n'
            '</adaptive-icon>\n')
for n in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    open(os.path.join(any_dir, n), 'w', encoding='utf-8').write(adaptive)
os.makedirs(os.path.join(RES, 'values'), exist_ok=True)
open(os.path.join(RES, 'values', 'sfx_colors.xml'), 'w', encoding='utf-8').write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    f'    <color name="sfx_icon_bg">{BG}</color>\n</resources>\n')

# 3) splash: same size as the template files, logo in the middle
splashes = glob.glob(os.path.join(RES, 'drawable*', 'splash.png'))
if not splashes:
    warn('no splash.png found; default splash stays')
for p in splashes:
    w, h = subprocess.run(['identify', '-format', '%w %h', p], capture_output=True, text=True, check=True).stdout.split()
    side = int(min(int(w), int(h)) * 0.42)
    sh('convert', '-size', f'{w}x{h}', f'xc:{BG}', '(', MASK, '-resize', f'{side}x{side}', ')',
       '-gravity', 'center', '-composite', p)

# 4) status bar / navigation bar colors
styles = os.path.join(RES, 'values', 'styles.xml')
if os.path.exists(styles):
    s = open(styles, encoding='utf-8').read()
    extra = (f'        <item name="android:statusBarColor">{BAR}</item>\n'
             f'        <item name="android:navigationBarColor">{BAR}</item>\n'
             '        <item name="android:windowLightStatusBar">true</item>\n'
             '        <item name="android:windowLightNavigationBar">true</item>\n')
    m = re.search(r'(<style name="AppTheme\.NoActionBar"[^>]*>)(.*?)(</style>)', s, re.S)
    if m:
        s = s[:m.end(2)] + extra + s[m.start(3):]
        open(styles, 'w', encoding='utf-8').write(s)
    else:
        warn('AppTheme.NoActionBar not found; bar colors stay default')
else:
    warn('styles.xml not found')
print('android project patched')
