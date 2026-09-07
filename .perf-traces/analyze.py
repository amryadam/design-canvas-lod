import json, sys, collections

def load(p):
    d = json.load(open(p))
    return d['traceEvents'] if isinstance(d, dict) else d

def analyze(path, label):
    ev = load(path)
    # thread names
    tname = {}
    for e in ev:
        if e.get('ph') == 'M' and e.get('name') == 'thread_name':
            tname[(e['pid'], e['tid'])] = e['args']['name']
    # gesture window from user timing marks
    marks = {e['name']: e['ts'] for e in ev if e.get('name') in ('gesture-start', 'gesture-end') and e.get('ph') in ('R', 'I', 'n', 'b')}
    if 'gesture-start' in marks and 'gesture-end' in marks:
        lo, hi = marks['gesture-start'], marks['gesture-end']
    else:
        ts = [e['ts'] for e in ev if 'ts' in e]
        lo, hi = min(ts), max(ts)
    dur_ms = (hi - lo) / 1000.0

    # main renderer thread = the CrRendererMain with the most X-event time in window
    busy = collections.Counter()
    for e in ev:
        if e.get('ph') == 'X' and e.get('dur') and lo <= e['ts'] <= hi:
            busy[(e['pid'], e['tid'])] += e['dur']
    mains = [(k, v) for k, v in busy.items() if tname.get(k) == 'CrRendererMain']
    main = max(mains, key=lambda kv: kv[1])[0] if mains else None

    by_name_main = collections.Counter(); cnt_main = collections.Counter()
    by_name_all = collections.Counter()
    frames = 0
    for e in ev:
        if e.get('ph') != 'X' or not e.get('dur'): continue
        if not (lo <= e['ts'] <= hi): continue
        k = (e['pid'], e['tid']); n = e['name']
        by_name_all[n] += e['dur']
        if k == main:
            by_name_main[n] += e['dur']; cnt_main[n] += 1
    # top-level main thread busy: RunTask events
    total_main = by_name_main.get('RunTask', 0)
    interesting = ['UpdateLayoutTree','Layout','ParseHTML','PrePaint','Paint','Commit','Layerize',
                   'UpdateLayerTree','FunctionCall','EventDispatch','HitTest','V8.Execute',
                   'ScheduledAction::execute','TimerFire','RunMicrotasks']
    print(f'=== {label} ===  window {dur_ms:.0f} ms   main-thread busy {total_main/1000:.0f} ms ({100*total_main/1000/dur_ms:.0f}%)')
    for n in interesting:
        if by_name_main.get(n):
            print(f'  {n:<24} {by_name_main[n]/1000:8.1f} ms   n={cnt_main[n]:<5} avg={by_name_main[n]/cnt_main[n]/1000:6.2f} ms')
    raster = sum(v for n, v in by_name_all.items() if 'Raster' in n or 'Decode' in n)
    print(f'  [off-main] raster/decode  {raster/1000:8.1f} ms')
    for n in ['RasterTask','Rasterize']:
        if by_name_all.get(n): print(f'      {n:<20} {by_name_all[n]/1000:8.1f} ms')
    print()
    return by_name_main, cnt_main, dur_ms

for arg in sys.argv[1:]:
    path, label = arg.split('=', 1)
    analyze(path, label)
