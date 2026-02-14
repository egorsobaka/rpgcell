# RPG Game - Multiplayer Browser Game

Браузерная многопользовательская RPG игра с бесконечной картой из цветных клеток.

## Технологии

- **Backend**: NestJS, Socket.IO, MongoDB
- **Frontend**: React, Phaser.js, Socket.IO Client
- **Database**: MongoDB
- **Containerization**: Docker, Docker Compose

## Установка и запуск

### Предварительные требования

- Docker и Docker Compose
- Node.js 20+ (для локальной разработки)

### Установка зависимостей

```bash
# Backend
cd backend/backend-app
npm install

# Frontend
cd ../../frontend/frontend-app
npm install
```

### Запуск с Docker

```bash
# Из корневой директории проекта
docker-compose up -d

# Или для просмотра логов
docker-compose up
```

Сервисы будут доступны:
- Frontend: http://localhost
- Backend: http://localhost:3000
- MongoDB: localhost:27017

### Остановка

```bash
docker-compose down

# С удалением volumes (данные будут удалены)
docker-compose down -v
```

### Локальная разработка

1. Запустите MongoDB:
```bash
docker-compose up -d mongodb
```

2. Запустите backend:
```bash
cd backend/backend-app
npm run start:dev
```

3. Запустите frontend:
```bash
cd frontend/frontend-app
npm run dev
```

## Структура проекта

```
rpg/
├── backend/
│   └── backend-app/
│       ├── src/
│       │   ├── schemas/          # MongoDB схемы
│       │   ├── game.service.ts   # Логика игры
│       │   ├── game.gateway.ts   # WebSocket gateway
│       │   └── main.ts
│       └── Dockerfile
├── frontend/
│   └── frontend-app/
│       ├── src/
│       │   ├── App.tsx
│       │   └── game/
│       │       └── PhaserGame.tsx
│       └── Dockerfile
└── docker-compose.yml
```

## MongoDB схемы

- **Player**: Игроки и их состояние
- **Cell**: Клетки карты (цвет, здоровье, прогресс)
- **Chat**: Глобальный чат
- **LocalChat**: Локальные чаты по позициям клеток

## Переменные окружения

### Backend

- `MONGODB_URI`: URI подключения к MongoDB (по умолчанию: `mongodb://admin:password@localhost:27017/rpg_game?authSource=admin`)
- `PORT`: Порт сервера (по умолчанию: 3000)

## Примечания

После установки зависимостей MongoDB (`@nestjs/mongoose` и `mongoose`), необходимо переписать все методы GameService для работы с MongoDB. Сейчас частично реализована поддержка MongoDB для игроков.
