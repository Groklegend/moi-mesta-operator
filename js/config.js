// ============================================================
// Настройки подключения к Supabase
// ============================================================
// Браузер ходит на Supabase через наш Cloudflare Worker (/sb/*),
// а не напрямую на hcsaqrpsdcyfonuidgmf.supabase.co. Так мы обходим
// блокировку *.supabase.co некоторыми российскими провайдерами через
// DPI — у пользователя «Failed to fetch» / ERR_CONNECTION_RESET.
// Worker сам ходит на Supabase из CF и доходит без проблем.
//
// Прямой URL Supabase для справки:
//   https://hcsaqrpsdcyfonuidgmf.supabase.co
// Если когда-то понадобится откатить (например, для отладки) — вернуть
// его сюда. Реализация прокси — в src/worker.js, функция proxySupabase().

window.SUPABASE_CONFIG = {
  url: 'https://moi-mesta-operator.eklegendcity.workers.dev/sb',
  anonKey: 'sb_publishable_Ctf0ncSNnSbQvaRDxud_zQ_qQGlKMQ9'
};
