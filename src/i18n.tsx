import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const LANGUAGES: Language[] = [
  { code: "ab", name: "Abkhazian", nativeName: "Аҧсуа" },
  { code: "aa", name: "Afar", nativeName: "Afaraf" },
  { code: "af", name: "Afrikaans", nativeName: "Afrikaans" },
  { code: "ak", name: "Akan", nativeName: "Akan" },
  { code: "sq", name: "Albanian", nativeName: "Shqip" },
  { code: "am", name: "Amharic", nativeName: "አማርኛ" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "hy", name: "Armenian", nativeName: "Հայերեն" },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া" },
  { code: "ay", name: "Aymara", nativeName: "Aymar aru" },
  { code: "az", name: "Azerbaijani", nativeName: "Azərbaycan dili" },
  { code: "bm", name: "Bambara", nativeName: "Bamanankan" },
  { code: "eu", name: "Basque", nativeName: "Euskara" },
  { code: "be", name: "Belarusian", nativeName: "Беларуская" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "bs", name: "Bosnian", nativeName: "Bosanski" },
  { code: "bg", name: "Bulgarian", nativeName: "Български" },
  { code: "my", name: "Burmese", nativeName: "ဗမာစာ" },
  { code: "ca", name: "Catalan", nativeName: "Català" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "co", name: "Corsican", nativeName: "Corsu" },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "et", name: "Estonian", nativeName: "Eesti" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "gl", name: "Galician", nativeName: "Galego" },
  { code: "ka", name: "Georgian", nativeName: "ქართული" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "ht", name: "Haitian Creole", nativeName: "Kreyòl Ayisyen" },
  { code: "ha", name: "Hausa", nativeName: "Hausa" },
  { code: "he", name: "Hebrew", nativeName: "עברית" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "is", name: "Icelandic", nativeName: "Íslenska" },
  { code: "ig", name: "Igbo", nativeName: "Igbo" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ga", name: "Irish", nativeName: "Gaeilge" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "jv", name: "Javanese", nativeName: "Basa Jawa" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "kk", name: "Kazakh", nativeName: "Қазақ тілі" },
  { code: "km", name: "Central Khmer", nativeName: "ភាសាខ្មែរ" },
  { code: "rw", name: "Kinyarwanda", nativeName: "Ikinyarwanda" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "ku", name: "Kurdish", nativeName: "Kurdî" },
  { code: "ky", name: "Kirghiz", nativeName: "Кыргызча" },
  { code: "lo", name: "Lao", nativeName: "ລາວ" },
  { code: "la", name: "Latin", nativeName: "Latine" },
  { code: "lv", name: "Latvian", nativeName: "Latviešu" },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių" },
  { code: "lb", name: "Luxembourgish", nativeName: "Lëtzebuergesch" },
  { code: "mk", name: "Macedonian", nativeName: "Македонски" },
  { code: "mg", name: "Malagasy", nativeName: "Malagasy" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം" },
  { code: "mt", name: "Maltese", nativeName: "Malti" },
  { code: "mi", name: "Maori", nativeName: "Te Reo Māori" },
  { code: "mr", name: "Marathi", nativeName: "मराठी" },
  { code: "mn", name: "Mongolian", nativeName: "Монгол" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "ps", name: "Pashto", nativeName: "پښتو" },
  { code: "fa", name: "Persian", nativeName: "فارسی" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "pa", name: "Panjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "sm", name: "Samoan", nativeName: "Gagana Samoa" },
  { code: "sr", name: "Serbian", nativeName: "Српски" },
  { code: "sn", name: "Shona", nativeName: "ChiShona" },
  { code: "sd", name: "Sindhi", nativeName: "सिन्धी" },
  { code: "si", name: "Sinhala", nativeName: "සිංහල" },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina" },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina" },
  { code: "so", name: "Somali", nativeName: "Soomaali" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "tl", name: "Tagalog", nativeName: "Tagalog" },
  { code: "tg", name: "Tajik", nativeName: "Тоҷикӣ" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "tt", name: "Tatar", nativeName: "Татар теле" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "bo", name: "Tibetan", nativeName: "བོད་སྐད" },
  { code: "ti", name: "Tigrinya", nativeName: "ትግርኛ" },
  { code: "ts", name: "Tsonga", nativeName: "Xitsonga" },
  { code: "tn", name: "Tswana", nativeName: "Setswana" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "tk", name: "Turkmen", nativeName: "Türkmen" },
  { code: "ug", name: "Uighur", nativeName: "ئۇيغۇرچە" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
  { code: "uz", name: "Uzbek", nativeName: "O'zbek" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "cy", name: "Welsh", nativeName: "Cymraeg" },
  { code: "xh", name: "Xhosa", nativeName: "IsiXhosa" },
  { code: "yi", name: "Yiddish", nativeName: "ייִדיש" },
  { code: "yo", name: "Yoruba", nativeName: "Yorùbá" },
  { code: "zu", name: "Zulu", nativeName: "IsiZulu" },
];

interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, fallback?: string) => string;
}

const TranslationContext = createContext<TranslationContextType>({
  language: LANGUAGES.find(l => l.code === "en")!,
  setLanguage: () => {},
  t: (_key: string, fallback?: string) => fallback ?? _key,
});

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem("app_language");
      if (stored) {
        const parsed = JSON.parse(stored);
        const found = LANGUAGES.find(l => l.code === parsed.code);
        if (found) return found;
      }
    } catch {}
    return LANGUAGES.find(l => l.code === "en")!;
  });

  const [dict, setDict] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    localStorage.setItem("app_language", JSON.stringify({ code: language.code }));
    if (language.code !== "en") {
      import(`./translations/${language.code}.ts`).then(mod => {
        setDict(mod.default);
      }).catch(() => {
        setDict(null);
      });
    } else {
      setDict(null);
    }
  }, [language]);

  const t = useCallback((key: string, fallback?: string) => {
    return dict?.[key] ?? fallback ?? key;
  }, [dict]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  return (
    <TranslationContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  return useContext(TranslationContext);
}
