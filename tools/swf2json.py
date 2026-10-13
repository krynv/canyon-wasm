"""Convert FFDec's swf.xml dump into a compact display-list JSON (movie.json).

Usage: python3 swf2json.py swf.xml movie.json
"""
import json, sys
import xml.etree.ElementTree as ET

def matrix(el):
    m = el.find('matrix')
    if m is None:
        return None
    hs, hr = m.get('hasScale') == 'true', m.get('hasRotate') == 'true'
    a = float(m.get('scaleX')) if hs else 1.0
    d = float(m.get('scaleY')) if hs else 1.0
    b = float(m.get('rotateSkew0')) if hr else 0.0
    c = float(m.get('rotateSkew1')) if hr else 0.0
    return [round(a, 6), round(b, 6), round(c, 6), round(d, 6),
            int(m.get('translateX')) / 20, int(m.get('translateY')) / 20]

def cxform(el):
    c = el.find('colorTransform')
    if c is None:
        return None
    g = lambda k, dflt: int(c.get(k, dflt))
    mult = c.get('hasMultTerms') == 'true'
    add = c.get('hasAddTerms') == 'true'
    return [g('redMultTerm', 256) if mult else 256, g('greenMultTerm', 256) if mult else 256,
            g('blueMultTerm', 256) if mult else 256, g('alphaMultTerm', 256) if mult else 256,
            g('redAddTerm', 0) if add else 0, g('greenAddTerm', 0) if add else 0,
            g('blueAddTerm', 0) if add else 0, g('alphaAddTerm', 0) if add else 0]

def rect(el, name):
    r = el.find(name)
    if r is None:
        return None
    return [int(r.get(k)) / 20 for k in ('Xmin', 'Ymin', 'Xmax', 'Ymax')]

def timeline(tags):
    frames, cur, labels = [], [], {}
    for t in tags:
        ty = t.get('type')
        if ty in ('PlaceObject2Tag', 'PlaceObject3Tag'):
            op = {'op': 'place', 'depth': int(t.get('depth'))}
            if t.get('placeFlagHasCharacter') == 'true':
                op['id'] = int(t.get('characterId'))
            if t.get('placeFlagMove') == 'true':
                op['move'] = 1
            if t.get('placeFlagHasMatrix') == 'true':
                op['m'] = matrix(t)
            if t.get('placeFlagHasColorTransform') == 'true':
                op['cx'] = cxform(t)
            if t.get('placeFlagHasName') == 'true':
                op['name'] = t.get('name')
            if t.get('placeFlagHasClipDepth') == 'true':
                op['clip'] = int(t.get('clipDepth'))
            if t.get('placeFlagHasRatio') == 'true':
                op['ratio'] = int(t.get('ratio'))
            if t.get('placeFlagHasBlendMode') == 'true':
                op['blend'] = int(t.get('blendMode'))
            if t.get('placeFlagHasFilterList') == 'true':
                op['filters'] = [f.get('type') for f in t.find('surfaceFilterList')] \
                    if t.find('surfaceFilterList') is not None else 1
            cur.append(op)
        elif ty in ('RemoveObject2Tag', 'RemoveObjectTag'):
            cur.append({'op': 'remove', 'depth': int(t.get('depth'))})
        elif ty == 'FrameLabelTag':
            labels[t.get('name')] = len(frames) + 1
        elif ty == 'DoActionTag':
            cur.append({'op': 'action'})
        elif ty == 'StartSoundTag':
            cur.append({'op': 'sound', 'id': int(t.get('soundId'))})
        elif ty == 'ShowFrameTag':
            frames.append(cur)
            cur = []
    return frames, labels

def main(src, dst):
    root = ET.parse(src).getroot()
    tags = root.find('tags')
    chars, exports = {}, {}
    for t in tags:
        ty = t.get('type')
        if ty == 'DefineSpriteTag':
            fr, lb = timeline(t.find('subTags'))
            chars[int(t.get('spriteId'))] = {'t': 'sprite', 'frames': fr, 'labels': lb}
        elif ty and ty.startswith('DefineShape'):
            chars[int(t.get('shapeId'))] = {'t': 'shape', 'b': rect(t, 'shapeBounds')}
        elif ty == 'DefineMorphShapeTag':
            chars[int(t.get('characterId'))] = {'t': 'morph', 'b': rect(t, 'startBounds'), 'b2': rect(t, 'endBounds')}
        elif ty in ('DefineTextTag', 'DefineText2Tag'):
            chars[int(t.get('characterID'))] = {'t': 'text', 'b': rect(t, 'textBounds'), 'm': matrix_named(t, 'textMatrix')}
        elif ty == 'DefineEditTextTag':
            c = t.find('textColor')
            chars[int(t.get('characterID'))] = {
                't': 'edit', 'b': rect(t, 'bounds'), 'var': t.get('variableName'),
                'text': t.get('initialText'), 'font': int(t.get('fontId') or 0),
                'size': int(t.get('fontHeight') or 0) / 20, 'align': int(t.get('align') or 0),
                'color': [int(c.get(k)) for k in ('red', 'green', 'blue', 'alpha')] if c is not None else None,
                'multiline': t.get('multiline') == 'true', 'wordWrap': t.get('wordWrap') == 'true',
                'leading': int(t.get('leading') or 0) / 20,
                'border': t.get('border') == 'true'}
        elif ty == 'DefineButton2Tag':
            recs = []
            for r in t.find('characters'):
                recs.append({'id': int(r.get('characterId')), 'depth': int(r.get('placeDepth')),
                             'm': matrix_named(r, 'placeMatrix'), 'cx': None,
                             'up': r.get('buttonStateUp') == 'true', 'over': r.get('buttonStateOver') == 'true',
                             'down': r.get('buttonStateDown') == 'true', 'hit': r.get('buttonStateHitTest') == 'true'})
            chars[int(t.get('buttonId'))] = {'t': 'button', 'recs': recs}
        elif ty and ty.startswith('DefineBits'):
            chars[int(t.get('characterID'))] = {'t': 'image'}
        elif ty == 'DefineSoundTag':
            chars[int(t.get('soundId'))] = {'t': 'sound'}
        elif ty and ty.startswith('DefineFont') and t.get('fontName'):
            chars[int(t.get('fontId') or t.get('fontID'))] = {'t': 'font', 'name': t.get('fontName')}
        elif ty == 'ExportAssetsTag':
            for i, n in zip(t.find('tags'), t.find('names')):
                exports[n.text] = int(i.text)
    fr, lb = timeline(tags)
    json.dump({'chars': chars, 'exports': exports, 'root': {'frames': fr, 'labels': lb}}, open(dst, 'w'))
    print(len(chars), 'chars', len(exports), 'exports')

def matrix_named(el, name):
    m = el.find(name)
    if m is None:
        return None
    hs, hr = m.get('hasScale') == 'true', m.get('hasRotate') == 'true'
    return [float(m.get('scaleX')) if hs else 1.0, float(m.get('rotateSkew0')) if hr else 0.0,
            float(m.get('rotateSkew1')) if hr else 0.0, float(m.get('scaleY')) if hs else 1.0,
            int(m.get('translateX')) / 20, int(m.get('translateY')) / 20]

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
