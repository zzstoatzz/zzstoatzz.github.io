"use client";

import { useState, useEffect, useRef, useCallback, type FC } from "react";
import { A4_FREQ, PitchDetector, frequencyToNoteDetails } from '@/utils/pitch-detector';

const MIN_CLARITY_THRESHOLD = 0.5; // Minimum clarity to display note (low since clarity is usually high)
const CONSECUTIVE_FRAMES_TO_SWITCH = 2; // Require N consecutive frames of different note before switching

type NoteDetails = { note: string; octave: number; centsOff: number };

// Tuning state from cents offset. Color is supplementary — `label` and `arrow`
// carry the same meaning without relying on color.
function tuningState(cents: number): { label: string; arrow: string; color: string } {
    const abs = Math.abs(cents);
    if (abs <= 5) return { label: 'in tune', arrow: '·', color: '#34d399' };
    if (cents < 0) return { label: abs <= 15 ? 'slightly flat' : 'flat', arrow: '↓', color: abs <= 15 ? '#fbbf24' : '#f87171' };
    return { label: abs <= 15 ? 'slightly sharp' : 'sharp', arrow: '↑', color: abs <= 15 ? '#fbbf24' : '#f87171' };
}

const TunerPage: FC = () => {
    const [frequency, setFrequency] = useState<number | null>(null);
    const [noteDetails, setNoteDetails] = useState<NoteDetails | null>(null);
    const [clarity, setClarity] = useState<number>(0);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioSampleRate, setAudioSampleRate] = useState<number | null>(null);
    const [inputSettings, setInputSettings] = useState<MediaTrackSettings | null>(null);

    const pitchDetectorRef = useRef<PitchDetector | null>(null);
    const candidateNoteRef = useRef<{ note: string; octave: number; count: number } | null>(null);
    const currentNoteRef = useRef<{ note: string; octave: number } | null>(null);

    const formatSetting = (value: unknown): string => {
        if (value === undefined || value === null) return 'n/a';
        return String(value);
    };

    const handlePitchUpdate = useCallback((detectedFrequency: number | null, detectedClarity: number) => {
        setFrequency(detectedFrequency);
        setClarity(detectedClarity);

        if (!detectedFrequency || detectedClarity < MIN_CLARITY_THRESHOLD) {
            setNoteDetails(null);
            currentNoteRef.current = null;
            candidateNoteRef.current = null;
            return;
        }

        const newDetails = frequencyToNoteDetails(detectedFrequency);
        if (!newDetails) return;

        const current = currentNoteRef.current;

        if (!current) {
            setNoteDetails(newDetails);
            currentNoteRef.current = { note: newDetails.note, octave: newDetails.octave };
            candidateNoteRef.current = null;
            return;
        }

        const isSameNote = current.note === newDetails.note && current.octave === newDetails.octave;

        if (isSameNote) {
            setNoteDetails(newDetails);
            candidateNoteRef.current = null;
        } else {
            const candidate = candidateNoteRef.current;
            if (candidate && candidate.note === newDetails.note && candidate.octave === newDetails.octave) {
                candidate.count++;
                if (candidate.count >= CONSECUTIVE_FRAMES_TO_SWITCH) {
                    setNoteDetails(newDetails);
                    currentNoteRef.current = { note: newDetails.note, octave: newDetails.octave };
                    candidateNoteRef.current = null;
                }
            } else {
                candidateNoteRef.current = { note: newDetails.note, octave: newDetails.octave, count: 1 };
            }
        }
    }, []);

    const handleStart = useCallback(async () => {
        setError(null);
        if (pitchDetectorRef.current) return;
        currentNoteRef.current = null;
        candidateNoteRef.current = null;

        try {
            pitchDetectorRef.current = new PitchDetector({
                sampleRate: 48000,
                bufferSize: 4096,
                threshold: 0.15,
            });

            await pitchDetectorRef.current.start(handlePitchUpdate);
            setAudioSampleRate(pitchDetectorRef.current.getAudioContextSampleRate());
            setInputSettings(pitchDetectorRef.current.getInputSettings());
            setIsListening(true);
        } catch (err) {
            console.error('Error starting pitch detector:', err);
            setError(`couldn't start the tuner: ${(err as Error).message || 'unknown error'}. check mic permissions.`);
            if (pitchDetectorRef.current) {
                pitchDetectorRef.current.stop();
                pitchDetectorRef.current = null;
            }
            setIsListening(false);
        }
    }, [handlePitchUpdate]);

    const handleStop = useCallback(() => {
        pitchDetectorRef.current?.stop();
        pitchDetectorRef.current = null;

        setIsListening(false);
        setFrequency(null);
        setNoteDetails(null);
        setClarity(0);
        setError(null);
        setAudioSampleRate(null);
        setInputSettings(null);
        candidateNoteRef.current = null;
        currentNoteRef.current = null;
    }, []);

    useEffect(() => {
        return () => {
            handleStop();
        };
    }, [handleStop]);

    const state = noteDetails ? tuningState(noteDetails.centsOff) : null;
    const needleAngle = noteDetails
        ? Math.max(-50, Math.min(50, noteDetails.centsOff)) * (90 / 50)
        : 0;
    const announcement = noteDetails && state
        ? `${noteDetails.note}${noteDetails.octave}, ${Math.abs(noteDetails.centsOff)} cents ${state.label}`
        : isListening
            ? 'listening for a pitch'
            : '';

    return (
        <main className="tuner">
            <header className="tuner-head">
                <h1 className="tuner-title">tuner</h1>
                <p className="tuner-sub">12-tone equal temperament · A4 = {A4_FREQ} Hz</p>
            </header>

            <button
                type="button"
                onClick={isListening ? handleStop : handleStart}
                className="tuner-toggle"
                data-active={isListening}
                aria-pressed={isListening}
            >
                <span className="tuner-toggle-dot" aria-hidden />
                {isListening ? 'stop' : 'start tuning'}
            </button>

            {error && (
                <div className="tuner-error" role="alert">
                    {error}
                </div>
            )}

            <section className="tuner-display glass" aria-label="tuning readout">
                {/* Screen-reader announcement of the detected note + tuning state */}
                <p className="sr-only" aria-live="polite">{announcement}</p>

                {!isListening ? (
                    <p className="tuner-idle">press start and play a note</p>
                ) : (
                    <>
                        <div className="tuner-gauge" aria-hidden>
                            <svg viewBox="0 0 100 56" className="tuner-gauge-svg" role="img">
                                <title>tuning accuracy gauge</title>
                                <path d="M 10 50 A 40 40 0 0 1 90 50" stroke="rgba(255,255,255,0.15)" strokeWidth="3" fill="none" strokeLinecap="round" />
                                <line x1="50" y1="6" x2="50" y2="12" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
                                {noteDetails && state && clarity >= MIN_CLARITY_THRESHOLD && (
                                    <line
                                        x1="50"
                                        y1="50"
                                        x2="50"
                                        y2="12"
                                        stroke={state.color}
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                        style={{
                                            transformOrigin: '50px 50px',
                                            transform: `rotate(${needleAngle}deg)`,
                                            transition: 'transform 0.12s ease-out, stroke 0.2s',
                                        }}
                                    />
                                )}
                            </svg>
                        </div>

                        <div className="tuner-note" aria-hidden>
                            {noteDetails ? (
                                <>
                                    <span className="tuner-note-name">
                                        {noteDetails.note}
                                        <span className="tuner-note-octave">{noteDetails.octave}</span>
                                    </span>
                                    {state && (
                                        <span className="tuner-state" style={{ color: state.color }}>
                                            <span className="tuner-state-arrow">{state.arrow}</span>
                                            {state.label}
                                            <span className="tuner-cents">
                                                {noteDetails.centsOff > 0 ? '+' : ''}{noteDetails.centsOff}¢
                                            </span>
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="tuner-listening">listening…</span>
                            )}
                        </div>

                        <div className="tuner-readout" aria-hidden>
                            <span>{frequency !== null ? `${frequency.toFixed(1)} Hz` : '— Hz'}</span>
                            <span className="tuner-readout-sep">·</span>
                            <span>clarity {(clarity * 100).toFixed(0)}%</span>
                        </div>
                    </>
                )}
            </section>

            {isListening && (
                <details className="tuner-meta glass-thin">
                    <summary>input details</summary>
                    <dl className="tuner-meta-grid">
                        <dt>A4 reference</dt>
                        <dd>{A4_FREQ} Hz</dd>
                        <dt>audiocontext sample rate</dt>
                        <dd>{audioSampleRate ? `${audioSampleRate} Hz` : 'n/a'}</dd>
                        <dt>input sample rate</dt>
                        <dd>{inputSettings?.sampleRate ? `${inputSettings.sampleRate} Hz` : 'n/a'}</dd>
                        <dt>input channels</dt>
                        <dd>{formatSetting(inputSettings?.channelCount)}</dd>
                        <dt>echo cancellation</dt>
                        <dd>{formatSetting(inputSettings?.echoCancellation)}</dd>
                        <dt>noise suppression</dt>
                        <dd>{formatSetting(inputSettings?.noiseSuppression)}</dd>
                        <dt>auto gain</dt>
                        <dd>{formatSetting(inputSettings?.autoGainControl)}</dd>
                    </dl>
                </details>
            )}
        </main>
    );
};

export default TunerPage;
