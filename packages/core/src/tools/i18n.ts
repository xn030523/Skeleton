type LangCatalog = Record<string, string | LangCatalog>;

const catalogs: Record<string, LangCatalog> = {
  en: {
    "tools.web_search.description": "Search the web for information",
    "tools.browser.description": "Automate browser actions",
    "tools.terminal.description": "Execute terminal commands",
    "tools.image_generate.description": "Generate images from text prompts",
    "tools.vision_analyze.description": "Analyze images with custom questions",
    "tools.clarify.description": "Ask clarifying questions",
    "tools.todo.description": "Manage task lists",
    "skills.category.ctf": "CTF & Security",
    "skills.category.general": "General",
    "skills.category.re": "Reverse Engineering",
    "skills.category.web": "Web",
    "skills.lifecycle.active": "Active",
    "skills.lifecycle.stale": "Stale",
    "skills.lifecycle.archived": "Archived",
    "skills.lifecycle.pinned": "Pinned",
    "errors.rate_limit": "Rate limit reached, retrying soon",
    "errors.auth_error": "Authentication failed",
    "errors.server_error": "Server error occurred",
    "errors.timeout": "Request timed out",
    "errors.context_overflow": "Context window exceeded",
    "errors.unknown": "Unknown error",
    "session.welcome": "Welcome! How can I help you?",
    "session.goodbye": "Goodbye! Session saved.",
    "session.resumed": "Session resumed.",
    "session.title_prompt": "Generate a title for this conversation",
    "cli.new_session": "New session",
    "cli.thinking": "Thinking...",
    "cli.goal_set": "Goal set",
    "cli.goal_complete": "Goal complete",
    "cli.skill_activated": "Skill activated",
    "cli.snapshot_created": "Snapshot created",
    "cli.branch_created": "Branch created",
    "cli.branch_resumed": "Branch resumed",
    "cli.plugin_loaded": "Plugin loaded",
  },
  zh: {
    "tools.web_search.description": "搜索网络信息",
    "tools.browser.description": "自动化浏览器操作",
    "tools.terminal.description": "执行终端命令",
    "tools.image_generate.description": "从文本生成图像",
    "tools.vision_analyze.description": "用自定义问题分析图像",
    "tools.clarify.description": "提出澄清问题",
    "tools.todo.description": "管理任务列表",
    "skills.category.ctf": "CTF 与安全",
    "skills.category.general": "通用",
    "skills.category.re": "逆向工程",
    "skills.category.web": "Web",
    "skills.lifecycle.active": "活跃",
    "skills.lifecycle.stale": "过时",
    "skills.lifecycle.archived": "已归档",
    "skills.lifecycle.pinned": "已固定",
    "errors.rate_limit": "速率限制，稍后重试",
    "errors.auth_error": "认证失败",
    "errors.server_error": "服务器错误",
    "errors.timeout": "请求超时",
    "errors.context_overflow": "上下文超出限制",
    "errors.unknown": "未知错误",
    "session.welcome": "欢迎！有什么可以帮您的？",
    "session.goodbye": "再见！会话已保存。",
    "session.resumed": "会话已恢复。",
    "session.title_prompt": "为此对话生成标题",
    "cli.new_session": "新会话",
    "cli.thinking": "思考中...",
    "cli.goal_set": "目标已设置",
    "cli.goal_complete": "目标已完成",
    "cli.skill_activated": "技能已激活",
    "cli.snapshot_created": "快照已创建",
    "cli.branch_created": "分支已创建",
    "cli.branch_resumed": "分支已恢复",
    "cli.plugin_loaded": "插件已加载",
  },
  ja: {
    "tools.web_search.description": "ウェブで情報を検索",
    "tools.browser.description": "ブラウザ操作を自動化",
    "tools.terminal.description": "ターミナルコマンドを実行",
    "tools.image_generate.description": "テキストから画像を生成",
    "tools.vision_analyze.description": "画像をカスタム質問で分析",
    "tools.clarify.description": "明確化の質問をする",
    "tools.todo.description": "タスクリストを管理",
    "skills.category.ctf": "CTF・セキュリティ",
    "skills.category.general": "一般",
    "skills.lifecycle.active": "アクティブ",
    "skills.lifecycle.archived": "アーカイブ済み",
    "skills.lifecycle.pinned": "ピン留め",
    "errors.rate_limit": "レート制限に達しました",
    "errors.auth_error": "認証に失敗しました",
    "errors.server_error": "サーバーエラーが発生しました",
    "errors.timeout": "リクエストがタイムアウトしました",
    "errors.unknown": "不明なエラー",
    "session.welcome": "ようこそ！何かお手伝いできますか？",
    "session.goodbye": "さようなら！セッションを保存しました。",
  },
  de: {
    "tools.web_search.description": "Im Web nach Informationen suchen",
    "tools.browser.description": "Browser-Aktionen automatisieren",
    "tools.terminal.description": "Terminal-Befehle ausfuehren",
    "tools.image_generate.description": "Bilder aus Text generieren",
    "tools.clarify.description": "Klaerungsfragen stellen",
    "skills.category.ctf": "CTF & Sicherheit",
    "skills.category.general": "Allgemein",
    "errors.rate_limit": "Ratenlimit erreicht, Versuch spaeter",
    "errors.auth_error": "Authentifizierung fehlgeschlagen",
    "errors.server_error": "Serverfehler aufgetreten",
    "errors.timeout": "Anfrage hat Zeit ueberschritten",
    "errors.unknown": "Unbekannter Fehler",
    "session.welcome": "Willkommen! Wie kann ich helfen?",
    "session.goodbye": "Auf Wiedersehen! Sitzung gespeichert.",
  },
  es: {
    "tools.web_search.description": "Buscar informacion en la web",
    "tools.browser.description": "Automatizar acciones del navegador",
    "tools.terminal.description": "Ejecutar comandos de terminal",
    "tools.image_generate.description": "Generar imagenes desde texto",
    "tools.clarify.description": "Hacer preguntas de aclaracion",
    "skills.category.ctf": "CTF y seguridad",
    "skills.category.general": "General",
    "errors.rate_limit": "Limite de tasa alcanzado",
    "errors.auth_error": "Error de autenticacion",
    "errors.server_error": "Error del servidor",
    "errors.timeout": "Tiempo de espera agotado",
    "errors.unknown": "Error desconocido",
    "session.welcome": "Bienvenido! Como puedo ayudarte?",
    "session.goodbye": "Adios! Sesion guardada.",
  },
  fr: {
    "tools.web_search.description": "Rechercher des informations sur le web",
    "tools.browser.description": "Automatiser les actions du navigateur",
    "tools.terminal.description": "Executer des commandes terminal",
    "tools.image_generate.description": "Generer des images a partir de texte",
    "tools.clarify.description": "Poser des questions de clarification",
    "skills.category.ctf": "CTF et securite",
    "skills.category.general": "General",
    "errors.rate_limit": "Limite de debit atteinte",
    "errors.auth_error": "Echec d'authentification",
    "errors.server_error": "Erreur de serveur",
    "errors.timeout": "Delai d'attente depasse",
    "errors.unknown": "Erreur inconnue",
    "session.welcome": "Bienvenue! Comment puis-je vous aider?",
    "session.goodbye": "Au revoir! Session sauvegardee.",
  },
  tr: {
    "tools.web_search.description": "Web'de bilgi ara",
    "tools.browser.description": "Tarayici islemlerini otomatiklestir",
    "tools.terminal.description": "Terminal komutlarini calistir",
    "tools.image_generate.description": "Metinden gorsel olustur",
    "tools.clarify.description": "Aciklama sorulari sor",
    "skills.category.ctf": "CTF ve guvenlik",
    "skills.category.general": "Genel",
    "errors.rate_limit": "Hiz sinirina ulasildi",
    "errors.auth_error": "Kimlik dogrulama basarisiz",
    "errors.server_error": "Sunucu hatasi olustu",
    "errors.timeout": "Istek zaman asimina ugradi",
    "errors.unknown": "Bilinmeyen hata",
    "session.welcome": "Hosgeldiniz! Nasil yardimci olabilirim?",
    "session.goodbye": "Gule gule! Oturum kaydedildi.",
  },
  uk: {
    "tools.web_search.description": "Shukaty informaciyu v interneti",
    "tools.browser.description": "Avtomatyzuvaty diyi brauzera",
    "tools.terminal.description": "Vykonaty terminalni komandy",
    "tools.image_generate.description": "Generuvaty zobrazhennya z tekstu",
    "tools.clarify.description": "Zadayte zapytnennya dlya yasnosti",
    "skills.category.ctf": "CTF ta bezpeka",
    "skills.category.general": "Zagalni",
    "errors.rate_limit": "Obmezennya chastoty, sproba piznishe",
    "errors.auth_error": "Pomylka autentykaciyi",
    "errors.server_error": "Pomylka servera",
    "errors.timeout": "Chas ochikuvannya vyycherpanyi",
    "errors.unknown": "Nevidoma pomylka",
    "session.welcome": "Lyaskavo prosymo! Chym mozhu dopomohty?",
    "session.goodbye": "Do pobachennya! Syansiyu zberezheno.",
    "cli.new_session": "Nova sesiya",
    "cli.thinking": "Dumayu...",
    "cli.goal_set": "Cil vstanovleno",
    "cli.goal_complete": "Cil vykonano",
  },
  ko: {
    "tools.web_search.description": "웹에서 정보 검색",
    "tools.browser.description": "브라우저 작업 자동화",
    "tools.terminal.description": "터미널 명령 실행",
    "tools.image_generate.description": "텍스트에서 이미지 생성",
    "tools.vision_analyze.description": "이미지를 사용자 정의 질문으로 분석",
    "tools.clarify.description": "명확화 질문하기",
    "tools.todo.description": "작업 목록 관리",
    "skills.category.ctf": "CTF 및 보안",
    "skills.category.general": "일반",
    "skills.category.re": "리버스 엔지니어링",
    "skills.category.web": "웹",
    "skills.lifecycle.active": "활성",
    "skills.lifecycle.stale": "오래됨",
    "skills.lifecycle.archived": "보관됨",
    "skills.lifecycle.pinned": "고정됨",
    "errors.rate_limit": "속도 제한, 잠시 후 재시도",
    "errors.auth_error": "인증 실패",
    "errors.server_error": "서버 오류 발생",
    "errors.timeout": "요청 시간 초과",
    "errors.context_overflow": "컨텍스트 한도 초과",
    "errors.unknown": "알 수 없는 오류",
    "session.welcome": "환영합니다! 무엇을 도와드릴까요?",
    "session.goodbye": "안녕히 가세요! 세션이 저장되었습니다.",
    "session.resumed": "세션이 복원되었습니다.",
    "session.title_prompt": "이 대화의 제목 생성",
    "cli.new_session": "새 세션",
    "cli.thinking": "생각 중...",
    "cli.goal_set": "목표 설정됨",
    "cli.goal_complete": "목표 달성",
  },
};

const SUPPORTED_LANGUAGES = Object.keys(catalogs);
let currentLanguage = "en";

function resolveDottedPath(catalog: LangCatalog, dottedKey: string): string | null {
  const parts = dottedKey.split(".");
  let current: LangCatalog | string | undefined = catalog;

  for (const part of parts) {
    if (typeof current === "string") return null;
    current = current[part];
    if (current === undefined) return null;
  }

  return typeof current === "string" ? current : null;
}

export function t(key: string, lang?: string): string {
  const targetLang = lang ?? currentLanguage;

  const catalog = catalogs[targetLang];
  if (catalog) {
    const value = resolveDottedPath(catalog, key);
    if (value !== null) return value;
  }

  if (targetLang !== "en") {
    const enCatalog = catalogs.en;
    const enValue = resolveDottedPath(enCatalog, key);
    if (enValue !== null) return enValue;
  }

  return key;
}

export function setLanguage(lang: string): void {
  if (SUPPORTED_LANGUAGES.includes(lang)) {
    currentLanguage = lang;
  }
}

export function supportedLanguages(): string[] {
  return [...SUPPORTED_LANGUAGES];
}
