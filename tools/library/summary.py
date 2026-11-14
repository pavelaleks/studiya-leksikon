import json, sys
c = json.load(open('js/library-data/catalog.json'))
for w in c['works']:
    toc = w.get('toc')
    if not toc or (len(sys.argv) > 1 and w['id'] not in sys.argv[1:]):
        continue
    ts = [t['t'] for t in toc]
    print(f"{w['id']:15} {w['chars']//1000:5}k {len(ts):3} | {' | '.join(ts[:4])} ... {' | '.join(ts[-2:])}")
