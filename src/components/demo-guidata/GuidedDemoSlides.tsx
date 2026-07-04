"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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

  const currentSlide = slides[currentIndex];
  const totalSlides = slides.length;

  const progress = useMemo(() => {
    if (totalSlides <= 1) {
      return 100;
    }

    return Math.round(((currentIndex + 1) / totalSlides) * 100);
  }, [currentIndex, totalSlides]);

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
