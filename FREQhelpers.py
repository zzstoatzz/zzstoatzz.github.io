import matplotlib as mpl
import matplotlib.gridspec as gridspec
import matplotlib.pyplot as plt
from matplotlib import animation, rc
import numpy as np
from ipywidgets import Output
from IPython.display import display, clear_output
import datetime, time

mpl.rcParams['axes.facecolor'] = 'black'
mpl.rcParams['font.family'] = 'serif'
mpl.rcParams['axes.grid'] = False
SizeLim = 25e6
mpl.rcParams['animation.embed_limit'] = SizeLim

def createDash(args):
    # derive anim characteristics from inputs
    duration, resolution, T, freqs, signal = args
    steps = int(maxSteps(SizeLim)*resolution)
    t_est = t_required(steps)
    buff = np.std(freqs)/2
    f_0, f_f = freqs[0]-buff, freqs[-1]+buff  # Hz, set for plot scaling
    t = np.linspace(0, T, steps)
    f = np.linspace(f_0, f_f, steps)
    interval = duration*1e3/steps

    # setup mpl fig
    objs = setupS(f_0, f_f, T, signal, freqs)
    fig = objs[0]

    # pack args and call animator
    args = (t, f, objs[1:], signal, freqs, t_est)
    anim = animation.FuncAnimation(fig, spectrum, frames=steps, fargs=args, interval=interval, blit=True)
    return anim

def maxSteps(L):
    a, b, c = 1.55979065e-11, -1.45174657e-04,  3.25730323e+02
    s = a*L**2+b*L + c
    return s

def t_required(s):
    a, b, c = 6.77857223e-06, 1.12168328e-01, 1.40973076e+00
    t = a*s**2+b*s+c
    return t

def progress(i, t, estimate, steps=20):
    x = int((i / len(t))*steps)
    bar = ['#']*x + ['-']*(steps-x)
    bar[-1] = '#' if i == len(t)-1 else '-'
    print('Creating animation with '+ str(len(t)) +' frames\n', *bar, end=' ')
    msg = str(int((i+1)/len(t)*100))+'% complete'
    remaining = datetime.timedelta(seconds = int(estimate*(1-i/len(t))))
    msg += '\n time remaining = '+str(remaining)
    print(msg, end='')

def setup(f,f_wrap, fig, flip=False ):        
    ax1 = plt.subplot2grid((6, 9), (0, 1), rowspan=2, colspan=8)
    ax2 = plt.subplot2grid((6, 9), (3, 0), rowspan=4, colspan=4, polar=True)
    ax3 = plt.subplot2grid((6, 9), (3, 5), rowspan=4, colspan=4)
    plt.subplots_adjust(wspace=3)
    if flip:
        ax1.set_xlim((0, np.pi))
    else:
        ax1.set_xlim((0, 6))
        ax3.set_xlim((0, 6))

    ax1.set_ylim((0, 1))
    ax2.xaxis.grid(False), ax2.yaxis.grid(False)
    ax3.xaxis.grid(False), ax3.yaxis.grid(False)
    ax2.set_yticklabels([]), ax2.set_xticklabels([])
    fig.suptitle('Oscillating Signal at $f = $' + str(f) + ' Hz')
    ax1.set_xlabel('Time (sec)', fontsize=8), ax1.set_ylabel('Intensity')
    ax2.set_xlabel('Wrapping Frequency: '+str(f_wrap)+' Hz', fontsize=8)
    ax3.set_xlabel('Time (sec)', fontsize=8), ax3.set_ylabel('Center of Mass')

    cart, = ax1.plot([], [], lw=1);
    polar, = ax2.plot([], [], 'g');
    moment, = ax3.plot([], [], 'r')
    fig.show(False)
    return (fig, cart, polar, moment,)

# wrap single frequency
def wrap(i, t, y, omega, cart, polar, moment, flip=False, ss=False):
    showProgress(i, t)
    clear_output(wait=True)
    cart.set_data([], [])
    polar.set_data([], [])
    #r, theta = np.sqrt(t**2 + y**2), np.arctan(y/t) -- weird fractal
    m = 1 + int(len(t)/8*(np.sin(i*np.pi/(len(t)/2)))**2)
    if flip:
        j = t[i-m:i+m+1] if i <= len(t)/2 else (2*np.pi-t)[i-m:i+m+1]
        k = y[i-m:i+m+1] if i <= len(t)/2 else y[i-m:i+m+1]
    elif ss:
        #j, k = t[:i+1], y[i:i+1] weird plane oscillation
        j, k = t[:i+1], y[:i+1]
    else:
        j, k = t[i-m:i+m+1], y[i-m:i+m+1]
    M = [np.mean(k[:p+1]) for p in range(len(k))]
    cart.set_data(j, k)
    polar.set_data(omega*j, k)
    moment.set_data(j, M)
    return (cart, polar,moment,)

