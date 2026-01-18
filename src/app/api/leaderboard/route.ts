import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');

    const supabase = getSupabaseAdmin();

    // Если Supabase не настроен - возвращаем пустой массив
    if (!supabase) {
      console.warn('Supabase не настроен. Leaderboard будет пустым.');
      return NextResponse.json([]);
    }

    const { data, error } = await supabase
      .from('users')
      .select('main_wallet, points')
      .gt('points', 0) // Только пользователи с очками
      .order('points', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    // Форматируем ответ с рангами
    const leaderboard = (data || []).map((user, index) => ({
      rank: index + 1,
      wallet: user.main_wallet,
      points: user.points || 0,
    }));

    return NextResponse.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard error:', error);
    // Возвращаем пустой массив при ошибке
    return NextResponse.json([], { status: 200 });
  }
}
