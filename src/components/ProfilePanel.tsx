import { useEffect, useState } from "react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import UserRound from "lucide-react/dist/esm/icons/user-round.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const savedAbout = state.config?.profile?.about ?? "";
  const savedPreferences = state.config?.profile?.preferences ?? "";
  const [about, setAbout] = useState(savedAbout);
  const [preferences, setPreferences] = useState(savedPreferences);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || !state.config) return;
    setAbout(savedAbout);
    setPreferences(savedPreferences);
    setLoaded(true);
  }, [loaded, state.config, savedAbout, savedPreferences]);

  const save = () => {
    if (saving) return;
    setSaving(true);
    api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ profile: { about, preferences } }),
    })
      .then((status) => {
        dispatch({ type: "configStatus", config: status });
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1600);
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <main className="fixed inset-0 z-50 flex min-h-0 w-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-3">
        <button
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-full active:bg-accent"
          aria-label="Kembali"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold">Profil Saya</div>
          <div className="text-[11.5px] text-muted-foreground">Informasi tentang Anda untuk membantu DIZA memahami konteks.</div>
        </div>
        <span className="flex size-9 items-center justify-center rounded-full bg-accent/70 text-muted-foreground" aria-hidden>
          <UserRound size={18} />
        </span>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-[620px]">
          <div className="rounded-2xl border bg-card p-4">
            <div className="text-[14px] font-semibold">Tentang saya</div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Isi hal penting tentang diri, pekerjaan, atau tujuan Anda.
            </div>
            <Textarea
              value={about}
              onChange={(event) => setAbout(event.target.value)}
              placeholder="Contoh: Saya bekerja di bidang otomasi pabrik dan sering membahas PLC, AI, dan perbaikan mesin."
              className="mt-3 min-h-[120px] resize-none text-[13px]"
            />
          </div>

          <div className="mt-3 rounded-2xl border bg-card p-4">
            <div className="text-[14px] font-semibold">Cara saya ingin DIZA menjawab</div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Tulis gaya jawaban yang Anda suka. Ini tetap sama walau engine AI berubah.
            </div>
            <Textarea
              value={preferences}
              onChange={(event) => setPreferences(event.target.value)}
              placeholder="Contoh: Gunakan Bahasa Indonesia yang singkat, jelas, dan jelaskan istilah teknis dengan sederhana."
              className="mt-3 min-h-[120px] resize-none text-[13px]"
            />
          </div>
        </div>
      </section>

      <footer className="shrink-0 border-t border-border/60 bg-background px-4 py-3">
        <div className="mx-auto flex max-w-[620px] items-center gap-3">
          <Button className="flex-1" onClick={save} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan profil"}
          </Button>
          {justSaved && (
            <span className="flex shrink-0 items-center gap-1 text-[12px] text-success">
              <Check size={13} /> Tersimpan
            </span>
          )}
        </div>
      </footer>
    </main>
  );
}
