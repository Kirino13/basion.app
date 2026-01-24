import { NextResponse } from 'next/server';

// Maintenance mode from environment
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const MAINTENANCE_MESSAGE = process.env.MAINTENANCE_MESSAGE || 'Service is under maintenance. Please try again later.';
const MAINTENANCE_RETRY_AFTER = parseInt(process.env.MAINTENANCE_RETRY_AFTER || '3600'); // Default 1 hour

/**
 * GET /api/status
 * 
 * Returns current service status.
 * Bots should check this before starting and periodically during operation.
 */
export async function GET() {
  if (MAINTENANCE_MODE) {
    return NextResponse.json({
      status: 'maintenance',
      maintenance: true,
      message: MAINTENANCE_MESSAGE,
      retryAfter: MAINTENANCE_RETRY_AFTER,
    });
  }

  return NextResponse.json({
    status: 'operational',
    maintenance: false,
    message: 'All systems operational',
  });
}
