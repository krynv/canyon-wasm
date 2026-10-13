"""Build web/assets from the FFDec exports in re/.

Inputs (produced by FFDec, see README):
  re/swf.xml                 full tag dump          (-swf2xml)
  re/export/shapes/*.svg     DefineShape exports    (-export shape)
  re/export/sounds/*         DefineSound exports    (-export sound)
  re/export/fonts/*.ttf      DefineFont exports     (-export font)
  re/export/scripts/**       decompiled AS2         (-export script)
  re/export2/texts/*.svg     DefineText as SVG      (-format text:svg)
  re/export2/morphshapes/*   DefineMorphShape SVG   (-format morphshape:svg)

Output: web/assets/{movie.json,shapes,texts,morphs,sounds,fonts}

Besides converting, this strips the Miniclip / developer branding (STRIPPED_CHARS) and adds the
in-game sound options UI (add_options_ui), which the original never had.
"""
import json, os, re, shutil, sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RE = os.path.join(ROOT, 're')
OUT = os.path.join(ROOT, 'web', 'assets')

sys.path.insert(0, HERE)
import swf2json  # noqa: E402

SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
ET.register_namespace('ffdec', 'https://www.free-decompiler.com/flash')

NUM = re.compile(r'-?\d+(?:\.\d+)?(?:[eE]-?\d+)?')


def svg_box(path):
    """Return [originX, originY, width, height] of an FFDec SVG in symbol-local pixels."""
    head = open(path, encoding='utf-8').read(2000)
    w = float(re.search(r'\swidth="([\d.]+)px"', head).group(1))
    h = float(re.search(r'\sheight="([\d.]+)px"', head).group(1))
    m = re.search(r'<g transform="matrix\(([^)]*)\)"', head)
    tx, ty = (float(v) for v in m.group(1).split(',')[4:6]) if m else (0.0, 0.0)
    return [round(-tx, 3), round(-ty, 3), w, h]


def lerp_value(a, b, t):
    """Interpolate two SVG attribute strings that share the same token structure."""
    if a.startswith('#') and b.startswith('#') and len(a) == 7 and len(b) == 7:
        ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
        cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
        return '#' + ''.join('%02x' % round(x + (y - x) * t) for x, y in zip(ca, cb))
    na, nb = NUM.findall(a), NUM.findall(b)
    if len(na) != len(nb):
        return a if t < 0.5 else b
    it = iter(zip(na, nb))

    def sub(_):
        x, y = next(it)
        return ('%.4f' % (float(x) + (float(y) - float(x)) * t)).rstrip('0').rstrip('.')
    return NUM.sub(sub, a)


def morph_svg(src, dst, t):
    """Write a static SVG for a morph shape at ratio t (0..1) by resolving its <animate> pairs."""
    tree = ET.parse(src)
    for parent in list(tree.getroot().iter()):
        for an in [c for c in parent if c.tag == '{%s}animate' % SVG_NS]:
            vals = an.get('values').split(';')
            parent.set(an.get('attributeName'), lerp_value(vals[0], vals[-1], t))
            parent.remove(an)
    tree.write(dst, encoding='utf-8', xml_declaration=True)


def morph_ratios(movie):
    """Collect every (morphId, ratio) pair that any timeline can display."""
    chars, used = movie['chars'], set()
    timelines = [c for c in chars.values() if c['t'] == 'sprite'] + [movie['root']]
    for tl in timelines:
        at = {}
        for frame in tl['frames']:
            for op in frame:
                if op['op'] == 'remove':
                    at.pop(op['depth'], None)
                elif op['op'] == 'place':
                    if 'id' in op:
                        at[op['depth']] = op['id']
                    cid = at.get(op['depth'])
                    if cid is not None and chars[str(cid)]['t'] == 'morph':
                        used.add((cid, op.get('ratio', 0)))
    return used


ACTION_PATTERNS = [
    (re.compile(r'^stop\(\);$'), lambda m: 'stop'),
    (re.compile(r'^this\.removeMovieClip\(\);$'), lambda m: 'remove'),
    (re.compile(r'^(?:this\.)?_visible = false;$'), lambda m: 'hide'),
    (re.compile(r'^CSoundService\.playSound\(Const\.(SND_\w+)\);$'), lambda m: 'snd:' + m.group(1)),
]


