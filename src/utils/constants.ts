import type { MetricColor, FiveAccountSettings, Section } from "../types";

export const MS: Record<MetricColor, { bg: string; text: string }> = {
  green:  { bg: "#4CAF7D", text: "#fff" },
  yellow: { bg: "#F5A623", text: "#fff" },
  red:    { bg: "#E85D75", text: "#fff" },
  gray:   { bg: "#E8EDF2", text: "#4A5568" },
};

export const FIVE_DESC: Record<string, string> = {
  overhead:    "2 months of operating expenses (incl. owner salary). Surplus flows downstream.",
  profit:      "Builds to a 6-month emergency fund. Once reached, surplus shifts to Investments.",
  tax:         "50% of every surplus inflow — always. Accumulates until a tax bill is paid.",
  investments: "Receives 50% of surplus once Profit emergency fund is fully funded.",
  owner:       "Monthly salary baked into Overhead target. Auto-set from Five-Account settings.",
};

export const FIVE_EQUATION_POINTS = [
  "1. Overhead funded first (2 mo. expenses incl. owner salary). Surplus flows down.",
  "2. 50% of every surplus → Tax, always. Accumulates until paid.",
  "3. Pre-emergency fund: remaining 50% → Profit.",
  "4. Post-emergency fund (6 mo. reached): remaining 50% → Investments.",
  "5. Owner = monthly salary baked into Overhead. Auto-updated from settings.",
  "6. Any surplus after a tax bill is paid → Profit (if <6mo) or Investments.",
];

export const FIVE_ACCOUNT_LABELS = ["Overhead", "Profit", "Tax", "Investments", "Owner"] as const;

export const FIVE_ACCOUNT_ICONS: Record<string, string> = {
  Overhead: "CreditCard", Profit: "TrendUp", Tax: "Receipt",
  Investments: "Wallet", Owner: "UserCircle",
};

export const DEFAULT_FIVE_ACCOUNT_SETTINGS: FiveAccountSettings = {
  mode: "business-and-personal",
  monthlyExpenses: 0,
  ownerSalary: 0,
  postTransactionEnabled: true,
};

export const WORLD_CURRENCIES = [
  { symbol: "$", name: "US Dollar" }, { symbol: "€", name: "Euro" },
  { symbol: "£", name: "British Pound" }, { symbol: "¥", name: "Japanese Yen" },
  { symbol: "₹", name: "Indian Rupee" }, { symbol: "C$", name: "Canadian Dollar" },
  { symbol: "A$", name: "Australian Dollar" }, { symbol: "CHF", name: "Swiss Franc" },
  { symbol: "₩", name: "Korean Won" }, { symbol: "R$", name: "Brazilian Real" },
  { symbol: "MX$", name: "Mexican Peso" }, { symbol: "S$", name: "Singapore Dollar" },
  { symbol: "HK$", name: "Hong Kong Dollar" }, { symbol: "kr", name: "Swedish Krona" },
  { symbol: "NOK", name: "Norwegian Krone" }, { symbol: "DKK", name: "Danish Krone" },
  { symbol: "PLN", name: "Polish Zloty" }, { symbol: "CZK", name: "Czech Koruna" },
  { symbol: "₺", name: "Turkish Lira" }, { symbol: "₽", name: "Russian Ruble" },
  { symbol: "R", name: "South African Rand" }, { symbol: "AED", name: "UAE Dirham" },
  { symbol: "SAR", name: "Saudi Riyal" }, { symbol: "฿", name: "Thai Baht" },
  { symbol: "₫", name: "Vietnamese Dong" }, { symbol: "₦", name: "Nigerian Naira" },
  { symbol: "KES", name: "Kenyan Shilling" }, { symbol: "EGP", name: "Egyptian Pound" },
  { symbol: "ARS", name: "Argentine Peso" }, { symbol: "CLP", name: "Chilean Peso" },
];

export const ICON_NONE = "";

