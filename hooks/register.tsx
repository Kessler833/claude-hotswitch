import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Account, Accounts } from '../types'

// The swap itself lives in PowerShell scripts outside the app: Claude Desktop has to be
// closed for it (the cookie file is locked while it runs), so launch.ps1 starts
// hotswitch.ps1 detached; it swaps the login and starts Claude again.
// the scripts ship inside this plugin (scripts/); saved logins live in %USERPROFILE%\.claude-hotswitch
const scriptPath = ($: Engine, file: string) => [$.plugin.root, 'scripts', file].join('\\')
// Windows PowerShell 5 (always there) for the quick reads; the swap itself runs in pwsh 7
const PS = 'powershell.exe'
const NAME = /^[A-Za-z0-9_.-]{1,32}$/

const accounts = atom({ plugin: 'hotswitch', key: 'accounts' } as const, { active: '', locale: '', accounts: [] }, { shape: 'acc-3' })
const status = atom({ plugin: 'hotswitch', key: 'status' } as const, '', { shape: 'status-1' })
// the account Claude shows bottom-left right now ("Alex · Pro"), read by whoami.ps1
const who = atom({ plugin: 'hotswitch', key: 'who' } as const, '', { shape: 'who-1' })
const open = atom({ plugin: 'hotswitch', key: 'open' } as const, false, { shape: 'open-1' })
// the saved account whose removal is being asked about, '' when none
const confirmRemove = atom({ plugin: 'hotswitch', key: 'confirmRemove' } as const, '', { shape: 'confirm-remove-1' })

