# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_submodules, collect_all

# ── Resolve paths relative to this spec file ─────────────────────────────────
SPEC_DIR = os.path.abspath(os.path.dirname(SPEC))   # project root
BACKEND  = os.path.join(SPEC_DIR, 'backend')

# ── Hidden imports ────────────────────────────────────────────────────────────
datas         = []
binaries      = []
hiddenimports = [
    'moviebox_api.v1.constants',
    'moviebox_api.v1.core',
    'moviebox_api.v1.download',
    'moviebox_api.v1.requests',
    # curl_cffi required by moviebox-api (Gotcha #1)
    'curl_cffi',
    'curl_cffi.requests',
    'curl_cffi.requests.session',
    'python_multipart',
]
# Fix: was 'backend.app' — entry point is backend\main.py so 'backend/' is already on sys.path
hiddenimports += collect_submodules('app')
hiddenimports += collect_submodules('core')
hiddenimports += collect_submodules('anime')
hiddenimports += collect_submodules('moviebox')
hiddenimports += collect_submodules('downloads')

tmp_ret = collect_all('moviebox_api')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

tmp_ret = collect_all('throttlebuster')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

tmp_ret = collect_all('curl_cffi')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# ── Analysis ──────────────────────────────────────────────────────────────────
a = Analysis(
    ['backend\\main.py'],
    pathex=[
        SPEC_DIR,   # project root — lets PyInstaller find backend/ as a folder
        BACKEND,    # backend/     — lets 'import app', 'import downloads', etc. work
    ],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='grabix-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    # Fix: was False — kept True so crashes are visible during debugging
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    contents_directory='.',
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='grabix-backend',
)
