'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle } from 'lucide-react';

interface CongestionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CongestionModal: React.FC<CongestionModalProps> = ({ isOpen, onClose }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[320px] rounded-3xl p-6 text-center"
            style={{
              background: 'linear-gradient(180deg, #E8F4FC 0%, #D6EBF8 100%)',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
            }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Warning Icon */}
            <div className="flex justify-center mb-4">
              <div 
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(180deg, #E8F4FC 0%, #C8E4F5 100%)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                }}
              >
                <AlertTriangle className="w-8 h-8 text-amber-500" strokeWidth={2.5} />
              </div>
            </div>

            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900 mb-3">
              Base is Congested!
            </h2>

            {/* Description */}
            <p className="text-gray-600 text-sm leading-relaxed">
              Don&apos;t waste your taps on high gas fees. Try again in a few minutes!
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CongestionModal;