# identify frequency in mixed signal
def setupS(f_0, f_f, T, signal, freqs):
    fig = plt.figure(figsize=(6, 4),dpi=400);
    ax1 = plt.subplot2grid((7, 9), (0, 0), rowspan=2, colspan=7)
    ax2 = plt.subplot2grid((7, 9), (3, 0), rowspan=5, colspan=3, polar=True)
    ax3 = plt.subplot2grid((7, 9), (3, 4), rowspan=4, colspan=5)
    ax4 = plt.subplot2grid((7, 9), (0, 7), rowspan=2, colspan=1)
    ax5 = plt.subplot2grid((7, 9), (0, 8), rowspan=2, colspan=1)
    plt.subplots_adjust(wspace=6)

    ax1.set_ylim((0, 1)), ax1.set_xlim((0, T))
    ax3.set_xlim((f_0, f_f)), ax3.set_ylim((-1/2/len(freqs), 1/2/len(freqs)))
    ax4.set_xlim((-1, 1)), ax5.set_xlim((-1, 1))
    ax4.set_ylim((f_0, f_f)), ax5.set_ylim((2*np.pi*f_0, f_f*2*np.pi))

    ax2.xaxis.grid(False), ax2.yaxis.grid(False)
    ax3.xaxis.grid(False), ax3.yaxis.grid(False)
    ax2.set_yticklabels([]), ax2.set_xticklabels([])
    ax3.set_yticklabels([])
    ax4.set_xticks([]), ax4.set_yticks(freqs), ax4.set_yticklabels(freqs, fontsize=5)
    ax5.set_xticks([]), ax5.set_yticks([])
    if signal:
        fig.suptitle('Signal at variable $f$')
    else:
        if len(freqs) > 1:
            f_desc = 'Signal containing musical notes $C_0$ and $C_1$ at '+str(freqs) + ' Hz'
        else: 
            f_desc = 'Signal at $f = $'+ str(freqs[0])

        fig.suptitle(f_desc, fontsize=10)

    ax1.set_xlabel('Periods', fontsize=8)
    ax3.set_xlabel('frequency (Hz)', fontsize=8), ax3.set_ylabel('Center of Mass')
    ax4.set_ylabel('Signal $f$ (Hz)', fontsize=5)
    ax5.set_ylabel('Wrapping $f$ (rad/s)', fontsize=5)

    cart, = ax1.plot([], [], lw=1)
    polar, = ax2.plot([], [], 'g', lw=0.6)
    loc, = ax1.plot([], [], 'o',c='#1f77b4', ms=2)
    moment, = ax3.plot([], [], 'r-')
    f_s, = ax4.plot([0]*len(freqs), freqs, 'o', c='#1f77b4')
    f_w, = ax5.plot([], [], 'go')

    return (fig, cart, polar, loc, moment, f_s, f_w,)

def spectrum(i, t, f, axes, signal, freqs, filter=1.1, A=2):
    cart, polar, loc, moment, f_s, f_w = axes
    progress(i, t, 100)
    clear_output(wait=True)
    f_i = f[i]

    if signal:
        pass
    else:
        omega = 2*np.pi*f_i
        c = waveform(freqs, t)
        M = [center(c, f_, t) for f_ in f[:i+1]]
        f_w.set_data(0, omega)

    cart.set_data(t, c)
    polar.set_data(omega*t, c)
    loc.set_data(t[i], c[i])
    moment.set_data(f[:i+1], M)
    return (cart, polar, loc, moment, f_s, f_w,)

def center(r, f_, t):#a, f_, t):
    omega = 2*np.pi*f_
    theta = omega*t
    x = r*np.sin(theta)
    return np.mean(x)

def waveform(freqs, t):
    wave = [0]*len(t)
    for freq in freqs:
        wave += np.sin(2*np.pi*freq*t)
    signal = 0.5*(1 + wave/len(freqs))
    return signal