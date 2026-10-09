#!/usr/bin/env python3
"""Stage the isolated v2 CEP extension. Dry-run by default; never modifies the old panel."""
import argparse, hashlib, json, shutil, time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--install',action='store_true');p.add_argument('--rollback',action='store_true');a=p.parse_args()
if a.install and a.rollback:p.error('choose install or rollback')
source=Path(__file__).resolve().parent
target=Path.home()/'Library/Application Support/Adobe/CEP/extensions/PatPremiereBridgeV2'
files=['index.html','panel.js','engine.cjs','domain.cjs','json-compat.jsx','CSXS/manifest.xml','LICENSE.upstream.md']
if a.rollback:
 if not target.exists():raise SystemExit('V2 not installed; nothing to roll back')
 manifest=json.loads((target/'install-record.json').read_text())
 for name,digest in manifest['sha256'].items():
  if hashlib.sha256((target/name).read_bytes()).hexdigest()!=digest:raise SystemExit('Installed v2 changed; refusing blind rollback: '+name)
 archived=target.with_name(target.name+'.disabled-'+str(time.time_ns()))
 # Move outside CEP extensions, rather than leaving a loadable duplicate alongside it.
 archived=Path.home()/'.premiere-mcp-bridge-v2-archives'/archived.name;archived.parent.mkdir(parents=True,exist_ok=True)
 target.rename(archived);print('V2 archived to '+str(archived));raise SystemExit(0)
print(('INSTALL: ' if a.install else 'DRY RUN: ')+str(target))
print('Own extension ID; own default spool ~/.premiere-mcp-bridge-v2. Original MCPBridgeCEP untouched.')
if target.exists():raise SystemExit('Target already exists; inspect or roll back first')
if a.install:
 # A partial stage never becomes a visible CEP extension.
 staging=Path.home()/'.premiere-mcp-bridge-v2-archives'/('stage-'+str(time.time_ns()));staging.mkdir(parents=True)
 for name in files:
  dst=staging/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/name,dst)
 (staging/'install-record.json').write_text(json.dumps({'at':time.time(),'source':str(source),'sha256':{name:hashlib.sha256((staging/name).read_bytes()).hexdigest() for name in files}},indent=2))
 staging.rename(target)
 print('Files installed only. No Premiere reload, panel opening, debug/signing settings or commands were executed.')