def frame_actions(sound_consts):
    """Translate the simple timeline scripts into host opcodes: {spriteId: {frame: [op,...]}}.

    Anything that is not a plain stop/remove/hide/playSound becomes 'custom', which the host
    resolves by sprite id (see FRAME_SCRIPTS in web/flash.js).
    """
    out = {}
    base = os.path.join(RE, 'export', 'scripts')
    for d in os.listdir(base):
        m = re.match(r'DefineSprite_(\d+)', d)
        if not m:
            continue
        sid = m.group(1)
        for fd in os.listdir(os.path.join(base, d)):
            fm = re.match(r'frame_(\d+)$', fd)
            src = os.path.join(base, d, fd, 'DoAction.as')
            if not fm or not os.path.exists(src):
                continue
            ops, custom = [], False
            for line in open(src, encoding='utf-8').read().splitlines():
                line = line.strip()
                if not line:
                    continue
                for pat, fn in ACTION_PATTERNS:
                    mm = pat.match(line)
                    if mm:
                        op = fn(mm)
                        if op.startswith('snd:'):
                            op = 'snd:%d' % sound_consts[op[4:]]
                        ops.append(op)
                        break
                else:
                    custom = True
            if custom:
                ops = ['custom']
            if ops:
                out.setdefault(sid, {})[fm.group(1)] = ops
    return out


# Branding and dead online features removed from every timeline (character ids):
#   5, 32  Miniclip link buttons (32 is the logo)      37  developer site link (www.iriysoft.ru)
#   42     Miniclip advert container                   25  "Scores" button (Miniclip highscores)
STRIPPED_CHARS = {5, 25, 32, 37, 42}

# Static texts restyled on export. The difficulty cells' captions are white and relied on a
# drop-shadow filter and a darkening tint on the photos behind them (neither is rendered here).
# They become black with a light outline instead.
OUTLINED_TEXTS = {638, 639, 643, 644, 647, 648}
OUTLINE_PX = 2.6


def outline_black(svg):
    """Turn each white glyph black with a light outline of OUTLINE_PX on-screen pixels."""
    def restyle(m):
        use = m.group(0)
        scale = float(re.search(r'transform="matrix\(([-\d.eE]+)', use).group(1))
        style = ('fill="#000000" stroke="#ffffff" stroke-opacity="0.85" stroke-width="%d" '
                 'stroke-linejoin="round" paint-order="stroke"' % round(OUTLINE_PX / scale))
        return use.replace('fill="#ffffff"', style)
    # the glyph paths say stroke="none", which would override the outline set on each <use>
    return re.sub(r'<use [^>]*>', restyle, svg).replace(' stroke="none"/>', '/>')


def strip_placements(movie):
    """Drop the PlaceObject/RemoveObject tags of STRIPPED_CHARS from all timelines."""
    timelines = [c for c in movie['chars'].values() if c['t'] == 'sprite'] + [movie['root']]
    for tl in timelines:
        at = {}
        for i, frame in enumerate(tl['frames']):
            kept = []
            for op in frame:
                d = op.get('depth')
                if op['op'] == 'place' and op.get('id') in STRIPPED_CHARS:
                    at[d] = True
                    continue
                if op['op'] == 'place' and 'id' in op:
                    at.pop(d, None)
                if at.get(d) and op['op'] in ('place', 'remove'):
                    if op['op'] == 'remove':
                        at.pop(d)
                    continue
                kept.append(op)
            tl['frames'][i] = kept


# Symbols that are no longer attached by the game: Miniclip score / award screens and advert.
DROPPED_EXPORTS = {'id_mcSaveScore', 'id_mcViewScore', 'id_mcGiveAward', 'cont'}


def reachable_chars(movie):
    """Character ids the game can still display: everything under the kept linkage symbols."""
    chars = movie['chars']
    todo = [cid for name, cid in movie['exports'].items() if name not in DROPPED_EXPORTS]
    todo.append(24)  # main-timeline background
    seen = set()
    while todo:
        cid = todo.pop()
        c = chars.get(str(cid))
        if cid in seen or c is None:
            continue
        seen.add(cid)
        if c['t'] == 'sprite':
            todo += [op['id'] for f in c['frames'] for op in f if 'id' in op]
        elif c['t'] == 'button':
            todo += [r['id'] for r in c['recs']]
    return seen


