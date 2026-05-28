import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Copy,
  ImagePlus,
  KeyRound,
  Lock,
  Menu,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SmilePlus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_PHOTO_STICKERS = [
  {
    id: "sample-1",
    title: "Реальный мем 1",
    hint: "Добавь своё фото",
    dataUrl: null,
    tags: "мем фото прикол реакция",
  },
  {
    id: "sample-2",
    title: "Реальный мем 2",
    hint: "Импорт с телефона",
    dataUrl: null,
    tags: "угар смешно лицо",
  },
];

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function secret(size = 48) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(size))).replace(/=+$/g, "");
}
async function sha256Text(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return bytesToBase64(new Uint8Array(digest));
}
function roomIdFromSecret(roomSecret) {
  return `korvet-${roomSecret.slice(0, 18).replace(/[^a-zA-Z0-9]/g, "x")}`;
}
async function deriveKey(roomSecret, messageNonce, salt) {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${roomSecret}.${messageNonce}.korvet-manager-v2`),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 750000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
async function encryptPayload(roomSecret, clear) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const messageNonce = secret(32);
  const key = await deriveKey(roomSecret, messageNonce, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode("korvet-manager-telegram-style-v2") },
    key,
    encoder.encode(JSON.stringify(clear))
  );
  return {
    v: 2,
    app: "Korvet manager",
    style: "telegram-like",
    alg: "AES-GCM-256",
    kdf: "PBKDF2-SHA256",
    kdfIterations: 750000,
    messageNonce,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}
async function decryptPayload(roomSecret, payload) {
  const key = await deriveKey(roomSecret, payload.messageNonce, base64ToBytes(payload.salt));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv), additionalData: encoder.encode("korvet-manager-telegram-style-v2") },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return JSON.parse(decoder.decode(plain));
}

function loadStickerPack() {
  try {
    const raw = localStorage.getItem("km_photo_stickers");
    return raw ? JSON.parse(raw) : DEFAULT_PHOTO_STICKERS;
  } catch {
    return DEFAULT_PHOTO_STICKERS;
  }
}

export default function App() {
  const [roomSecret, setRoomSecret] = useState(() => localStorage.getItem("km_room_secret") || secret(96));
  const [displayName, setDisplayName] = useState(() => localStorage.getItem("km_name") || "Я");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [sticker, setSticker] = useState(null);
  const [photoStickers, setPhotoStickers] = useState(loadStickerPack);
  const [messages, setMessages] = useState([]);
  const [cipherView, setCipherView] = useState(null);
  const [safety, setSafety] = useState("");
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerQuery, setStickerQuery] = useState("");
  const [status, setStatus] = useState("offline");
  const [leftOpen, setLeftOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [activePanel, setActivePanel] = useState("chat");
  const fileRef = useRef(null);
  const stickerFileRef = useRef(null);
  const socketRef = useRef(null);
  const roomId = useMemo(() => roomIdFromSecret(roomSecret), [roomSecret]);

  useEffect(() => {
    localStorage.setItem("km_room_secret", roomSecret);
    localStorage.setItem("km_name", displayName);
    localStorage.setItem("km_photo_stickers", JSON.stringify(photoStickers));
    sha256Text(roomSecret).then((h) => setSafety(h.match(/.{1,4}/g)?.slice(0, 12).join(" ") || h));
  }, [roomSecret, displayName, photoStickers]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      setStatus("online");
      socket.emit("room:join", { roomId });
    });
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("room:history", async (items) => {
      const decoded = [];
      for (const item of items) {
        try {
          decoded.push({ ...item, clear: await decryptPayload(roomSecret, item.payload) });
        } catch {
          decoded.push({ ...item, clear: { error: "Не удалось расшифровать. Проверь ключ комнаты." } });
        }
      }
      setMessages(decoded);
    });
    socket.on("message:new", async (item) => {
      try {
        const clear = await decryptPayload(roomSecret, item.payload);
        setMessages((m) => [...m, { ...item, clear }]);
      } catch {
        setMessages((m) => [...m, { ...item, clear: { error: "Не удалось расшифровать." } }]);
      }
    });
    socket.on("room:wipe-local", () => setMessages([]));
    return () => socket.disconnect();
  }, [roomId, roomSecret]);

  async function choosePhoto(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Можно выбрать только изображение.");
    if (file.size > 5 * 1024 * 1024) return alert("Максимум 5 MB.");
    setPhoto({ name: file.name, mime: file.type, dataUrl: await fileToDataUrl(file) });
  }

  async function importPhotoSticker(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Нужна картинка.");
    if (file.size > 2 * 1024 * 1024) return alert("Стикер максимум 2 MB.");
    const dataUrl = await fileToDataUrl(file);
    const title = file.name.replace(/\.[^.]+$/, "").slice(0, 32) || "Мем-стикер";
    const newSticker = {
      id: `real-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      hint: "Реальное фото",
      dataUrl,
      tags: `${title} мем фото прикол реакция русский`,
    };
    setPhotoStickers((s) => [newSticker, ...s.filter((x) => x.dataUrl)]);
    setSticker(newSticker);
    setStickerOpen(false);
    if (stickerFileRef.current) stickerFileRef.current.value = "";
  }

  async function send() {
    if (!text.trim() && !photo && !sticker) return;
    const clear = {
      sender: displayName || "Аноним",
      text: text.trim(),
      photo,
      sticker,
      sentAt: Date.now(),
    };
    const payload = await encryptPayload(roomSecret, clear);
    socketRef.current?.emit("message:send", { roomId, payload });
    setText("");
    setPhoto(null);
    setSticker(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function newRoom() {
    setRoomSecret(secret(96));
    setMessages([]);
    setCipherView(null);
  }

  function panic() {
    setMessages([]);
    setText("");
    setPhoto(null);
    setSticker(null);
    setCipherView(null);
    setRoomSecret(secret(96));
    localStorage.removeItem("km_room_secret");
  }

  const filteredStickers = photoStickers.filter((s) => `${s.title} ${s.tags} ${s.hint}`.toLowerCase().includes(stickerQuery.toLowerCase()));

  return (
    <main className="tgApp">
      <aside className={leftOpen ? "tgSidebar open" : "tgSidebar"}>
        <div className="tgSidebarTop">
          <button className="iconBtn mobileOnly" onClick={() => setLeftOpen(false)}><X size={22}/></button>
          <div className="avatar">KM</div>
          <div>
            <h1>Korvet manager</h1>
            <p>{status === "online" ? "online" : "offline"}</p>
          </div>
        </div>

        <div className="searchBar"><Search size={18}/><input placeholder="Поиск" /></div>

        <button className="chatRow active" onClick={() => { setActivePanel("chat"); setLeftOpen(false); }}>
          <div className="chatAvatar"><MessageCircle size={22}/></div>
          <div className="chatPreview">
            <strong>Приватная комната</strong>
            <span>{messages.length ? "E2E сообщения, фото, стикеры" : "Начни переписку"}</span>
          </div>
          <small>{messages.length}</small>
        </button>

        <button className="chatRow" onClick={() => setActivePanel("settings")}>
          <div className="chatAvatar muted"><Settings size={22}/></div>
          <div className="chatPreview">
            <strong>Настройки приватности</strong>
            <span>Ключ комнаты и safety number</span>
          </div>
        </button>

        <div className="sidebarFooter">
          <button onClick={panic} className="dangerBtn"><AlertTriangle size={18}/> Panic wipe</button>
        </div>
      </aside>

      <section className="tgMain">
        <header className="tgHeader">
          <button className="iconBtn mobileOnly" onClick={() => setLeftOpen(true)}><Menu size={24}/></button>
          <button className="headerIdentity" onClick={() => setInfoOpen(true)}>
            <div className="headerAvatar">K</div>
            <div>
              <strong>Korvet manager</strong>
              <span>{status === "online" ? "online · E2E encrypted" : "offline"}</span>
            </div>
          </button>
          <div className="headerActions">
            <button className="iconBtn" onClick={() => setInfoOpen(true)}><ShieldCheck size={22}/></button>
            <button className="iconBtn"><MoreVertical size={22}/></button>
          </div>
        </header>

        {activePanel === "settings" ? (
          <div className="settingsPage">
            <button className="backBtn" onClick={() => setActivePanel("chat")}><ArrowLeft size={20}/> Назад в чат</button>
            <PrivacySettings
              roomSecret={roomSecret}
              setRoomSecret={setRoomSecret}
              safety={safety}
              displayName={displayName}
              setDisplayName={setDisplayName}
              roomId={roomId}
              newRoom={newRoom}
              setMessages={setMessages}
            />
          </div>
        ) : (
          <>
            <div className="tgMessages">
              <div className="dateBadge">Сегодня</div>
              {messages.length === 0 && (
                <div className="emptyChat">
                  <ShieldCheck size={42}/>
                  <h2>Korvet manager</h2>
                  <p>Приватный чат с интерфейсом как у мессенджера. Текст, фото и реальные фото-стикеры шифруются в браузере.</p>
                </div>
              )}

              {messages.map((m) => {
                const mine = m.clear?.sender === displayName;
                return (
                  <button key={m.id} className={mine ? "bubble mine" : "bubble"} onClick={() => setCipherView(m.payload)}>
                    {m.clear?.error && <p className="error">{m.clear.error}</p>}
                    {m.clear?.sticker && (
                      <div className="realSticker">
                        {m.clear.sticker.dataUrl ? (
                          <img src={m.clear.sticker.dataUrl} alt={m.clear.sticker.title} />
                        ) : (
                          <div className="stickerPlaceholder">Добавь<br/>фото</div>
                        )}
                      </div>
                    )}
                    {m.clear?.photo && <img draggable="false" className="tgPhoto" src={m.clear.photo.dataUrl} alt="encrypted" />}
                    {m.clear?.text && <p className="bubbleText">{m.clear.text}</p>}
                    <span className="bubbleTime">
                      {new Date(m.clear?.sentAt || m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {mine && <Check size={14}/>}
                    </span>
                  </button>
                );
              })}
            </div>

            {stickerOpen && (
              <div className="stickerDrawer">
                <div className="drawerHead">
                  <strong>Фото-стикеры мемы</strong>
                  <button onClick={() => setStickerOpen(false)}><X size={18}/></button>
                </div>
                <div className="drawerInfo">
                  Загружай свои реальные мем-фото: лица, реакции, приколы. Они хранятся локально и отправляются зашифрованно.
                </div>
                <div className="searchBar drawerSearch"><Search size={18}/><input placeholder="поиск мемов..." value={stickerQuery} onChange={(e) => setStickerQuery(e.target.value)} /></div>
                <input ref={stickerFileRef} className="hidden" type="file" accept="image/*" onChange={(e) => importPhotoSticker(e.target.files?.[0])} />
                <button className="importSticker" onClick={() => stickerFileRef.current?.click()}><Upload size={18}/> Добавить реальный фото-стикер</button>
                <div className="photoStickerGrid">
                  {filteredStickers.map((s) => (
                    <button key={s.id} onClick={() => { if (!s.dataUrl) { stickerFileRef.current?.click(); return; } setSticker(s); setStickerOpen(false); }}>
                      {s.dataUrl ? <img src={s.dataUrl} alt={s.title}/> : <div className="placeholderSticker"><Plus size={26}/></div>}
                      <span>{s.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(photo || sticker) && (
              <div className="attachmentPreview">
                {photo && <span><Camera size={16}/> Фото: {photo.name}</span>}
                {sticker && <span><SmilePlus size={16}/> Стикер: {sticker.title}</span>}
                <button onClick={() => { setPhoto(null); setSticker(null); }}><X size={16}/></button>
              </div>
            )}

            <footer className="tgComposer">
              <input ref={fileRef} className="hidden" type="file" accept="image/*" onChange={(e) => choosePhoto(e.target.files?.[0])} />
              <button onClick={() => fileRef.current?.click()}><Paperclip size={23}/></button>
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Сообщение" />
              <button onClick={() => setStickerOpen(!stickerOpen)}><SmilePlus size={23}/></button>
              <button className="sendRound" onClick={send}><Send size={21}/></button>
            </footer>
          </>
        )}
      </section>

      <aside className={infoOpen ? "infoPanel open" : "infoPanel"}>
        <div className="infoHead">
          <button className="iconBtn" onClick={() => setInfoOpen(false)}><X size={22}/></button>
          <strong>Информация</strong>
        </div>
        <PrivacySettings
          roomSecret={roomSecret}
          setRoomSecret={setRoomSecret}
          safety={safety}
          displayName={displayName}
          setDisplayName={setDisplayName}
          roomId={roomId}
          newRoom={newRoom}
          setMessages={setMessages}
        />
        <div className="cipherBox">
          <h3>Что видит сервер</h3>
          {cipherView ? <pre>{JSON.stringify(cipherView, null, 2)}</pre> : <p>Нажми на сообщение, чтобы увидеть ciphertext.</p>}
        </div>
      </aside>
    </main>
  );
}

function PrivacySettings({ roomSecret, setRoomSecret, safety, displayName, setDisplayName, roomId, newRoom, setMessages }) {
  return (
    <div className="privacyCard">
      <label>Ваше имя</label>
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />

      <div className="settingBox">
        <div className="settingTitle"><KeyRound size={18}/> Ключ комнаты</div>
        <code>{roomSecret}</code>
        <div className="settingsGrid">
          <button onClick={() => navigator.clipboard.writeText(roomSecret)}><Copy size={16}/> Копировать</button>
          <button onClick={newRoom}>Новая комната</button>
        </div>
      </div>

      <div className="settingBox">
        <div className="settingTitle"><ShieldCheck size={18}/> Safety number</div>
        <code>{safety}</code>
        <p>Сверьте этот код вне чата. Если код отличается — ключ комнаты не совпадает.</p>
      </div>

      <div className="settingBox">
        <div className="settingTitle"><Lock size={18}/> Приватность</div>
        <p>Сервер получает только ciphertext. Фото и фото-стикеры тоже шифруются до отправки.</p>
        <p>Комната: <b>{roomId}</b></p>
      </div>

      <button className="clearBtn" onClick={() => setMessages([])}><Trash2 size={18}/> Очистить чат у меня</button>
    </div>
  );
}