export const PHOSPHOR_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: "Finance",
    icons: [
      "CreditCard","Wallet","Money","Coins","Bank","Receipt","Invoice","Cardholder",
      "CurrencyDollar","CurrencyEur","CurrencyGbp","CurrencyJpy","CurrencyKrw","CurrencyInr","CurrencyBtc",
      "PiggyBank","Vault","HandCoins","HandDeposit","HandWithdraw",
      "TrendUp","TrendDown","ChartLine","ChartBar","ChartPie","ChartDonut","Percent",
      "Calculator","Briefcase","Buildings","ShoppingCart","ShoppingBag","Storefront","Tag","Barcode",
    ]
  },
  {
    label: "Business",
    icons: [
      "Handshake","UsersThree","UserCircle","IdentificationCard","Suitcase","SuitcaseRolling",
      "Target","Trophy","Medal","MedalMilitary","Star","StarFour","Crown","CrownSimple","Rocket","Lightbulb",
      "Clipboard","ClipboardText","Files","FolderOpen","Folder","Archive","Bookmarks","BookmarkSimple",
      "Table","Rows","Columns","SquaresFour","GridFour","ListBullets","ListChecks","ListNumbers",
      "Notebook","Notepad","FileText","FilePdf","FileDoc","FileXls",
    ]
  },
  {
    label: "Communication",
    icons: [
      "Envelope","EnvelopeOpen","EnvelopeSimple","Phone","PhoneCall","PhoneIncoming","PhoneOutgoing",
      "ChatCircle","ChatCircleDots","ChatText","ChatTeardrop","Chats","ChatsCircle",
      "Megaphone","MegaphoneSimple","Bell","BellRinging","BellSimple","Broadcast","Rss","Share","ShareNetwork",
      "PaperPlaneTilt","At","Hash","Link","LinkSimple","Globe","GlobeHemisphereWest","GlobeHemisphereEast",
    ]
  },
  {
    label: "Analytics",
    icons: [
      "ChartLineUp","ChartLineDown","ChartDonut","ChartBarHorizontal","ChartScatter","ChartPolar",
      "ArrowUp","ArrowDown","ArrowRight","ArrowLeft","ArrowUUpRight","ArrowUUpLeft","ArrowsOut","ArrowsIn",
      "ArrowsClockwise","ArrowsCounterClockwise","ArrowsLeftRight","ArrowsDownUp","Pulse","Gauge",
      "Database","HardDrive","HardDrives","Cloud","CloudArrowUp","CloudArrowDown","CloudCheck","CloudX",
      "MagnifyingGlass","MagnifyingGlassPlus","MagnifyingGlassMinus","Funnel","FunnelSimple","SortAscending","SortDescending",
    ]
  },
  {
    label: "Status",
    icons: [
      "CheckCircle","XCircle","WarningCircle","Warning","Info","Question",
      "Check","CheckFat","CheckSquare","X","XSquare","Plus","PlusCircle","Minus","MinusCircle",
      "Lock","LockOpen","LockKey","Key","KeyReturn","Shield","ShieldCheck","ShieldWarning",
      "Fire","FireSimple","Snowflake","Lightning","LightningSlash","Timer","Clock","ClockCountdown","Calendar","CalendarBlank","CalendarCheck","Alarm",
    ]
  },
  {
    label: "People",
    icons: [
      "User","UserPlus","UserMinus","UserCheck","UserCircle","UserCirclePlus","UserCircleMinus","UserList","UserFocus",
      "Users","UsersFour","UsersThree","PersonSimple","PersonSimpleRun","PersonSimpleWalk","PersonArmsSpread",
      "Smiley","SmileyMeh","SmileySad","SmileyWink","SmileyAngry","SmileyNervous","SmileyXEyes",
      "Heart","HeartStraight","HandHeart","Heartbeat","FirstAid","FirstAidKit","Stethoscope","Pill",
      "Student","GraduationCap","Certificate","Scales","Gavel",
    ]
  },
  {
    label: "Tools",
    icons: [
      "Gear","GearSix","GearFine","Wrench","Hammer","Screwdriver","Nut","Toolbox",
      "Code","CodeSimple","CodeBlock","Terminal","TerminalWindow","Desktop","Laptop","DeviceMobile","DeviceTablet","Monitor","Printer",
      "Camera","CameraPlus","Image","ImageSquare","ImagesSquare","PencilSimple","PencilLine","Pen","PenNib","Eraser","Trash","TrashSimple","Copy","CopySimple",
      "MagicWand","PaintBrush","PaintBrushBroad","PaintBucket","Palette","Eyedropper",
    ]
  },
  {
    label: "Nature",
    icons: [
      "Sun","SunDim","SunHorizon","Moon","MoonStars","CloudSun","CloudMoon","CloudRain","CloudSnow","CloudLightning","CloudFog","Rainbow","RainbowCloud",
      "Tree","TreePalm","TreeEvergreen","Plant","Flower","FlowerLotus","FlowerTulip","Leaf","Cactus","Mountains","Waves","Drop","DropHalf","Fish","Bird","Butterfly","Dog","Cat","Cow","Horse","Rabbit",
    ]
  },
  {
    label: "Transit",
    icons: [
      "Car","CarSimple","CarProfile","Taxi","Truck","Van","Motorcycle","Bicycle","Scooter",
      "Bus","Train","TrainSimple","TrainRegional","Tram","Airplane","AirplaneTakeoff","AirplaneLanding","Rocket","Boat","Sailboat","RocketLaunch",
      "MapPin","MapTrifold","NavigationArrow","Compass","Path","MapTrifold","RoadHorizon","TrafficCone","TrafficSign","TrafficSignal",
    ]
  },
  {
    label: "Food",
    icons: [
      "ForkKnife","CookingPot","BowlFood","Bread","Coffee","Hamburger","Pizza","Popcorn","FishSimple",
      "BeerBottle","Wine","Knife","Cake","Cookie","OrangeSlice","Orange","IceCream","AppleLogo",
    ]
  },
  {
    label: "Health",
    icons: [
      "Hospital","Syringe","Thermometer","TestTube","Flask","Dna","MaskHappy","HandSoap",
      "HeartBreak","HeartHalf",
    ]
  },
];

export const ALL_PHOSPHOR_ICONS = PHOSPHOR_CATEGORIES.flatMap(c => c.icons);
export const DISPLAY_CATEGORIES = [{ label: "All", icons: ALL_PHOSPHOR_ICONS }, ...PHOSPHOR_CATEGORIES];

export const INIT_SECTIONS: Section[] = [];
