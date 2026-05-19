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
  { code: "an", name: "Aragonese", nativeName: "Aragonés" },
  { code: "hy", name: "Armenian", nativeName: "Հայերեն" },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া" },
  { code: "av", name: "Avaric", nativeName: "Авар мацӀ" },
  { code: "ae", name: "Avestan", nativeName: "Avesta" },
  { code: "ay", name: "Aymara", nativeName: "Aymar aru" },
  { code: "az", name: "Azerbaijani", nativeName: "Azərbaycan dili" },
  { code: "bm", name: "Bambara", nativeName: "Bamanankan" },
  { code: "ba", name: "Bashkir", nativeName: "Башҡорт теле" },
  { code: "eu", name: "Basque", nativeName: "Euskara" },
  { code: "be", name: "Belarusian", nativeName: "Беларуская" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "bh", name: "Bihari", nativeName: "भोजपुरी" },
  { code: "bi", name: "Bislama", nativeName: "Bislama" },
  { code: "bs", name: "Bosnian", nativeName: "Bosanski" },
  { code: "br", name: "Breton", nativeName: "Brezhoneg" },
  { code: "bg", name: "Bulgarian", nativeName: "Български" },
  { code: "my", name: "Burmese", nativeName: "ဗမာစာ" },
  { code: "ca", name: "Catalan", nativeName: "Català" },
  { code: "ch", name: "Chamorro", nativeName: "Chamoru" },
  { code: "ce", name: "Chechen", nativeName: "Нохчийн мотт" },
  { code: "ny", name: "Chichewa", nativeName: "ChiCheŵa" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "cu", name: "Church Slavic", nativeName: "словѣньскъ" },
  { code: "cv", name: "Chuvash", nativeName: "Чӑваш чӗлхи" },
  { code: "kw", name: "Cornish", nativeName: "Kernewek" },
  { code: "co", name: "Corsican", nativeName: "Corsu" },
  { code: "cr", name: "Cree", nativeName: "ᓀᐦᐃᔭᐍᐏᐣ" },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "dv", name: "Divehi", nativeName: "ދިވެހި" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "dz", name: "Dzongkha", nativeName: "ཇོང་ཁ" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "eo", name: "Esperanto", nativeName: "Esperanto" },
  { code: "et", name: "Estonian", nativeName: "Eesti" },
  { code: "ee", name: "Ewe", nativeName: "Eʋegbe" },
  { code: "fo", name: "Faroese", nativeName: "Føroyskt" },
  { code: "fj", name: "Fijian", nativeName: "Na Vosa Vakaviti" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "fy", name: "Western Frisian", nativeName: "Frysk" },
  { code: "ff", name: "Fulah", nativeName: "Fulfulde" },
  { code: "gd", name: "Scottish Gaelic", nativeName: "Gàidhlig" },
  { code: "gl", name: "Galician", nativeName: "Galego" },
  { code: "lg", name: "Ganda", nativeName: "Luganda" },
  { code: "ka", name: "Georgian", nativeName: "ქართული" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  { code: "kl", name: "Greenlandic", nativeName: "Kalaallisut" },
  { code: "gn", name: "Guarani", nativeName: "Avañe'ẽ" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "ht", name: "Haitian Creole", nativeName: "Kreyòl Ayisyen" },
  { code: "ha", name: "Hausa", nativeName: "Hausa" },
  { code: "he", name: "Hebrew", nativeName: "עברית" },
  { code: "hz", name: "Herero", nativeName: "Otjiherero" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "ho", name: "Hiri Motu", nativeName: "Hiri Motu" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "is", name: "Icelandic", nativeName: "Íslenska" },
  { code: "io", name: "Ido", nativeName: "Ido" },
  { code: "ig", name: "Igbo", nativeName: "Igbo" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ia", name: "Interlingua", nativeName: "Interlingua" },
  { code: "ie", name: "Interlingue", nativeName: "Occidental" },
  { code: "iu", name: "Inuktitut", nativeName: "ᐃᓄᒃᑎᑐᑦ" },
  { code: "ik", name: "Inupiaq", nativeName: "Iñupiaq" },
  { code: "ga", name: "Irish", nativeName: "Gaeilge" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "jv", name: "Javanese", nativeName: "Basa Jawa" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "kr", name: "Kanuri", nativeName: "Kanuri" },
  { code: "ks", name: "Kashmiri", nativeName: "कश्मीरी" },
  { code: "kk", name: "Kazakh", nativeName: "Қазақ тілі" },
  { code: "km", name: "Central Khmer", nativeName: "ភាសាខ្មែរ" },
  { code: "ki", name: "Kikuyu", nativeName: "Gĩkũyũ" },
  { code: "rw", name: "Kinyarwanda", nativeName: "Ikinyarwanda" },
  { code: "ky", name: "Kirghiz", nativeName: "Кыргызча" },
  { code: "kv", name: "Komi", nativeName: "Коми кыв" },
  { code: "kg", name: "Kongo", nativeName: "Kikongo" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "kj", name: "Kuanyama", nativeName: "Kuanyama" },
  { code: "ku", name: "Kurdish", nativeName: "Kurdî" },
  { code: "lo", name: "Lao", nativeName: "ລາວ" },
  { code: "la", name: "Latin", nativeName: "Latine" },
  { code: "lv", name: "Latvian", nativeName: "Latviešu" },
  { code: "li", name: "Limburgan", nativeName: "Limburgs" },
  { code: "ln", name: "Lingala", nativeName: "Lingála" },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių" },
  { code: "lu", name: "Luba-Katanga", nativeName: "Tshiluba" },
  { code: "lb", name: "Luxembourgish", nativeName: "Lëtzebuergesch" },
  { code: "mk", name: "Macedonian", nativeName: "Македонски" },
  { code: "mg", name: "Malagasy", nativeName: "Malagasy" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം" },
  { code: "mt", name: "Maltese", nativeName: "Malti" },
  { code: "gv", name: "Manx", nativeName: "Gaelg" },
  { code: "mi", name: "Maori", nativeName: "Te Reo Māori" },
  { code: "mr", name: "Marathi", nativeName: "मराठी" },
  { code: "mh", name: "Marshallese", nativeName: "Kajin M̧ajeļ" },
  { code: "mn", name: "Mongolian", nativeName: "Монгол" },
  { code: "na", name: "Nauru", nativeName: "Dorerin Naoero" },
  { code: "nv", name: "Navajo", nativeName: "Diné Bizaad" },
  { code: "ng", name: "Ndonga", nativeName: "Owambo" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली" },
  { code: "nd", name: "North Ndebele", nativeName: "IsiNdebele" },
  { code: "se", name: "Northern Sami", nativeName: "Sámegiella" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "nb", name: "Norwegian Bokmål", nativeName: "Norsk Bokmål" },
  { code: "nn", name: "Norwegian Nynorsk", nativeName: "Nynorsk" },
  { code: "oc", name: "Occitan", nativeName: "Occitan" },
  { code: "oj", name: "Ojibwa", nativeName: "ᐊᓂᔑᓈᐯᒧᐎᓐ" },
  { code: "or", name: "Oriya", nativeName: "ଓଡ଼ିଆ" },
  { code: "om", name: "Oromo", nativeName: "Afaan Oromoo" },
  { code: "os", name: "Ossetian", nativeName: "Ирон" },
  { code: "pi", name: "Pali", nativeName: "पालि" },
  { code: "pa", name: "Panjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "ps", name: "Pashto", nativeName: "پښتو" },
  { code: "fa", name: "Persian", nativeName: "فارسی" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "qu", name: "Quechua", nativeName: "Runa Simi" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "rm", name: "Romansh", nativeName: "Rumantsch" },
  { code: "rn", name: "Rundi", nativeName: "Kirundi" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "sm", name: "Samoan", nativeName: "Gagana Samoa" },
  { code: "sg", name: "Sango", nativeName: "Sängö" },
  { code: "sa", name: "Sanskrit", nativeName: "संस्कृतम्" },
  { code: "sc", name: "Sardinian", nativeName: "Sardu" },
  { code: "sr", name: "Serbian", nativeName: "Српски" },
  { code: "sn", name: "Shona", nativeName: "ChiShona" },
  { code: "sd", name: "Sindhi", nativeName: "सिन्धी" },
  { code: "si", name: "Sinhala", nativeName: "සිංහල" },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina" },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina" },
  { code: "so", name: "Somali", nativeName: "Soomaali" },
  { code: "st", name: "Southern Sotho", nativeName: "Sesotho" },
  { code: "nr", name: "South Ndebele", nativeName: "IsiNdebele" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "su", name: "Sundanese", nativeName: "Basa Sunda" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili" },
  { code: "ss", name: "Swati", nativeName: "SiSwati" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "tl", name: "Tagalog", nativeName: "Tagalog" },
  { code: "ty", name: "Tahitian", nativeName: "Reo Tahiti" },
  { code: "tg", name: "Tajik", nativeName: "Тоҷикӣ" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "tt", name: "Tatar", nativeName: "Татар теле" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "bo", name: "Tibetan", nativeName: "བོད་སྐད" },
  { code: "ti", name: "Tigrinya", nativeName: "ትግርኛ" },
  { code: "to", name: "Tonga", nativeName: "Lea Faka-Tonga" },
  { code: "ts", name: "Tsonga", nativeName: "Xitsonga" },
  { code: "tn", name: "Tswana", nativeName: "Setswana" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "tk", name: "Turkmen", nativeName: "Türkmen" },
  { code: "tw", name: "Twi", nativeName: "Twi" },
  { code: "ug", name: "Uighur", nativeName: "ئۇيغۇرچە" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
  { code: "uz", name: "Uzbek", nativeName: "O'zbek" },
  { code: "ve", name: "Venda", nativeName: "Tshivenḓa" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "vo", name: "Volapük", nativeName: "Volapük" },
  { code: "wa", name: "Walloon", nativeName: "Walon" },
  { code: "cy", name: "Welsh", nativeName: "Cymraeg" },
  { code: "wo", name: "Wolof", nativeName: "Wollof" },
  { code: "xh", name: "Xhosa", nativeName: "IsiXhosa" },
  { code: "yi", name: "Yiddish", nativeName: "ייִדיש" },
  { code: "yo", name: "Yoruba", nativeName: "Yorùbá" },
  { code: "za", name: "Zhuang", nativeName: "Saɯ cueŋƅ" },
  { code: "zu", name: "Zulu", nativeName: "IsiZulu" },
];

type TranslationDict = Record<string, string>;
type TranslationRegistry = Record<string, TranslationDict>;

import en from "./translations/en";

const registry: TranslationRegistry = { en };

interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const TranslationContext = createContext<TranslationContextType>({
  language: LANGUAGES.find(l => l.code === "en")!,
  setLanguage: () => {},
  t: () => "",
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

  const [dict, setDict] = useState<TranslationDict>(en);

  useEffect(() => {
    localStorage.setItem("app_language", JSON.stringify({ code: language.code }));
    if (language.code === "en") {
      setDict(en);
    } else if (registry[language.code]) {
      setDict(registry[language.code]);
    } else {
      import(`./translations/${language.code}.ts`).then(mod => {
        registry[language.code] = mod.default;
        setDict(mod.default);
      }).catch(() => {
        setDict(en);
      });
    }
  }, [language]);

  const t = useCallback((key: string) => {
    return dict[key] ?? key;
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