// ---- texts in the app's language (Settings > Language); translated by Haiku from i18n/en.json ----
// BEGIN STRINGS
const STRINGS = {
  "en": {
    "title": "Accounts",
    "active": "active",
    "activeUnsaved": "active · saved on the first switch",
    "currentAccount": "Current account",
    "add": "Add account",
    "transfer": "Transfer this session",
    "hint": "Click an account to switch. “Transfer this session” takes this chat along. Claude restarts for a moment.",
    "restarting": "Claude is restarting …",
    "startFailed": "Could not start (code {code}): {detail}",
    "readFailed": "Could not read the accounts: {detail}",
    "shown": "Accounts shown above the input field.",
    "hidden": "Accounts hidden.",
    "none": "No accounts saved yet.",
    "nameRule": "Name: only letters, digits, _ . - (max. 32)",
    "example": "Example: {example}",
    "notFound": "No saved account “{name}”.",
    "already": "“{name}” is already active.",
    "cmdDesc": "Show or hide your accounts and switch between them",
    "helpToggle": "show / hide the account list above the input field",
    "helpList": "list the saved accounts as text",
    "helpUse": "switch to <name>",
    "helpNew": "sign in to another account",
    "helpTransfer": "switch to <name> and take this session along",
    "helpLabel": "set the label shown for an account",
    "helpDelete": "remove a saved account",
    "helpRestart": "Switching restarts Claude Desktop for a moment (a running answer stops).",
    "remove": "Remove",
    "removeAsk": "Remove “{name}” from this list? To add it again you sign in once more.",
    "removeYes": "Remove",
    "cancel": "Cancel",
    "removed": "“{name}” removed."
  },
  "de": {
    "title": "Konten",
    "active": "aktiv",
    "activeUnsaved": "aktiv · wird beim ersten Wechsel gespeichert",
    "currentAccount": "Aktuelles Konto",
    "add": "Konto hinzufügen",
    "transfer": "Sitzung mitnehmen",
    "hint": "Klick auf ein Konto, um zu wechseln. „Sitzung mitnehmen“ nimmt diesen Chat mit. Claude startet dafür kurz neu.",
    "restarting": "Claude startet neu …",
    "startFailed": "Start fehlgeschlagen (Code {code}): {detail}",
    "readFailed": "Konten konnten nicht gelesen werden: {detail}",
    "shown": "Konten werden über dem Eingabefeld angezeigt.",
    "hidden": "Konten ausgeblendet.",
    "none": "Noch keine Konten gespeichert.",
    "nameRule": "Name: nur Buchstaben, Ziffern, _ . - (max. 32)",
    "example": "Beispiel: {example}",
    "notFound": "Kein gespeichertes Konto „{name}“.",
    "already": "„{name}“ ist bereits aktiv.",
    "cmdDesc": "Konten ein- oder ausblenden und zwischen ihnen wechseln",
    "helpToggle": "Kontoliste über dem Eingabefeld ein- oder ausblenden",
    "helpList": "gespeicherte Konten als Text auflisten",
    "helpUse": "zu <name> wechseln",
    "helpNew": "bei einem anderen Konto anmelden",
    "helpTransfer": "zu <name> wechseln und diese Sitzung mitnehmen",
    "helpLabel": "die Bezeichnung für ein Konto festlegen",
    "helpDelete": "ein gespeichertes Konto entfernen",
    "helpRestart": "Beim Wechseln startet Claude Desktop kurz neu (eine laufende Antwort wird abgebrochen).",
    "remove": "Entfernen",
    "removeAsk": "„{name}“ aus dieser Liste entfernen? Um es wieder hinzuzufügen, meldest du dich noch einmal an.",
    "removeYes": "Entfernen",
    "cancel": "Abbrechen",
    "removed": "„{name}“ entfernt."
  },
  "fr": {
    "title": "Comptes",
    "active": "actif",
    "activeUnsaved": "actif · enregistré au premier changement",
    "currentAccount": "Compte actuel",
    "add": "Ajouter un compte",
    "transfer": "Transférer cette session",
    "hint": "Cliquez sur un compte pour changer. « Transférer cette session » emporte aussi cette conversation. Claude redémarre brièvement.",
    "restarting": "Claude redémarre …",
    "startFailed": "Échec du démarrage (code {code}) : {detail}",
    "readFailed": "Impossible de lire les comptes : {detail}",
    "shown": "Comptes affichés au-dessus du champ de saisie.",
    "hidden": "Comptes masqués.",
    "none": "Aucun compte enregistré pour le moment.",
    "nameRule": "Nom : uniquement lettres, chiffres, _ . - (32 max.)",
    "example": "Exemple : {example}",
    "notFound": "Aucun compte enregistré « {name} ».",
    "already": "« {name} » est déjà actif.",
    "cmdDesc": "Afficher ou masquer vos comptes et basculer de l'un à l'autre",
    "helpToggle": "afficher / masquer la liste des comptes au-dessus du champ de saisie",
    "helpList": "lister les comptes enregistrés sous forme de texte",
    "helpUse": "passer à <name>",
    "helpNew": "se connecter à un autre compte",
    "helpTransfer": "passer à <name> et emporter cette session",
    "helpLabel": "définir le libellé affiché pour un compte",
    "helpDelete": "supprimer un compte enregistré",
    "helpRestart": "Le changement redémarre brièvement Claude Desktop (une réponse en cours est interrompue).",
    "remove": "Retirer",
    "removeAsk": "Retirer « {name} » de cette liste ? Pour l'ajouter à nouveau, il faudra vous reconnecter.",
    "removeYes": "Retirer",
    "cancel": "Annuler",
    "removed": "« {name} » retiré."
  },
  "es": {
    "title": "Cuentas",
    "active": "activa",
    "activeUnsaved": "activa · se guarda al primer cambio",
    "currentAccount": "Cuenta actual",
    "add": "Añadir cuenta",
    "transfer": "Transferir esta sesión",
    "hint": "Haz clic en una cuenta para cambiar. «Transferir esta sesión» lleva este chat contigo. Claude se reinicia un momento.",
    "restarting": "Claude se está reiniciando …",
    "startFailed": "No se pudo iniciar (código {code}): {detail}",
    "readFailed": "No se pudieron leer las cuentas: {detail}",
    "shown": "Cuentas mostradas encima del campo de entrada.",
    "hidden": "Cuentas ocultas.",
    "none": "Aún no hay cuentas guardadas.",
    "nameRule": "Nombre: solo letras, dígitos, _ . - (máx. 32)",
    "example": "Ejemplo: {example}",
    "notFound": "No hay ninguna cuenta guardada «{name}».",
    "already": "«{name}» ya está activa.",
    "cmdDesc": "Mostrar u ocultar tus cuentas y cambiar entre ellas",
    "helpToggle": "mostrar / ocultar la lista de cuentas encima del campo de entrada",
    "helpList": "listar las cuentas guardadas como texto",
    "helpUse": "cambiar a <name>",
    "helpNew": "iniciar sesión con otra cuenta",
    "helpTransfer": "cambiar a <name> y llevarte esta sesión",
    "helpLabel": "definir la etiqueta mostrada para una cuenta",
    "helpDelete": "eliminar una cuenta guardada",
    "helpRestart": "Al cambiar, Claude Desktop se reinicia un momento (se detiene una respuesta en curso).",
    "remove": "Quitar",
    "removeAsk": "¿Quitar «{name}» de esta lista? Para volver a añadirla, tendrás que iniciar sesión otra vez.",
    "removeYes": "Quitar",
    "cancel": "Cancelar",
    "removed": "«{name}» quitada."
  },
  "it": {
    "title": "Account",
    "active": "attivo",
    "activeUnsaved": "attivo · salvato al primo cambio",
    "currentAccount": "Account attuale",
    "add": "Aggiungi account",
    "transfer": "Trasferisci questa sessione",
    "hint": "Clicca su un account per cambiare. «Trasferisci questa sessione» porta con sé questa chat. Claude si riavvia per un momento.",
    "restarting": "Claude si sta riavviando …",
    "startFailed": "Avvio non riuscito (codice {code}): {detail}",
    "readFailed": "Impossibile leggere gli account: {detail}",
    "shown": "Account mostrati sopra il campo di input.",
    "hidden": "Account nascosti.",
    "none": "Nessun account salvato finora.",
    "nameRule": "Nome: solo lettere, cifre, _ . - (max. 32)",
    "example": "Esempio: {example}",
    "notFound": "Nessun account salvato «{name}».",
    "already": "«{name}» è già attivo.",
    "cmdDesc": "Mostra o nascondi i tuoi account e passa dall'uno all'altro",
    "helpToggle": "mostra / nascondi l'elenco degli account sopra il campo di input",
    "helpList": "elenca gli account salvati come testo",
    "helpUse": "passa a <name>",
    "helpNew": "accedi a un altro account",
    "helpTransfer": "passa a <name> e porta con te questa sessione",
    "helpLabel": "imposta l'etichetta mostrata per un account",
    "helpDelete": "rimuovi un account salvato",
    "helpRestart": "Il cambio riavvia brevemente Claude Desktop (una risposta in corso viene interrotta).",
    "remove": "Rimuovi",
    "removeAsk": "Rimuovere «{name}» da questo elenco? Per aggiungerlo di nuovo dovrai accedere un'altra volta.",
    "removeYes": "Rimuovi",
    "cancel": "Annulla",
    "removed": "«{name}» rimosso."
  },
  "pt": {
    "title": "Contas",
    "active": "ativa",
    "activeUnsaved": "ativa · salva na primeira troca",
    "currentAccount": "Conta atual",
    "add": "Adicionar conta",
    "transfer": "Transferir esta sessão",
    "hint": "Clique em uma conta para trocar. “Transferir esta sessão” leva este chat junto. O Claude reinicia por um momento.",
    "restarting": "O Claude está reiniciando …",
    "startFailed": "Não foi possível iniciar (código {code}): {detail}",
    "readFailed": "Não foi possível ler as contas: {detail}",
    "shown": "Contas exibidas acima do campo de entrada.",
    "hidden": "Contas ocultas.",
    "none": "Nenhuma conta salva ainda.",
    "nameRule": "Nome: apenas letras, dígitos, _ . - (máx. 32)",
    "example": "Exemplo: {example}",
    "notFound": "Nenhuma conta salva “{name}”.",
    "already": "“{name}” já está ativa.",
    "cmdDesc": "Mostrar ou ocultar suas contas e alternar entre elas",
    "helpToggle": "mostrar / ocultar a lista de contas acima do campo de entrada",
    "helpList": "listar as contas salvas como texto",
    "helpUse": "trocar para <name>",
    "helpNew": "entrar em outra conta",
    "helpTransfer": "trocar para <name> e levar esta sessão junto",
    "helpLabel": "definir o rótulo exibido para uma conta",
    "helpDelete": "remover uma conta salva",
    "helpRestart": "Trocar reinicia o Claude Desktop por um momento (uma resposta em andamento é interrompida).",
    "remove": "Remover",
    "removeAsk": "Remover “{name}” desta lista? Para adicioná-la de novo, você vai precisar entrar mais uma vez.",
    "removeYes": "Remover",
    "cancel": "Cancelar",
    "removed": "“{name}” removida."
  },
  "ja": {
    "title": "アカウント",
    "active": "使用中",
    "activeUnsaved": "使用中 · 最初の切り替え時に保存",
    "currentAccount": "現在のアカウント",
    "add": "アカウントを追加",
    "transfer": "このセッションを引き継ぐ",
    "hint": "アカウントをクリックして切り替えます。「このセッションを引き継ぐ」を選ぶと、このチャットも一緒に移動します。Claude は一時的に再起動します。",
    "restarting": "Claude を再起動しています …",
    "startFailed": "起動できませんでした（コード {code}）: {detail}",
    "readFailed": "アカウントを読み込めませんでした: {detail}",
    "shown": "入力欄の上にアカウントを表示しました。",
    "hidden": "アカウントを非表示にしました。",
    "none": "保存されたアカウントはまだありません。",
    "nameRule": "名前: 英字・数字・_ . - のみ（最大 32 文字）",
    "example": "例: {example}",
    "notFound": "保存されたアカウント「{name}」はありません。",
    "already": "「{name}」は既に使用中です。",
    "cmdDesc": "アカウントの一覧を表示・非表示にし、アカウントを切り替えます",
    "helpToggle": "入力欄の上のアカウント一覧を表示 / 非表示",
    "helpList": "保存済みアカウントをテキストで一覧表示",
    "helpUse": "<name> に切り替え",
    "helpNew": "別のアカウントでサインイン",
    "helpTransfer": "<name> に切り替え、このセッションも一緒に移動",
    "helpLabel": "アカウントに表示するラベルを設定",
    "helpDelete": "保存済みアカウントを削除",
    "helpRestart": "切り替えると Claude Desktop が一時的に再起動します（実行中の回答は停止します）。",
    "remove": "削除",
    "removeAsk": "「{name}」をこの一覧から削除しますか？ 再び追加するには、もう一度サインインが必要です。",
    "removeYes": "削除",
    "cancel": "キャンセル",
    "removed": "「{name}」を削除しました。"
  },
  "ko": {
    "title": "계정",
    "active": "사용 중",
    "activeUnsaved": "사용 중 · 첫 전환 시 저장됨",
    "currentAccount": "현재 계정",
    "add": "계정 추가",
    "transfer": "이 세션 함께 전환",
    "hint": "계정을 클릭하면 전환됩니다. “이 세션 함께 전환”을 선택하면 이 대화도 함께 옮겨집니다. Claude가 잠시 다시 시작됩니다.",
    "restarting": "Claude를 다시 시작하는 중 …",
    "startFailed": "시작할 수 없습니다(코드 {code}): {detail}",
    "readFailed": "계정을 읽을 수 없습니다: {detail}",
    "shown": "입력란 위에 계정을 표시했습니다.",
    "hidden": "계정을 숨겼습니다.",
    "none": "저장된 계정이 아직 없습니다.",
    "nameRule": "이름: 영문자, 숫자, _ . - 만 사용 (최대 32자)",
    "example": "예: {example}",
    "notFound": "저장된 계정 “{name}”이(가) 없습니다.",
    "already": "“{name}”은(는) 이미 사용 중입니다.",
    "cmdDesc": "계정 목록을 표시하거나 숨기고 계정을 전환합니다",
    "helpToggle": "입력란 위의 계정 목록 표시 / 숨기기",
    "helpList": "저장된 계정을 텍스트로 나열",
    "helpUse": "<name>(으)로 전환",
    "helpNew": "다른 계정으로 로그인",
    "helpTransfer": "<name>(으)로 전환하고 이 세션도 함께 가져가기",
    "helpLabel": "계정에 표시할 이름 설정",
    "helpDelete": "저장된 계정 삭제",
    "helpRestart": "전환하면 Claude Desktop이 잠시 다시 시작됩니다(진행 중인 답변은 중지됨).",
    "remove": "삭제",
    "removeAsk": "“{name}”을(를) 이 목록에서 삭제할까요? 다시 추가하려면 한 번 더 로그인해야 합니다.",
    "removeYes": "삭제",
    "cancel": "취소",
    "removed": "“{name}”을(를) 삭제했습니다."
  },
  "zh-CN": {
    "title": "账户",
    "active": "当前",
    "activeUnsaved": "当前 · 首次切换时保存",
    "currentAccount": "当前账户",
    "add": "添加账户",
    "transfer": "迁移此会话",
    "hint": "点击账户即可切换。“迁移此会话”会把这个对话一起带过去。Claude 会短暂重启。",
    "restarting": "Claude 正在重启 …",
    "startFailed": "无法启动（代码 {code}）：{detail}",
    "readFailed": "无法读取账户：{detail}",
    "shown": "账户已显示在输入框上方。",
    "hidden": "账户已隐藏。",
    "none": "尚未保存任何账户。",
    "nameRule": "名称：仅限字母、数字、_ . -（最多 32 个字符）",
    "example": "示例：{example}",
    "notFound": "没有名为“{name}”的已保存账户。",
    "already": "“{name}”已是当前账户。",
    "cmdDesc": "显示或隐藏账户列表，并在账户之间切换",
    "helpToggle": "显示 / 隐藏输入框上方的账户列表",
    "helpList": "以文本形式列出已保存的账户",
    "helpUse": "切换到 <name>",
    "helpNew": "登录另一个账户",
    "helpTransfer": "切换到 <name> 并带上此会话",
    "helpLabel": "设置账户的显示标签",
    "helpDelete": "删除已保存的账户",
    "helpRestart": "切换会使 Claude Desktop 短暂重启（正在进行的回答会停止）。",
    "remove": "移除",
    "removeAsk": "从此列表中移除“{name}”？如需再次添加，需要重新登录一次。",
    "removeYes": "移除",
    "cancel": "取消",
    "removed": "已移除“{name}”。"
  },
  "zh-TW": {
    "title": "帳戶",
    "active": "使用中",
    "activeUnsaved": "使用中 · 首次切換時儲存",
    "currentAccount": "目前帳戶",
    "add": "新增帳戶",
    "transfer": "移轉此工作階段",
    "hint": "點選帳戶即可切換。「移轉此工作階段」會把這個對話一併帶過去。Claude 會暫時重新啟動。",
    "restarting": "Claude 正在重新啟動 …",
    "startFailed": "無法啟動（代碼 {code}）：{detail}",
    "readFailed": "無法讀取帳戶：{detail}",
    "shown": "帳戶已顯示在輸入欄上方。",
    "hidden": "帳戶已隱藏。",
    "none": "尚未儲存任何帳戶。",
    "nameRule": "名稱：僅限字母、數字、_ . -（最多 32 個字元）",
    "example": "範例：{example}",
    "notFound": "沒有名為「{name}」的已儲存帳戶。",
    "already": "「{name}」已在使用中。",
    "cmdDesc": "顯示或隱藏帳戶清單，並在帳戶之間切換",
    "helpToggle": "顯示 / 隱藏輸入欄上方的帳戶清單",
    "helpList": "以文字列出已儲存的帳戶",
    "helpUse": "切換到 <name>",
    "helpNew": "登入另一個帳戶",
    "helpTransfer": "切換到 <name> 並帶走此工作階段",
    "helpLabel": "設定帳戶顯示的標籤",
    "helpDelete": "刪除已儲存的帳戶",
    "helpRestart": "切換會讓 Claude Desktop 暫時重新啟動（進行中的回覆會停止）。",
    "remove": "移除",
    "removeAsk": "要從此清單移除「{name}」嗎？若要再次新增，需要重新登入一次。",
    "removeYes": "移除",
    "cancel": "取消",
    "removed": "已移除「{name}」。"
  },
  "hi": {
    "title": "खाते",
    "active": "सक्रिय",
    "activeUnsaved": "सक्रिय · पहली बार स्विच करने पर सहेजा जाएगा",
    "currentAccount": "वर्तमान खाता",
    "add": "खाता जोड़ें",
    "transfer": "यह सत्र स्थानांतरित करें",
    "hint": "स्विच करने के लिए किसी खाते पर क्लिक करें। “यह सत्र स्थानांतरित करें” इस चैट को साथ ले जाता है। Claude थोड़ी देर के लिए रीस्टार्ट होता है।",
    "restarting": "Claude रीस्टार्ट हो रहा है …",
    "startFailed": "शुरू नहीं हो सका (कोड {code}): {detail}",
    "readFailed": "खाते पढ़े नहीं जा सके: {detail}",
    "shown": "इनपुट फ़ील्ड के ऊपर खाते दिखाए गए हैं।",
    "hidden": "खाते छिपाए गए।",
    "none": "अभी तक कोई खाता सहेजा नहीं गया है।",
    "nameRule": "नाम: केवल अक्षर, अंक, _ . - (अधिकतम 32)",
    "example": "उदाहरण: {example}",
    "notFound": "सहेजा गया कोई खाता “{name}” नहीं है।",
    "already": "“{name}” पहले से सक्रिय है।",
    "cmdDesc": "अपने खाते दिखाएँ या छिपाएँ और उनके बीच स्विच करें",
    "helpToggle": "इनपुट फ़ील्ड के ऊपर खातों की सूची दिखाएँ / छिपाएँ",
    "helpList": "सहेजे गए खाते टेक्स्ट के रूप में सूचीबद्ध करें",
    "helpUse": "<name> पर स्विच करें",
    "helpNew": "किसी दूसरे खाते में साइन इन करें",
    "helpTransfer": "<name> पर स्विच करें और यह सत्र साथ ले जाएँ",
    "helpLabel": "किसी खाते के लिए दिखने वाला लेबल सेट करें",
    "helpDelete": "सहेजा गया खाता हटाएँ",
    "helpRestart": "स्विच करने पर Claude Desktop थोड़ी देर के लिए रीस्टार्ट होता है (चल रहा जवाब रुक जाएगा)।",
    "remove": "हटाएँ",
    "removeAsk": "इस सूची से “{name}” हटाएँ? इसे फिर से जोड़ने के लिए एक बार फिर साइन इन करना होगा।",
    "removeYes": "हटाएँ",
    "cancel": "रद्द करें",
    "removed": "“{name}” हटा दिया गया।"
  },
  "id": {
    "title": "Akun",
    "active": "aktif",
    "activeUnsaved": "aktif · disimpan saat pertama kali beralih",
    "currentAccount": "Akun saat ini",
    "add": "Tambah akun",
    "transfer": "Pindahkan sesi ini",
    "hint": "Klik akun untuk beralih. “Pindahkan sesi ini” ikut membawa chat ini. Claude akan dimulai ulang sebentar.",
    "restarting": "Claude sedang dimulai ulang …",
    "startFailed": "Tidak dapat dimulai (kode {code}): {detail}",
    "readFailed": "Tidak dapat membaca akun: {detail}",
    "shown": "Akun ditampilkan di atas kolom input.",
    "hidden": "Akun disembunyikan.",
    "none": "Belum ada akun yang disimpan.",
    "nameRule": "Nama: hanya huruf, angka, _ . - (maks. 32)",
    "example": "Contoh: {example}",
    "notFound": "Tidak ada akun tersimpan “{name}”.",
    "already": "“{name}” sudah aktif.",
    "cmdDesc": "Tampilkan atau sembunyikan akun Anda dan beralih di antaranya",
    "helpToggle": "tampilkan / sembunyikan daftar akun di atas kolom input",
    "helpList": "tampilkan daftar akun tersimpan sebagai teks",
    "helpUse": "beralih ke <name>",
    "helpNew": "masuk ke akun lain",
    "helpTransfer": "beralih ke <name> dan bawa sesi ini",
    "helpLabel": "atur label yang ditampilkan untuk sebuah akun",
    "helpDelete": "hapus akun tersimpan",
    "helpRestart": "Beralih akan memulai ulang Claude Desktop sebentar (jawaban yang sedang berjalan akan berhenti).",
    "remove": "Hapus",
    "removeAsk": "Hapus “{name}” dari daftar ini? Untuk menambahkannya lagi, Anda perlu masuk sekali lagi.",
    "removeYes": "Hapus",
    "cancel": "Batal",
    "removed": "“{name}” dihapus."
  },
  "nl": {
    "title": "Accounts",
    "active": "actief",
    "activeUnsaved": "actief · opgeslagen bij de eerste wissel",
    "currentAccount": "Huidig account",
    "add": "Account toevoegen",
    "transfer": "Deze sessie meenemen",
    "hint": "Klik op een account om te wisselen. “Deze sessie meenemen” neemt deze chat mee. Claude herstart even.",
    "restarting": "Claude wordt opnieuw gestart …",
    "startFailed": "Starten mislukt (code {code}): {detail}",
    "readFailed": "Accounts konden niet worden gelezen: {detail}",
    "shown": "Accounts worden boven het invoerveld getoond.",
    "hidden": "Accounts verborgen.",
    "none": "Nog geen accounts opgeslagen.",
    "nameRule": "Naam: alleen letters, cijfers, _ . - (max. 32)",
    "example": "Voorbeeld: {example}",
    "notFound": "Geen opgeslagen account “{name}”.",
    "already": "“{name}” is al actief.",
    "cmdDesc": "Accounts tonen of verbergen en ertussen wisselen",
    "helpToggle": "accountlijst boven het invoerveld tonen / verbergen",
    "helpList": "opgeslagen accounts als tekst weergeven",
    "helpUse": "wisselen naar <name>",
    "helpNew": "inloggen bij een ander account",
    "helpTransfer": "wisselen naar <name> en deze sessie meenemen",
    "helpLabel": "het label instellen voor een account",
    "helpDelete": "een opgeslagen account verwijderen",
    "helpRestart": "Wisselen herstart Claude Desktop even (een lopend antwoord stopt).",
    "remove": "Verwijderen",
    "removeAsk": "“{name}” uit deze lijst verwijderen? Om het later weer toe te voegen, log je nog een keer in.",
    "removeYes": "Verwijderen",
    "cancel": "Annuleren",
    "removed": "“{name}” verwijderd."
  },
  "pl": {
    "title": "Konta",
    "active": "aktywne",
    "activeUnsaved": "aktywne · zapisane przy pierwszym przełączeniu",
    "currentAccount": "Bieżące konto",
    "add": "Dodaj konto",
    "transfer": "Przenieś tę sesję",
    "hint": "Kliknij konto, aby się przełączyć. „Przenieś tę sesję” zabiera ten czat ze sobą. Claude na chwilę się uruchomi ponownie.",
    "restarting": "Claude uruchamia się ponownie …",
    "startFailed": "Nie można uruchomić (kod {code}): {detail}",
    "readFailed": "Nie można odczytać kont: {detail}",
    "shown": "Konta są wyświetlane nad polem wprowadzania.",
    "hidden": "Konta ukryte.",
    "none": "Nie zapisano jeszcze żadnych kont.",
    "nameRule": "Nazwa: tylko litery, cyfry, _ . - (maks. 32)",
    "example": "Przykład: {example}",
    "notFound": "Brak zapisanego konta „{name}”.",
    "already": "„{name}” jest już aktywne.",
    "cmdDesc": "Pokaż lub ukryj konta i przełączaj się między nimi",
    "helpToggle": "pokaż / ukryj listę kont nad polem wprowadzania",
    "helpList": "wyświetl zapisane konta jako tekst",
    "helpUse": "przełącz na <name>",
    "helpNew": "zaloguj się na inne konto",
    "helpTransfer": "przełącz na <name> i zabierz tę sesję",
    "helpLabel": "ustaw etykietę wyświetlaną dla konta",
    "helpDelete": "usuń zapisane konto",
    "helpRestart": "Przełączenie na chwilę uruchomi Claude Desktop ponownie (trwająca odpowiedź zostanie przerwana).",
    "remove": "Usuń",
    "removeAsk": "Usunąć „{name}” z tej listy? Aby dodać je ponownie, zaloguj się jeszcze raz.",
    "removeYes": "Usuń",
    "cancel": "Anuluj",
    "removed": "Usunięto „{name}”."
  },
  "ru": {
    "title": "Аккаунты",
    "active": "активен",
    "activeUnsaved": "активен · сохранится при первом переключении",
    "currentAccount": "Текущий аккаунт",
    "add": "Добавить аккаунт",
    "transfer": "Перенести сессию",
    "hint": "Нажмите на аккаунт, чтобы переключиться. «Перенести сессию» переносит и текущий чат. Claude на время перезапустится.",
    "restarting": "Claude перезапускается …",
    "startFailed": "Не удалось запустить (код {code}): {detail}",
    "readFailed": "Не удалось прочитать аккаунты: {detail}",
    "shown": "Аккаунты отображаются над полем ввода.",
    "hidden": "Аккаунты скрыты.",
    "none": "Сохранённых аккаунтов пока нет.",
    "nameRule": "Имя: только буквы, цифры, _ . - (макс. 32)",
    "example": "Пример: {example}",
    "notFound": "Нет сохранённого аккаунта «{name}».",
    "already": "«{name}» уже активен.",
    "cmdDesc": "Показать или скрыть аккаунты и переключаться между ними",
    "helpToggle": "показать / скрыть список аккаунтов над полем ввода",
    "helpList": "вывести сохранённые аккаунты текстом",
    "helpUse": "переключиться на <name>",
    "helpNew": "войти в другой аккаунт",
    "helpTransfer": "переключиться на <name> и перенести сессию",
    "helpLabel": "задать отображаемое название аккаунта",
    "helpDelete": "удалить сохранённый аккаунт",
    "helpRestart": "При переключении Claude Desktop на время перезапустится (текущий ответ будет прерван).",
    "remove": "Удалить",
    "removeAsk": "Удалить «{name}» из этого списка? Чтобы добавить его снова, потребуется войти ещё раз.",
    "removeYes": "Удалить",
    "cancel": "Отмена",
    "removed": "«{name}» удалён."
  },
  "tr": {
    "title": "Hesaplar",
    "active": "etkin",
    "activeUnsaved": "etkin · ilk geçişte kaydedilir",
    "currentAccount": "Geçerli hesap",
    "add": "Hesap ekle",
    "transfer": "Bu oturumu aktar",
    "hint": "Geçmek için bir hesaba tıklayın. “Bu oturumu aktar” bu sohbeti de beraberinde taşır. Claude kısa süreliğine yeniden başlar.",
    "restarting": "Claude yeniden başlatılıyor …",
    "startFailed": "Başlatılamadı (kod {code}): {detail}",
    "readFailed": "Hesaplar okunamadı: {detail}",
    "shown": "Hesaplar giriş alanının üstünde gösteriliyor.",
    "hidden": "Hesaplar gizlendi.",
    "none": "Henüz kayıtlı hesap yok.",
    "nameRule": "Ad: yalnızca harf, rakam, _ . - (en fazla 32)",
    "example": "Örnek: {example}",
    "notFound": "“{name}” adlı kayıtlı hesap yok.",
    "already": "“{name}” zaten etkin.",
    "cmdDesc": "Hesaplarınızı göster veya gizle ve aralarında geçiş yap",
    "helpToggle": "giriş alanının üstündeki hesap listesini göster / gizle",
    "helpList": "kayıtlı hesapları metin olarak listele",
    "helpUse": "<name> hesabına geç",
    "helpNew": "başka bir hesapla oturum aç",
    "helpTransfer": "<name> hesabına geç ve bu oturumu da götür",
    "helpLabel": "bir hesap için gösterilecek etiketi ayarla",
    "helpDelete": "kayıtlı bir hesabı kaldır",
    "helpRestart": "Geçiş yapmak Claude Desktop'u kısa süreliğine yeniden başlatır (devam eden yanıt durur).",
    "remove": "Kaldır",
    "removeAsk": "“{name}” bu listeden kaldırılsın mı? Tekrar eklemek için bir kez daha oturum açmanız gerekir.",
    "removeYes": "Kaldır",
    "cancel": "İptal",
    "removed": "“{name}” kaldırıldı."
  },
  "uk": {
    "title": "Облікові записи",
    "active": "активний",
    "activeUnsaved": "активний · збережеться під час першого перемикання",
    "currentAccount": "Поточний обліковий запис",
    "add": "Додати обліковий запис",
    "transfer": "Перенести цю сесію",
    "hint": "Клацніть обліковий запис, щоб перемкнутися. «Перенести цю сесію» бере з собою цей чат. Claude на мить перезапуститься.",
    "restarting": "Claude перезапускається …",
    "startFailed": "Не вдалося запустити (код {code}): {detail}",
    "readFailed": "Не вдалося прочитати облікові записи: {detail}",
    "shown": "Облікові записи показано над полем введення.",
    "hidden": "Облікові записи приховано.",
    "none": "Збережених облікових записів ще немає.",
    "nameRule": "Назва: лише літери, цифри, _ . - (макс. 32)",
    "example": "Приклад: {example}",
    "notFound": "Немає збереженого облікового запису «{name}».",
    "already": "«{name}» уже активний.",
    "cmdDesc": "Показати або приховати облікові записи та перемикатися між ними",
    "helpToggle": "показати / приховати список облікових записів над полем введення",
    "helpList": "вивести збережені облікові записи текстом",
    "helpUse": "перемкнутися на <name>",
    "helpNew": "увійти в інший обліковий запис",
    "helpTransfer": "перемкнутися на <name> і перенести сесію",
    "helpLabel": "задати мітку для облікового запису",
    "helpDelete": "видалити збережений обліковий запис",
    "helpRestart": "Перемикання на мить перезапускає Claude Desktop (поточна відповідь буде перервана).",
    "remove": "Видалити",
    "removeAsk": "Видалити «{name}» зі списку? Щоб додати його знову, потрібно ще раз увійти.",
    "removeYes": "Видалити",
    "cancel": "Скасувати",
    "removed": "«{name}» видалено."
  }
} as const
// END STRINGS

