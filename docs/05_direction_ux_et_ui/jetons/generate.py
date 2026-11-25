"""Génère tokens.css, tokens.ts et molopay_tokens.dart depuis molopay.tokens.json.
Usage : python3 -I generate.py  (depuis ce dossier). Aucune dépendance externe."""
import json, pathlib, re
here = pathlib.Path(__file__).parent
T = json.loads((here / 'molopay.tokens.json').read_text(encoding='utf-8'))

def flat(node, path=()):
    for k, v in node.items():
        if k.startswith('$'):
            continue
        if isinstance(v, dict) and '$value' in v:
            yield path + (k,), v['$value']
        elif isinstance(v, dict):
            yield from flat(v, path + (k,))

items = list(flat(T))
def css_val(p, v):
    if p[0] == 'font' and p[1] == 'family':
        return ', '.join(f"'{x}'" if ' ' in x else x for x in v)
    if p[:2] == ('motion', 'easing'):
        return 'cubic-bezier(' + ', '.join(str(x) for x in v) + ')'
    if isinstance(v, dict):
        return None
    return str(v)

head = '/* Généré par docs/05_direction_ux_et_ui/jetons/generate.py — ne pas modifier à la main. */\n'
css = [head, ':root {']
for p, v in items:
    cv = css_val(p, v)
    if cv is not None:
        css.append(f"  --mp-{'-'.join(p)}: {cv};")
css.append('}')
css.append('@media (prefers-reduced-motion: reduce) {\n  :root {\n    --mp-motion-duration-micro: 0ms; --mp-motion-duration-short: 0ms; --mp-motion-duration-base: 120ms;\n    --mp-motion-duration-medium: 120ms; --mp-motion-duration-long: 120ms; --mp-motion-duration-xlong: 0ms; --mp-motion-duration-celebration: 0ms;\n  }\n}')
(here / 'tokens.css').write_text('\n'.join(css) + '\n', encoding='utf-8')

def camel(parts):
    s = '-'.join(parts)
    s = re.sub(r'[-_](\w)', lambda m: m.group(1).upper(), s)
    return ('_' + s) if s[0].isdigit() else s
ts = [head.replace('/*', '//').replace(' */', ''), 'export const molopayTokens = ' + json.dumps({camel(p): v for p, v in items}, indent=2, ensure_ascii=False) + ' as const;', '', 'export type MolopayTokens = typeof molopayTokens;', '']
(here / 'tokens.ts').write_text('\n'.join(ts), encoding='utf-8')

def dart_color(h):
    return f"Color(0xFF{h.lstrip('#').upper()})"
d = ['// Généré par docs/05_direction_ux_et_ui/jetons/generate.py — ne pas modifier à la main.', "import 'package:flutter/animation.dart';", "import 'package:flutter/painting.dart';", '', 'abstract final class MpColors {']
for p, v in items:
    if p[0] == 'color':
        d.append(f'  static const {camel(p[1:])} = {dart_color(v)};')
d += ['}', '', 'abstract final class MpRadius {']
for p, v in items:
    if p[0] == 'radius':
        d.append(f"  static const {camel(p[1:])} = {float(v.rstrip('px'))};")
d += ['}', '', 'abstract final class MpSpace {']
for p, v in items:
    if p[0] == 'space':
        d.append(f"  static const s{p[1]} = {float(v.rstrip('px'))};")
d += ['}', '', 'abstract final class MpMotion {']
for p, v in items:
    if p[:2] == ('motion', 'duration'):
        d.append(f"  static const {camel(p[2:])} = Duration(milliseconds: {int(v.rstrip('ms'))});")
    if p[:2] == ('motion', 'easing'):
        d.append(f"  static const {camel(p[2:])}Curve = Cubic({', '.join(str(float(x)) for x in v)});")
d += ['}', '', '// Polices : Outfit (montants, titres) et Inter (texte), embarquées dans les assets (pas de téléchargement à l\'exécution).', "const mpFontDisplay = 'Outfit';", "const mpFontText = 'Inter';", '']
(here / 'molopay_tokens.dart').write_text('\n'.join(d), encoding='utf-8')
print('ok', len(items), 'jetons')
