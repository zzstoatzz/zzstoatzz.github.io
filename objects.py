import HLhelpers as h

class Tuning():
    def __init__(self, name = 'standard'):
        self.freqs = h.load('freqs')
        self.tunings = {}
        self.name = name
        self.tunings['standard'] = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2']
        # write self.load() from xlsx if many more
    def getNotes(self, tuning='standard'):
        N, _, f, L = self.freqs.columns
        notes, i = {}, 1
        for note in self.tunings[tuning]:
            FREQ = float(self.freqs.loc[self.freqs[N] == note][f])
            LAMBDA = float(self.freqs.loc[self.freqs[N] == note][L])
            notes[note] = {'height':i, f:FREQ, L:LAMBDA}
            i += 1
        return notes, tuning

class Board:
    def __init__(self, numFrets=24, numStrings=6):
        self.len, self.width = numFrets, numStrings
        self.keys = h.load('freqs', col='genName')
        self.baseNotes, self.tuning = Tuning().getNotes()
        self.frets = [Fret(self, i) for i in range(numFrets)]
        self.noteBank = [fret.notes for fret in self.frets]
        self.notes = {}
        self.fig = ''
        for fret in self.noteBank:
            for note in fret:
                self.notes[note.name] = note

    def getBN(self):
        return self.baseNotes
    
    def show(self, arg=False):
        if arg=='text':
            for fret in self.noteBank:
                for note in fret:
                    print(note)
                print('\n')
        else:
            self.fig = h.renderBoard(self, arg)
    def save(self, filename):
        if self.fig == '':
            print('Create an image first')
            return
        h.savefig(self, filename)

class Note():
    def __init__(self, obj, sN, sH, fN):
        self.stringName, self.stringHeight, self.fretNum = sN, sH, fN
        self.FREQ = round(obj.baseNotes[self.stringName]['f (Hz)'] * 2**(self.fretNum/12), 3)
        self.name, self.genName = h.ID_note(self.FREQ)
    def __str__(self):
        summary = self.name+" note on fret "+str(self.fretNum) +" of the open "+self.stringName+ " ("+ str(self.stringHeight)+") string"
        return summary

class Fret():
    def __init__(self, obj, fN):
        self.id = fN
        BN = obj.getBN()
        self.notes = [Note(obj, key, BN[key]['height'], fN) for key in BN]
    def __str__(self):
        return str(self.id)

class Key():
    def __init__(self, name):
        self.name = name
        self.notes, ints = h.getKeyNotes(name)
        self.intervals = {}
        for i in range(len(self.notes)):
            self.intervals[self.notes[i]] = ints[i]
        self.root = self.notes[0]

'''
class Chord():
    def __init__(self, name):
        self.name = name
    def CAGED(self):
        print("TODO")
        return None
    def scale(self):
        print("TODO")
        return None
    def Inversion(self):
        print("TODO")
        return None
'''