"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import type { GuidedDemoSlide } from "@/lib/demo-guidata";

interface GuidedDemoSlidesProps {
  slides: GuidedDemoSlide[];
}

function badgeVariant(label: string): "default" | "success" | "warning" | "danger" {
  if (label === "AI") {
    return "success";
  }

  if (label === "Art. 47" || label === "Audit") {
    return "danger";
  }

  if (label === "PEC" || label === "GIS" || label === "Business plan") {
    return "warning";
  }

  return "default";
}

export function GuidedDemoSlides({ slides }: GuidedDemoSlidesProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isAutoNarrationEnabled, setIsAutoNarrationEnabled] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const nextSlideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNarrationRef = useRef(false);
  const hasUserStartedNarrationRef = useRef(false);

  const currentSlide = slides[currentIndex];
  const totalSlides = slides.length;

  const progress = useMemo(() => {
    if (totalSlides <= 1) {
      return 100;
    }

    return Math.round(((currentIndex + 1) / totalSlides) * 100);
  }, [currentIndex, totalSlides]);

  const buildNarrationText = useCallback((slide: GuidedDemoSlide): string => {
    if (slide.narrationScript && slide.narrationScript.trim().length > 0) {
      return slide.narrationScript;
    }

    return [
      slide.title,
      slide.body,
      slide.speakerNotes,
    ]
      .filter((value) => value.trim().length > 0)
      .join(" ");
  }, []);

  const stopNarration = useCallback(() => {
    if (nextSlideTimeoutRef.current) {
      clearTimeout(nextSlideTimeoutRef.current);
      nextSlideTimeoutRef.current = null;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  const speakCurrentSlide = useCallback(() => {
    hasUserStartedNarrationRef.current = true;

    if (!speechSupported || typeof window === "undefined" || !("speechSynthesis" in window)) {
      setIsSpeaking(false);
      setIsPaused(false);
      return;
    }

    const speech = window.speechSynthesis;
    speech.cancel();

    const utterance = new SpeechSynthesisUtterance(buildNarrationText(currentSlide));
    utterance.lang = "it-IT";
    utterance.rate = 0.95;
    utterance.pitch = 1;

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
    };

    utterance.onpause = () => {
      setIsPaused(true);
      setIsSpeaking(false);
    };

    utterance.onresume = () => {
      setIsPaused(false);
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;

      if (autoNarrationRef.current && currentIndex < totalSlides - 1) {
        nextSlideTimeoutRef.current = setTimeout(() => {
          setCurrentIndex((value) => Math.min(totalSlides - 1, value + 1));
        }, 550);
      }
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
    };

    utteranceRef.current = utterance;
    speech.speak(utterance);
  }, [buildNarrationText, currentIndex, currentSlide, selectedVoice, speechSupported, totalSlides]);

  const pauseNarration = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.pause();
    setIsPaused(true);
    setIsSpeaking(false);
  }, []);

  const resumeNarration = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const speech = window.speechSynthesis;
    if (speech.paused) {
      speech.resume();
      setIsPaused(false);
      setIsSpeaking(true);
      return;
    }

    if (!isSpeaking) {
      speakCurrentSlide();
    }
  }, [isSpeaking, speakCurrentSlide]);

  useEffect(() => {
    autoNarrationRef.current = isAutoNarrationEnabled;
  }, [isAutoNarrationEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isSupported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    setSpeechSupported(isSupported);

    if (!isSupported) {
      return;
    }

    const speech = window.speechSynthesis;

    const chooseVoice = () => {
      const voices = speech.getVoices();
      if (!voices || voices.length === 0) {
        return;
      }

      const italian = voices.find((voice) => voice.lang.toLowerCase().startsWith("it"));
      setSelectedVoice(italian ?? voices[0] ?? null);
    };

    chooseVoice();
    speech.addEventListener("voiceschanged", chooseVoice);

    return () => {
      speech.removeEventListener("voiceschanged", chooseVoice);
    };
  }, []);

  useEffect(() => {
    if (!speechSupported) {
      return;
    }

    stopNarration();

    if (isAutoNarrationEnabled && hasUserStartedNarrationRef.current) {
      speakCurrentSlide();
    }
  }, [currentIndex, isAutoNarrationEnabled, speakCurrentSlide, speechSupported, stopNarration]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      if (nextSlideTimeoutRef.current) {
        clearTimeout(nextSlideTimeoutRef.current);
      }
    };
  }, []);

  const voiceStatusLabel = useMemo(() => {
    if (!speechSupported) {
      return "Narrazione non supportata da questo browser";
    }

    if (isPaused) {
      return "Voce in pausa";
    }

    if (isSpeaking) {
      return "Spiegazione AI in corso";
    }

    return "Voce AI pronta";
  }, [isPaused, isSpeaking, speechSupported]);

  return (
    <div className="mx-auto flex w-full max-w-[1260px] flex-col gap-5" data-testid="guided-demo-root">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(120deg,#0f172a_0%,#1e293b_45%,#334155_100%)] p-6 text-slate-100 shadow-sm">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-sky-300/10 blur-2xl" />
        <div className="absolute -bottom-20 -left-14 h-64 w-64 rounded-full bg-emerald-300/10 blur-2xl" />

        <div className="relative z-10 flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-300">Demo guidata istituzionale</p>
          <h2 className="text-3xl font-semibold leading-tight">Demo guidata AI</h2>
          <p className="max-w-4xl text-sm text-slate-200">
            Una presentazione interattiva per raccontare la piattaforma come strumento intelligente di governo istruttorio delle concessioni portuali.
          </p>
          <p className="max-w-4xl text-sm text-slate-200">
            Non è un gestionale. È una piattaforma intelligente di governo istruttorio delle concessioni portuali.
          </p>
        </div>
      </section>

      <Card className="overflow-hidden border-slate-200 shadow-sm" data-testid="guided-demo-slide-card">
        <CardHeader className="border-b border-slate-200 bg-slate-50">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Slide {currentSlide.id} di {totalSlides}
            </span>
            <span className="text-xs font-semibold text-slate-600">{progress}% completato</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
              data-testid="guided-demo-progress"
            />
          </div>
          <CardTitle className="mt-3 text-2xl text-slate-900" data-testid="guided-demo-current-title">
            {currentSlide.title}
          </CardTitle>
          {currentSlide.subtitle ? <CardDescription className="text-base text-slate-700">{currentSlide.subtitle}</CardDescription> : null}
        </CardHeader>

        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="space-y-4">
            <p className="text-base leading-7 text-slate-800" data-testid="guided-demo-current-body">
              {currentSlide.body}
            </p>

            {currentSlide.bullets && currentSlide.bullets.length > 0 ? (
              <ul className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                {currentSlide.bullets.map((bullet) => (
                  <li key={`${currentSlide.id}-${bullet}`} className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {currentSlide.badges && currentSlide.badges.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {currentSlide.badges.map((item) => (
                  <Badge key={`${currentSlide.id}-${item}`} variant={badgeVariant(item)}>
                    {item}
                  </Badge>
                ))}
              </div>
            ) : null}

            {currentSlide.actionHref && currentSlide.actionLabel ? (
              <div>
                <Link
                  href={currentSlide.actionHref}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-100"
                  data-testid="guided-demo-action-link"
                >
                  {currentSlide.actionLabel}
                </Link>
              </div>
            ) : null}
          </div>

          <aside className="rounded-xl border border-sky-200 bg-sky-50 p-4" data-testid="guided-demo-speaker-notes">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Speaker notes AI</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{currentSlide.speakerNotes}</p>
          </aside>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm" data-testid="guided-demo-voice-section">
        <CardHeader>
          <CardTitle className="text-lg">Voce AI</CardTitle>
          <CardDescription>
            La voce usa la sintesi vocale del browser, ma il testo è un copione di spiegazione AI, non una semplice lettura della slide.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Badge variant="success" className="w-fit" data-testid="guided-demo-narrator-mode">
            Modalità relatore AI
          </Badge>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={speakCurrentSlide}
              aria-label="Spiega la slide corrente"
              data-testid="guided-demo-voice-read"
            >
              Spiega slide
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={pauseNarration}
              aria-label="Metti in pausa la narrazione"
              data-testid="guided-demo-voice-pause"
            >
              Pausa
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={resumeNarration}
              aria-label="Riprendi la narrazione"
              data-testid="guided-demo-voice-resume"
            >
              Riprendi
            </Button>
            <Button
              type="button"
              onClick={stopNarration}
              aria-label="Ferma la narrazione"
              data-testid="guided-demo-voice-stop"
            >
              Ferma
            </Button>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700" htmlFor="guided-demo-auto-narration-toggle">
            <input
              id="guided-demo-auto-narration-toggle"
              type="checkbox"
              checked={isAutoNarrationEnabled}
              onChange={(event) => setIsAutoNarrationEnabled(event.target.checked)}
              aria-label="Attiva o disattiva la narrazione automatica"
              data-testid="guided-demo-voice-auto-toggle"
            />
            Narrazione automatica
          </label>

          <p className="text-sm font-medium text-slate-700" data-testid="guided-demo-voice-status">
            {voiceStatusLabel}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))}
            disabled={currentIndex === 0}
            data-testid="guided-demo-prev"
          >
            Indietro
          </Button>
          <Button
            type="button"
            onClick={() => setCurrentIndex((value) => Math.min(totalSlides - 1, value + 1))}
            disabled={currentIndex === totalSlides - 1}
            data-testid="guided-demo-next"
          >
            Avanti
          </Button>
        </div>
        <p className="text-sm text-slate-600" data-testid="guided-demo-slide-indicator">
          Slide corrente: {currentSlide.id}/{totalSlides}
        </p>
      </div>
    </div>
  );
}