type Key = keyof (typeof STRINGS)['en']
const LANGS = STRINGS as unknown as Record<string, Partial<Record<Key, string>>>

// "de-DE" -> de, "zh-TW" -> zh-TW, "pt-BR" -> pt; English when unknown
function tr(locale: string, key: Key, vars: Record<string, string | number> = {}): string {
  const l = locale.trim()
  const table = LANGS[l] ?? LANGS[l.split('-')[0] ?? ''] ?? (l.startsWith('zh') ? LANGS['zh-CN'] : undefined)
  let s: string = table?.[key] ?? STRINGS.en[key]
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

const title = (a: Account) => a.label || a.name

async function script($: Engine, args: string[]) {
  return $.process.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath($, 'hotswitch.ps1'), ...args], { timeoutMs: 20000 })
}

async function refresh($: Engine): Promise<Accounts> {
  const r = await script($, ['json'])
  let data: Accounts = { active: '', locale: '', accounts: [] }
  try {
    const p = JSON.parse(r.stdout.trim() || '{}')
    const list = ([] as unknown[]).concat(p.accounts ?? []) as Account[]
    data = {
      active: String(p.active ?? ''),
      locale: String(p.locale ?? ''),
      accounts: list.map(a => ({ name: String(a.name), label: String(a.label ?? '') })),
    }
  } catch {
    // keep showing the last good list; just say that reading failed
    const old = await read($, accounts)
    await update($, status, () => tr(old.locale, 'readFailed', { detail: (r.stderr || r.stdout).slice(0, 200) }))
    return old
  }
  await update($, accounts, () => data)
  return data
}

