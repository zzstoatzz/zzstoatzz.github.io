import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from colour import Color
import matplotlib as mpl
import math

def load(sheetname, col=''):
    dat = pd.read_excel('data.xlsx', sheet_name=sheetname)
    if col != '':
        dat = dat[col].tolist()
    return dat

mpl.rcParams['figure.dpi']= 600
mpl.rcParams['figure.figsize'] = (5, 2)
mpl.rcParams['font.family']= 'serif'
freqs, scales, notes = load('freqs'), load('intervals'), load('freqs', col='genName')
N, genName, f, LAMBDA = freqs.columns    
intervals = {}
for i,j in scales.iterrows():
    intervals[j['intervals']] = i


def ID_note(FREQ):
    for i, j in freqs.iterrows():
        if abs(j[f]/FREQ - 1) < 0.05:
            return j[N], j[genName]
    assert(False)

#def validChord(notes):
    blocked = len([note.sN for note in notes]) != len(set([note.sN for note in notes]))
    far = False
    for note in notes:
        far = any([abs(n.fN-note.fN) > 2 for n in notes])
    
    if blocked or far:
        return False

def renderBoard(obj, focus=None):
    fig, ax = plt.subplots()
    r, l, u, d = ax.spines["right"], ax.spines["left"], ax.spines["top"], ax.spines["bottom"]
    r.set_visible(False), l.set_visible(False), u.set_visible(False), d.set_visible(False)
    for fret in obj.noteBank:
        for note in fret:
            h, c = 1-note.stringHeight/obj.width, colorize(note)
            x, y = note.fretNum, obj.width-note.stringHeight+1
            a, f, ec, ms, l = emphasize(focus, note)
            plt.plot(x, y,'.', ms=ms, mfc=c, mec=ec, mew=f*np.exp(-h**2), alpha=a)
            plt.annotate(l, xy=(x-.1, y-.03), fontsize=1.6)
    plt.ylim(-.1, obj.width+.5)
    plt.title('Notes of '+ focus.name+' in '+obj.tuning+' tuning:', fontsize=6)
    plt.xticks([3, 5, 7, 12, 15, 17], fontsize=6)
    plt.yticks(range(1,7), labels=list(obj.baseNotes.keys())[::-1],fontsize=6)            
    plt.hlines([i+1 for i in range(6)],xmin=0, xmax=obj.len-1, alpha=0.3, lw=0.5)
    return fig

def savefig(obj, filename):
    fig = obj.fig
    plt.savefig(filename, pad_inches=2)

def colorize(note, obj=True):
    colors = {'A': '#1e90ff', 'B':'#02b331', 'C':'#ffd700', 'D':'#e69109', 'E':'#ff0000', 'F':'#c71585', 'G':'#0000ff'}
    keys = sorted(colors.keys())
    for i, N in enumerate(keys):
        c, r = colors[N], Color(colors[N])
        name = note.name if obj else note
        if N in name:
            if '#' in name:
                nxt = Color(colors[keys[i+1]])
                return list(r.range_to(nxt, 3))[1].hex
            elif 'b' in name:
                prv = Color(colors[keys[i-1]])
                return list(r.range_to(prv, 3))[1].hex
            elif N in name:
                return c
    print('ERROR: could not determine note')
    assert(False)

def getInterval(ref, interval):
    i = notes.index(ref)
    if interval == '1':
        return ref
    jump = intervals[interval]
    return notes[(i+jump)%len(notes)]

def getKeyNotes(key):
    if 'major' in key:
        ints = [i for i in scales['major'] if 'X' not in str(i)]
        ref = key.strip(' major')
    else:
        ints = [i for i in scales['minor'] if 'X' not in str(i)]
        ref = key.strip(' minor')
    keynotes = [getInterval(ref, i) for i in ints]
    return keynotes, [i for i in scales['intervals'] if i in ints]

def highlight(obj):
    return obj

def emphasize(focus, note):
    label = None
    if focus == None:
        a, f, ec, ms = 0.99, 0.7, 'k', 8
    elif note.genName in focus.notes:
        a, f, ec = 1, 0.7, 'k'
        ms = 10 if note.genName == focus.root else 7
        label = focus.intervals[note.genName]
    else:
        a, f, ec, ms = 0.2, 0.6, colorize(focus.root, obj=False), 5
    return a, f, ec, ms, label