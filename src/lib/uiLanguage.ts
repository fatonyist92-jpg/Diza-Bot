const SIMPLE_INDONESIAN_TEXT: Record<string, string> = {
  "I'm Diza, your Personal AI. Tell me what you need, or make more bots, each with its own job.":
    "Saya Diza, AI pribadi Anda. Beri tahu apa yang Anda butuhkan, atau buat bot lain untuk tugas yang berbeda.",
  "I'm ready. Tell me what you need and I'll get to work.":
    "Saya siap. Beri tahu apa yang Anda butuhkan, saya akan mulai bekerja.",
  "How should we work together?": "Bagaimana kita bekerja bersama?",
  "This shapes how much I check in versus just handle things.":
    "Pilih seberapa sering saya perlu bertanya sebelum bertindak.",
  "Check with me before acting": "Tanya saya sebelum bertindak",
  "Act on the small stuff, ask on the big": "Kerjakan hal kecil, tanyakan yang penting",
  "Keep me posted, I trust you": "Kabari saya, selebihnya lanjutkan",
  "General": "Umum",
  "Personal AI": "AI Pribadi",
};

export function simpleIndonesianText(value: string): string {
  return SIMPLE_INDONESIAN_TEXT[value] ?? value;
}
