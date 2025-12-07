"use client";

import { useState, useEffect, useRef, useCallback, type FC } from "react";
import { PitchDetector, frequencyToNoteDetails } from '@/utils/pitch-detector';

const MIN_CLARITY_THRESHOLD = 0.5; // Minimum clarity to display note (low since clarity is usually high)
const CONSECUTIVE_FRAMES_TO_SWITCH = 2; // Require N consecutive frames of different note before switching

const TunerPage: FC = () => {
	const [frequency, setFrequency] = useState<number | null>(null);
	const [noteDetails, setNoteDetails] = useState<{ note: string; octave: number; centsOff: number } | null>(null);
	const [clarity, setClarity] = useState<number>(0);
	const [isListening, setIsListening] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Ref to hold the PitchDetector instance
	const pitchDetectorRef = useRef<PitchDetector | null>(null);
	// Track consecutive frames of a candidate note before switching
	const candidateNoteRef = useRef<{ note: string; octave: number; count: number } | null>(null);
	// Track the current displayed note for comparison
	const currentNoteRef = useRef<{ note: string; octave: number } | null>(null);

	// Callback function passed to the detector
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

		// First detection or no current note
		if (!current) {
			setNoteDetails(newDetails);
			currentNoteRef.current = { note: newDetails.note, octave: newDetails.octave };
			candidateNoteRef.current = null;
			return;
		}

		const isSameNote = current.note === newDetails.note && current.octave === newDetails.octave;

		if (isSameNote) {
			// Same note - always update (cents will change)
			setNoteDetails(newDetails);
			candidateNoteRef.current = null;
		} else {
			// Different note - require consecutive frames before switching
			const candidate = candidateNoteRef.current;
			if (candidate && candidate.note === newDetails.note && candidate.octave === newDetails.octave) {
				candidate.count++;
				if (candidate.count >= CONSECUTIVE_FRAMES_TO_SWITCH) {
					// Switch to new note
					setNoteDetails(newDetails);
					currentNoteRef.current = { note: newDetails.note, octave: newDetails.octave };
					candidateNoteRef.current = null;
				}
				// Otherwise keep current note displayed (don't update cents from wrong note)
			} else {
				// New candidate
				candidateNoteRef.current = { note: newDetails.note, octave: newDetails.octave, count: 1 };
			}
		}
	}, []);

	const handleStart = useCallback(async () => {
		setError(null); // Clear previous errors
		if (pitchDetectorRef.current) return; // Already started
		currentNoteRef.current = null;
		candidateNoteRef.current = null;

		try {
			// Configure and create the detector instance
			pitchDetectorRef.current = new PitchDetector({
				sampleRate: 48000, // Higher sample rate
				bufferSize: 4096,  // Larger buffer
				threshold: 0.15,   // YIN threshold
				// Ensure the worklet path is correct relative to the public directory
				audioWorkletPath: '/pitch-detector-worklet.js' 
			});
			
			await pitchDetectorRef.current.start(handlePitchUpdate);
			setIsListening(true);
		} catch (err) {
			console.error('Error starting pitch detector:', err);
			setError(`Error starting tuner: ${err.message || 'Unknown error'}`);
			// Clean up if start failed partially
			if (pitchDetectorRef.current) {
				pitchDetectorRef.current.stop();
				pitchDetectorRef.current = null;
			}
			setIsListening(false); 
		}
	}, [handlePitchUpdate]); // Dependency on the stable callback

	const handleStop = useCallback(() => {
		pitchDetectorRef.current?.stop();
		pitchDetectorRef.current = null;

		// Reset state
		setIsListening(false);
		setFrequency(null);
		setNoteDetails(null);
		setClarity(0);
		setError(null);
		candidateNoteRef.current = null;
		currentNoteRef.current = null;
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		// Return the cleanup function
		return () => {
			handleStop(); // Use the stable handleStop function
		};
	}, [handleStop]); // Depend on the stable handleStop callback

	// Determine text color based on cents offset
	const getCentsColor = (cents: number): string => {
		const absCents = Math.abs(cents);
		if (absCents <= 5) return 'text-green-400'; // Very close
		if (absCents <= 15) return 'text-yellow-400'; // Slightly off
		return 'text-red-400'; // Significantly off
	};

	return (
		<div className="mx-auto max-w-2xl px-4 py-16 font-sans text-gray-200 flex flex-col items-center">
			<h1 className="text-3xl font-bold text-cyan-400 mb-8">12-tone equal temperament tuner</h1>
			
			<div className="mb-8">
				{!isListening ? (
					<button 
						type="button" 
						onClick={handleStart}
						className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-md transition duration-300 ease-in-out text-lg disabled:opacity-50"
						disabled={isListening} // Disable if already listening (though state should prevent overlap)
					>
						Start Tuning
					</button>
				) : (
					<button 
						type="button" 
						onClick={handleStop}
						className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-md transition duration-300 ease-in-out text-lg"
					>
						Stop Tuning
					</button>
				)}
			</div>

			{error && (
				<div className="mb-4 p-3 bg-red-900 border border-red-700 text-red-100 rounded-md">
					{error}
				</div>
			)}

			<div className="text-center flex flex-col justify-center items-center p-6 bg-gray-800 rounded-lg shadow-inner w-full max-w-md min-h-[24rem]">
				{isListening ? (
					<>
						<div className="h-12 mb-2">
							{frequency !== null ? (
								<p className="text-lg text-gray-400">
									Frequency: <span className="font-bold text-gray-100">{frequency.toFixed(1)}</span> Hz
								</p>
							) : null}
							<p className="text-sm text-gray-500">
							   Clarity: {(clarity * 100).toFixed(0)}%
							</p>
						</div>

						<div className="w-48 h-24 relative mb-4">
							<svg viewBox="0 0 100 50" className="w-full h-full absolute bottom-0 left-0 overflow-visible" aria-labelledby="gaugeTitle" role="img">
								<title id="gaugeTitle">Tuning Accuracy Gauge</title>
								<path 
									d="M 10 50 A 40 40 0 0 1 90 50" 
									stroke="#4a5568" // gray-600
									strokeWidth="3"
									fill="none"
								/>
								<line x1="50" y1="5" x2="50" y2="10" stroke="#a0aec0" strokeWidth="1" />
								
								{noteDetails && clarity >= MIN_CLARITY_THRESHOLD && (
									<line
										x1="50" 
										y1="50" // Base of the needle at the bottom center
										x2="50"
										y2="10" // Tip of the needle
										stroke={getCentsColor(noteDetails.centsOff).replace('text-', '').split('-')[0] === 'green' ? '#48bb78' : getCentsColor(noteDetails.centsOff).replace('text-', '').split('-')[0] === 'yellow' ? '#ecc94b' : '#f56565'} // Use color from getCentsColor
										strokeWidth="2"
										style={{
											transformOrigin: '50px 50px', // Rotate around the base
											// Clamp cents to +/- 50, map to +/- 90 degrees
											transform: `rotate(${Math.max(-50, Math.min(50, noteDetails.centsOff)) * (90 / 50)}deg)`,
											transition: 'transform 0.1s ease-out' // Smooth transition
										}}
									/>
								)}
							</svg>
						</div>

						<div className="h-32">
							{noteDetails ? (
								<div className="text-6xl font-bold text-cyan-300">
									<span className="align-top text-4xl mr-1">{noteDetails.note}</span>
									<span>{noteDetails.octave}</span>
									<p className={`text-xl font-normal mt-2 ${getCentsColor(noteDetails.centsOff)}`}>
									   Cents: <span className="font-semibold">{noteDetails.centsOff > 0 ? '+' : ''}{noteDetails.centsOff}</span>
									</p>
								</div>
							) : (
								<p className="text-2xl text-gray-500 animate-pulse h-full flex items-center justify-center">Listening...</p>
							)}
						</div>
					</>
				) : (
					<p className='text-xl text-gray-500 h-full flex items-center justify-center'>Click &quot;Start Tuning&quot; to begin</p>
				)}
			</div>

		</div>
	);
};

export default TunerPage;
