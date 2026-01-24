'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Wrench, RefreshCw } from 'lucide-react';
import CloudBackground from './CloudBackground';

function MaintenancePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-sky-200">
      <CloudBackground />
      
      {/* Main Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 flex flex-col items-center text-center px-6"
      >
        {/* Animated Icon */}
        <motion.div
          animate={{ 
            rotate: [0, 10, -10, 0],
            scale: [1, 1.05, 1]
          }}
          transition={{ 
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="mb-8"
        >
          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-2xl">
            <Wrench className="w-16 h-16 text-white" />
          </div>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-4xl md:text-5xl font-bold text-slate-800 mb-8"
        >
          Under Maintenance
        </motion.h1>

        {/* Info Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="flex flex-col items-center gap-4 bg-white/80 backdrop-blur-sm rounded-2xl px-8 py-6 shadow-lg"
        >
          {/* Loading Animation + Text */}
          <div className="flex items-center gap-3 text-slate-600">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <RefreshCw className="w-5 h-5 text-blue-500" />
            </motion.div>
            <span className="text-base font-medium">Please check back soon</span>
          </div>

          {/* Divider */}
          <div className="w-full h-px bg-slate-200" />

          {/* Follow on X */}
          <a
            href="https://x.com/basion_tap"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-slate-700 hover:text-blue-600 transition-colors font-medium"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="w-5 h-5 fill-current"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
            </svg>
            Follow updates on X
          </a>
        </motion.div>
      </motion.div>

      {/* Decorative Elements */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white/20 to-transparent pointer-events-none" />
    </main>
  );
}

export default MaintenancePage;
