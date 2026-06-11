'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { PitchDetector, frequencyToNoteDetails } from '@/utils/pitch-detector';

declare global {
    interface Window {
        particleSystem?: {
            setAudioSignal: (
                frequency: number | null,
                clarity: number,
                level: number
            ) => void;
            setAudioEnabled: (enabled: boolean) => void;
            setAudioMode: (mode: string) => void;
            audioModes?: { grip: number };
        };
    }
}

const MIN_CLARITY = 0.6;
const MODES = ['cymatics', 'torch', 'altitude'] as const;
type Mode = (typeof MODES)[number];

export default function AudioRig() {
    const [listening, setListening] = useState(false);
    const [mode, setMode] = useState<Mode>('cymatics');
    const [note, setNote] = useState<string | null>(null);
    const [level, setLevel] = useState(0);
    const [error, setError] = useState(false);
    const detectorRef = useRef<PitchDetector | null>(null);

    const stop = useCallback(() => {
        detectorRef.current?.stop();
        detectorRef.current = null;
        window.particleSystem?.setAudioEnabled(false);
        setListening(false);
        setNote(null);
        setLevel(0);
    }, []);

    const start = useCallback(async () => {
        setError(false);
        if (detectorRef.current) return;
        try {
            const detector = new PitchDetector({ bufferSize: 2048, threshold: 0.15 });
            detectorRef.current = detector;
            await detector.start((frequency, clarity, rms) => {
                window.particleSystem?.setAudioSignal(frequency, clarity, rms);
                // show what the rig perceives (auto-gained grip), not raw rms
                setLevel(window.particleSystem?.audioModes?.grip ?? 0);
                if (frequency && clarity >= MIN_CLARITY) {
                    const details = frequencyToNoteDetails(frequency);
                    if (details) setNote(`${details.note}${details.octave}`.toLowerCase());
                } else {
                    setNote(null);
                }
            });
            window.particleSystem?.setAudioEnabled(true);
            setListening(true);
        } catch {
            detectorRef.current?.stop();
            detectorRef.current = null;
            setError(true);
        }
    }, []);

    const pickMode = (m: Mode) => {
        setMode(m);
        window.particleSystem?.setAudioMode(m);
    };

    useEffect(() => stop, [stop]);

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
            {listening && (
                <div className="glass-thin p-1 flex gap-1" style={{ borderRadius: 999 }}>
                    {MODES.map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => pickMode(m)}
                            aria-pressed={mode === m}
                            className={`px-3 py-1 text-xs transition-all ${
                                mode === m
                                    ? 'bg-cyan-300/20 text-cyan-200'
                                    : 'text-white/50 hover:text-white/80'
                            }`}
                            style={{ borderRadius: 999 }}
                        >
                            {m}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                {listening && (
                    <output
                        className="glass-thin px-3 py-1.5 text-sm text-white/80 flex items-center gap-2"
                        style={{ borderRadius: 999 }}
                    >
                        <span
                            className="h-1 rounded-full bg-cyan-300/80 transition-all duration-100"
                            style={{ width: `${4 + level * 36}px` }}
                            aria-hidden
                        />
                        {note ?? '·'}
                    </output>
                )}
                {error && (
                    <span
                        className="glass-thin px-3 py-1.5 text-sm text-red-300"
                        style={{ borderRadius: 999 }}
                        role="alert"
                    >
                        mic blocked
                    </span>
                )}
                <button
                    type="button"
                    onClick={listening ? stop : start}
                    aria-pressed={listening}
                    aria-label={listening ? 'stop listening' : 'sing to the particles'}
                    title="sing to the particles"
                    className={`glass-thin p-2.5 transition-all focus:outline-none focus:ring-1 focus:ring-cyan-300/30 ${
                        listening
                            ? 'text-cyan-300'
                            : 'text-cyan-300/60 hover:text-cyan-300'
                    }`}
                    style={{ borderRadius: 999 }}
                >
                    <Mic className="w-5 h-5" aria-hidden />
                </button>
            </div>
        </div>
    );
}