// Reads who is signed in and gives the active saved account that name if it has none yet.
async function identify($: Engine): Promise<void> {
  const r = await $.process.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath($, 'whoami.ps1')], { timeoutMs: 20000 })
  let me = ''
  try {
    if (r.exitCode === 0) me = String(JSON.parse(r.stdout.trim()).label ?? '')
  } catch {
    me = ''
  }
  await update($, who, () => me)
  const d = await refresh($)
  const cur = d.accounts.find(a => a.name === d.active)
  if (me && cur && cur.label === '') {
    await script($, ['label', cur.name, me])
    await refresh($)
  }
}

// action: use | transfer | new | save. transfer also takes this session (by its id) along.
// A double click must not start two switches: a second launch within 15 s is ignored
// (the script also holds a lock, this just keeps the message calm).
let lastLaunchAt = 0
async function launch($: Engine, action: string, name = ''): Promise<string> {
  const now = await $.clock.now()
  if (now - lastLaunchAt < 15000) return await read($, status)
  lastLaunchAt = now
  const argv = [PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath($, 'launch.ps1'), action]
  if (name) argv.push(name)
  if (action === 'transfer') argv.push(await $.session.id())
  const r = await $.process.run(argv, { timeoutMs: 20000 })
  const { locale } = await read($, accounts)
  if (r.exitCode !== 0) lastLaunchAt = 0   // nothing started: allow another try right away
  const msg = r.exitCode === 0
    ? tr(locale, 'restarting')
    : tr(locale, 'startFailed', { code: r.exitCode, detail: (r.stderr || r.stdout).slice(0, 200) })
  await update($, status, () => msg)
  if (r.exitCode === 0) void watchForFailure($, locale)
  return msg
}

