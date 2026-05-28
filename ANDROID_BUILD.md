# Korvet manager — Android APK build

Эта версия подготовлена как Android-ready проект.

## Вариант 1: установить как приложение без APK

На телефоне:
1. Запусти сайт через Termux.
2. Открой `http://localhost:5173`.
3. В меню браузера нажми: **Добавить на главный экран**.
4. Появится иконка Korvet manager.

Это самый простой способ.

## Вариант 2: собрать настоящий APK

Лучше делать на ПК с Android Studio.

```bash
npm install
npm run install:all
npm run build:web
npm run android:init
npm run android:sync
npm run android:open
```

Дальше в Android Studio:
1. Build
2. Build Bundle(s) / APK(s)
3. Build APK(s)

APK появится примерно здесь:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Важно

Если приложение должно работать у двух людей через интернет, нужен сервер на VPS.
На одном телефоне `localhost` работает только для этого телефона.

Для второго человека:
- либо одна Wi-Fi сеть и IP телефона;
- либо VPS/домен/HTTPS;
- либо отдельный сервер.
