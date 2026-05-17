'use client';

import { useEffect, useState } from 'react';

interface FirstVisitModalProps {
  onDismiss: () => void;
}

export default function FirstVisitModal({ onDismiss }: FirstVisitModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setIsLeaving(true);
    setTimeout(() => {
      onDismiss();
    }, 400);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-500 ${
        isVisible && !isLeaving ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleDismiss}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleDismiss();
          }
        }}
        role="button"
        tabIndex={0}
      />
      
      <dialog
        className={`glass-strong relative z-10 max-w-md mx-4 p-8 transform transition-all duration-500 ${
          isVisible && !isLeaving
            ? 'translate-y-0 scale-100'
            : 'translate-y-4 scale-95'
        }`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        open
      >
        <div className="space-y-4">
          <p className="text-gray-300 text-lg">
            psst! tap and hold to push the particles around. 
            see <b>particle settings</b> in the top right to edit physics
          </p>
          
          <button
            type="button"
            onClick={handleDismiss}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleDismiss();
              }
            }}
            className="mt-6 w-full py-6 bg-blue-500 hover:bg-blue-600 text-white text-xl font-bold rounded-lg transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
          >
            TAP ANYWHERE TO DISMISS
          </button>
        </div>
      </dialog>
    </div>
  );
}