// A switch closes Claude within seconds. If Claude is still here after a while, the switch
// stopped early (it logs why): show that instead of "restarting" forever.
async function watchForFailure($: Engine, locale: string): Promise<void> {
  await $.clock.sleep(12000)
  const r = await script($, ['lasterror'])
  try {
    const p = JSON.parse(r.stdout.trim() || '{}') as { error?: string; ageSeconds?: number }
    if (p.error && (p.ageSeconds ?? 999) < 30) {
      lastLaunchAt = 0
      await update($, status, () => tr(locale, 'startFailed', { code: 1, detail: String(p.error).slice(0, 200) }))
      await refresh($)
    }
  } catch {
    // no answer: leave the message as it is
  }
}

// Removes a saved account that is not active (after the person confirmed it in the list).
async function remove($: Engine, acc: Account): Promise<void> {
  await update($, confirmRemove, () => '')
  const r = await script($, ['delete', acc.name])
  const d = await refresh($)
  await update($, status, () => (r.exitCode === 0 ? tr(d.locale, 'removed', { name: title(acc) }) : (r.stderr || r.stdout).trim()))
}

function help(locale: string): string {
  const t = (k: Key) => tr(locale, k)
  return [
    `/account                      ${t('helpToggle')}`,
    `/account list                 ${t('helpList')}`,
    `/account <name>               ${t('helpUse')}`,
    `/account transfer <name>      ${t('helpTransfer')}`,
    `/account new                  ${t('helpNew')}`,
    `/account label <name> <text>  ${t('helpLabel')}`,
    `/account delete <name>        ${t('helpDelete')}`,
    '',
    t('helpRestart'),
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // registered at once, so the icon and command are there right away; the
    // slower lookups (accounts, who is signed in) run after the session has started
    await $.command.register({ name: 'account', description: tr((await read($, accounts)).locale, 'cmdDesc') })
    const started = await next(e)
    await update($, status, () => '')
    await update($, open, () => false)
    await update($, confirmRemove, () => '')
    void identify($)
    return started
  })

  on('command.run', { command: 'account' }, async ($, e) => {
    const [a = '', b = '', ...rest] = e.args.trim().split(/\s+/)
    const act = a.toLowerCase()
    const d = await refresh($)
    const L = d.locale
    if (act === 'help') return { text: help(L) }
    if (act === '') {
      // toggles the account list above the prompt
      await update($, open, v => !v)
      const nowOpen = await read($, open)
      if (nowOpen) void identify($)
      return { text: tr(L, nowOpen ? 'shown' : 'hidden') }
    }
    if (act === 'list') {
      const list = d.accounts.map(x => (x.name === d.active ? `✓ ${title(x)}` : `  ${title(x)}`)).join('\n')
      return { text: list || tr(L, 'none') }
    }
    if (act === 'new') return { text: await launch($, 'new') }
    if (act === 'save') {
      if (b && !NAME.test(b)) return { text: tr(L, 'nameRule') }
      return { text: await launch($, 'save', b) }
    }
    if (act === 'label' || act === 'delete') {
      if (!NAME.test(b)) return { text: tr(L, 'example', { example: `/account ${act} account1${act === 'label' ? ' Name' : ''}` }) }
      const r = await script($, act === 'label' ? ['label', b, ...rest] : ['delete', b])
      await refresh($)
      return { text: r.stdout.trim() || r.stderr.trim() }
    }
    const isTransfer = act === 'transfer'
    const target = act === 'use' || isTransfer ? b : a
    if (!d.accounts.some(x => x.name === target)) return { text: tr(L, 'notFound', { name: target }) + '\n\n' + help(L) }
    if (target === d.active) return { text: tr(L, 'already', { name: target }) }
    return { text: await launch($, isTransfer ? 'transfer' : 'use', target) }
  })

  // A small user icon in the footer under the prompt, at the right next to the mode labels:
  // a click shows / hides the account list above the prompt.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const base = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // a button "<user icon> Accounts" (in the app's language), easy to hit; the user glyph is
    // forced to its monochrome text form (U+FE0E) so it matches the app's line icons
    const isOpen = await read($, open)
    const { locale } = await read($, accounts)
    // A plain label like "Auto" next to it. The footer gives a mod a fixed 18 px line (measured
    // via UI Automation): padding, a background pill and an explicit height (rows) are all cut.
    const icon = (
      <Button key="account-icon" plain onPress={() => {
        void update($, open, v => !v)
        void identify($)
      }}>
        <Text color={isOpen ? 'claude' : 'text'}>{'\u{1F464}︎  ' + tr(locale, 'title')}</Text>
      </Button>
    )
    return base ? (
      <Box flexDirection="row" gap={1} alignItems="center">
        {base}
        {icon}
      </Box>
    ) : icon
  })

  // The account list in the band above the prompt, hidden until the icon or /account opens it.
  // Whatever other mods draw there stays below it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    if (!(await read($, open))) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const d = await read($, accounts)
    const msg = await read($, status)
    const me = await read($, who)
    const t = (k: Key) => tr(d.locale, k)
    // the active saved account; if the login is not saved (signed in again by hand), the saved
    // account with the same name - the script stores the login there on the next switch
    const current = d.accounts.find(a => a.name === d.active) ?? (me ? d.accounts.find(a => a.label === me) : undefined)
    const others = d.accounts.filter(a => a !== current)
    const toggle = () => void update($, open, v => !v)
    const asking = await read($, confirmRemove)

    const row = (
      // the accounts stacked, like the account list on the phone
      <Box key="account-row" flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text bold>{t('title')}</Text>
          <Button key="close" plain dimColor onPress={toggle}>
            ×
          </Button>
        </Box>
        <Text>
          <Text color="claude" bold>✓ </Text>
          {current ? title(current) : me || t('currentAccount')}{' '}
          <Text dimColor>· {current ? t('active') : t('activeUnsaved')}</Text>
        </Text>
        {others.map(acc =>
          asking === acc.name ? (
            // asks before an account is removed from the list
            <Box key={'ask-' + acc.name} flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
              <Text color="warning">{tr(d.locale, 'removeAsk', { name: title(acc) })}</Text>
              <Box flexDirection="row" gap={1}>
                <Button key={'remove-yes-' + acc.name} variant="primary" onPress={() => void remove($, acc)}>
                  {t('removeYes')}
                </Button>
                <Button key={'remove-no-' + acc.name} onPress={() => void update($, confirmRemove, () => '')}>
                  {t('cancel')}
                </Button>
              </Box>
            </Box>
          ) : (
            <Box key={'row-' + acc.name} flexDirection="row" justifyContent="space-between" alignItems="center">
              <Button key={'acc-' + acc.name} plain onPress={() => void launch($, 'use', acc.name)}>
                {'   ' + title(acc)}
              </Button>
              <Box flexDirection="row" gap={1} alignItems="center">
                <Button key={'transfer-' + acc.name} dimColor onPress={() => void launch($, 'transfer', acc.name)}>
                  {t('transfer')} →
                </Button>
                <Button key={'remove-' + acc.name} label="✕" plain dimColor onPress={() => void update($, confirmRemove, () => acc.name)} />
              </Box>
            </Box>
          ),
        )}
        <Button key="add" plain onPress={() => void launch($, 'new')}>
          <Text color="claude">+  {t('add')}</Text>
        </Button>
        {msg !== '' ? <Text color="warning">{msg}</Text> : <Text dimColor>{t('hint')}</Text>}
      </Box>
    )

    return below ? (
      // no width/size props here: the engine's own drawing may not sit under a sized Box
      <Box flexDirection="column" gap={1}>
        {row}
        {below}
      </Box>
    ) : row
  })
}