# ---- sound options UI (not in the original SWF) ------------------------------------------------
# Built from the game's own parts: the grey menu button body (shape 19), the yellow dialog
# button (sprite 398, hit shape 397), the options background (shape 594) and embedded font 10.
OPT_PANEL = 9000         # custom panel shape
OPT_MENU_BUTTON = 9010   # "Options" on the main menu
OPT_STRIP = 9020         # exported as id_soundOptions: the two volume rows
OPT_SCREEN = 9030        # exported as id_mcSoundScreen
# button ids handled in assembly/game.ts: 91c0 quieter, 91c1 louder, 91c2 on/off (c = channel)
OPT_CHANNELS = [('Music', 'MUSIC', 9100), ('Sfx', 'EFFECTS', 9110)]
PANEL_W, PANEL_H = 330, 84

PANEL_SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="%dpx" height="%dpx">
  <rect x="1" y="1" width="%d" height="%d" rx="6" fill="#3a0d0d" fill-opacity="0.92" stroke="#c8c8c8" stroke-width="2"/>
</svg>
""" % (PANEL_W, PANEL_H, PANEL_W - 2, PANEL_H - 2)


def add_options_ui(movie):
    chars = movie['chars']
    ids = iter(range(9040, 9100))

    def label(text, size, color, width, align=0):
        cid = next(ids)
        chars[str(cid)] = {'t': 'edit', 'b': [-2, -2, width, size * 1.5 + 2], 'var': '', 'text': text, 'font': 10,
                           'size': size, 'align': align, 'color': color + [255], 'multiline': False,
                           'wordWrap': False, 'leading': 0, 'border': False}
        return cid

    def place(cid, depth, x, y, name=None, sx=1.0, sy=1.0):
        op = {'op': 'place', 'depth': depth, 'id': cid, 'm': [sx, 0.0, 0.0, sy, x, y]}
        if name:
            op['name'] = name
        return op

    def yellow_button(cid, sx):
        m = [sx, 0.0, 0.0, 0.85, 0.0, 0.0]
        rec = lambda i, **st: {'id': i, 'depth': 1, 'm': m, 'cx': None, 'up': False, 'over': False,
                               'down': False, 'hit': False, **st}
        chars[str(cid)] = {'t': 'button', 'recs': [rec(398, up=True, over=True, down=True), rec(397, hit=True)]}

    # main menu button, in the slot the Scores button used
    up, over = label('Options', 16, [0, 0, 0], 146, 2), label('Options', 16, [255, 255, 255], 146, 2)
    body = {'id': 19, 'depth': 1, 'm': [1.0, 0.0, 0.0, 1.0, 31.1, 9.35], 'cx': None,
            'up': True, 'over': True, 'down': True, 'hit': True}
    text = lambda cid, **st: {'id': cid, 'depth': 2, 'm': [1.0, 0.0, 0.0, 1.0, 4.0, 16.0], 'cx': None,
                              'up': False, 'over': False, 'down': False, 'hit': False, **st}
    chars[str(OPT_MENU_BUTTON)] = {'t': 'button', 'recs': [body, text(up, up=True), text(over, over=True, down=True)]}
    chars['48']['frames'][0].append(place(OPT_MENU_BUTTON, 9, 250.0, 310.0))

    # the strip: [label] [-] value [+] [ON/OFF] per channel
    chars[str(OPT_PANEL)] = {'t': 'shape', 'b': [0, 0, PANEL_W, PANEL_H], 'img': [0, 0, PANEL_W, PANEL_H]}
    open(os.path.join(OUT, 'shapes', '%d.svg' % OPT_PANEL), 'w').write(PANEL_SVG)
    cream, black = [255, 204, 153], [0, 0, 0]
    ops, depth = [place(OPT_PANEL, 1, 0, 0)], 2
    for row, (key, title, base) in enumerate(OPT_CHANNELS):
        y = 14 + row * 34
        yellow_button(base, 1.0)
        yellow_button(base + 1, 1.0)
        yellow_button(base + 2, 2.0)
        for cid, x, name in [
            (label(title, 13, cream, 100), 16, None),
            (base, 118, None), (label('-', 15, black, 27, 2), 120, None),
            (label('100%', 13, cream, 54, 2), 152, 'text' + key),
            (base + 1, 212, None), (label('+', 15, black, 27, 2), 214, None),
            (base + 2, 256, None), (label('ON', 13, black, 56, 2), 258, 'text' + key + 'On'),
        ]:
            is_button = chars[str(cid)]['t'] == 'button'
            ops.append(place(cid, depth, x, y if is_button else y + 3, name))
            depth += 1
    chars[str(OPT_STRIP)] = {'t': 'sprite', 'frames': [ops], 'labels': {}}

    # the screen: background, title, strip, Back
    title = label('SOUND OPTIONS', 26, black, 650, 2)
    chars[str(OPT_SCREEN)] = {'t': 'sprite', 'labels': {}, 'frames': [[
        place(594, 1, 0, 0), place(title, 2, 2, 40),
        place(OPT_STRIP, 3, (650 - PANEL_W) / 2, 170, 'mcSoundOptions'), place(597, 4, 16.0, 380.0),
    ]]}
    movie['exports']['id_soundOptions'] = OPT_STRIP
    movie['exports']['id_mcSoundScreen'] = OPT_SCREEN


def sound_table():
    """Parse Const.as for the sound name list and SND_* indices."""
    src = open(os.path.join(RE, 'export', 'scripts', '__Packages', 'Const.as'), encoding='utf-8').read()
    names = re.findall(r'"(snd_\w+)"', re.search(r'SOUND_NAMES = new Array\(([^)]*)\)', src).group(1))
    consts = {k: int(v) for k, v in re.findall(r'static var (SND_\w+) = (\d+);', src)}
    return names, consts


def main():
    for sub in ('shapes', 'texts', 'morphs', 'sounds', 'fonts'):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)

    tmp = os.path.join(RE, 'movie.json')
    swf2json.main(os.path.join(RE, 'swf.xml'), tmp)
    movie = json.load(open(tmp))
    chars = movie['chars']
    strip_placements(movie)
    keep = reachable_chars(movie)
    for cid in [c for c in chars if int(c) not in keep and chars[c]['t'] != 'font']:
        del chars[cid]
    # '__Packages.*' entries are the original ActionScript classes, not display symbols
    movie['exports'] = {n: i for n, i in movie['exports'].items() if i in keep and not n.startswith('__Packages')}
    movie['root'] = {'frames': [], 'labels': {}}  # preloader timeline; the host builds the stage
    for sub in ('shapes', 'texts', 'morphs'):
        shutil.rmtree(os.path.join(OUT, sub))
        os.makedirs(os.path.join(OUT, sub))

    for cid, c in chars.items():
        if c['t'] == 'shape':
            src = os.path.join(RE, 'export', 'shapes', cid + '.svg')
            if os.path.exists(src):
                c['img'] = svg_box(src)
                shutil.copyfile(src, os.path.join(OUT, 'shapes', cid + '.svg'))
        elif c['t'] == 'text':
            src = os.path.join(RE, 'export2', 'texts', cid + '.svg')
            if os.path.exists(src):
                c['img'] = svg_box(src)
                svg = open(src, encoding='utf-8').read()
                if int(cid) in OUTLINED_TEXTS:
                    svg = outline_black(svg)
                open(os.path.join(OUT, 'texts', cid + '.svg'), 'w', encoding='utf-8').write(svg)

    add_options_ui(movie)

    for cid, ratio in sorted(r for r in morph_ratios(movie) if str(r[0]) in chars):
        src = os.path.join(RE, 'export2', 'morphshapes', '%d.svg' % cid)
        dst = os.path.join(OUT, 'morphs', '%d_%d.svg' % (cid, ratio))
        morph_svg(src, dst, ratio / 65535)
        c = chars[str(cid)]
        c['img'] = svg_box(src)
        c.setdefault('ratios', []).append(ratio)

    names, consts = sound_table()
    sounds = []
    exported = os.listdir(os.path.join(RE, 'export', 'sounds'))
    for n in names:
        f = next(x for x in exported if re.match(r'\d+_%s\.' % re.escape(n), x))
        dst = n + os.path.splitext(f)[1]
        shutil.copyfile(os.path.join(RE, 'export', 'sounds', f), os.path.join(OUT, 'sounds', dst))
        sounds.append(dst)
    movie['sounds'] = sounds
    movie['actions'] = {k: v for k, v in frame_actions(consts).items() if k in chars}

    fonts = {}
    for f in os.listdir(os.path.join(RE, 'export', 'fonts')):
        fid = f.split('_')[0]
        dst = 'font%s.ttf' % fid
        shutil.copyfile(os.path.join(RE, 'export', 'fonts', f), os.path.join(OUT, 'fonts', dst))
        fonts[fid] = dst
    movie['fonts'] = fonts

    json.dump(movie, open(os.path.join(OUT, 'movie.json'), 'w'), separators=(',', ':'))
    print('movie.json: %.1f KB' % (os.path.getsize(os.path.join(OUT, 'movie.json')) / 1024))
    print('chars kept:', len(chars), 'custom frame scripts:', sorted(k for k, v in movie['actions'].items() if any('custom' in o for o in v.values())))


if __name__ == '__main__':
    main()
