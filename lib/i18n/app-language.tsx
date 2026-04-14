"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppLanguage = "en" | "es";

type AppLanguageContextValue = {
  language: AppLanguage;
  locale: string;
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
};

const STORAGE_KEY = "metric-planitar-language";

const AppLanguageContext = createContext<AppLanguageContextValue | null>(null);

export function AppLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    if (typeof window === "undefined") return "en";
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "es") {
        return saved;
      }
    } catch {}
    return "en";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {}

    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  const value = useMemo<AppLanguageContextValue>(
    () => ({
      language,
      locale: language === "es" ? "es-CO" : "en-US",
      setLanguage: setLanguageState,
      toggleLanguage: () => setLanguageState((current) => (current === "en" ? "es" : "en")),
    }),
    [language]
  );

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (!context) {
    throw new Error("useAppLanguage must be used within AppLanguageProvider");
  }
  return context;
}

export function pickLanguage<T>(language: AppLanguage, english: T, spanish: T) {
  return language === "es" ? spanish : english;
}
